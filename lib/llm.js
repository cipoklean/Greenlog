const OpenAI = require('openai');

/**
 * Multi-provider LLM layer with an automatic fallback chain.
 *
 * Any OpenAI-compatible provider can be registered in PROVIDERS and selected
 * via the LLM_PROVIDER env var. When the primary fails with a retriable error
 * (429 rate-limit, 401/403 auth, 5xx, timeout), the next configured provider
 * is tried automatically — the caller never sees an error unless the whole
 * chain is exhausted. Vision requests skip text-only providers, so a vision
 * call stays on Gemini rather than degrading onto Groq.
 *
 * The fallback loop (runFallbackChain) is exported separately so it can be
 * tested with an injected call function, without touching the real SDK.
 */

/**
 * Provider registry. Add an OpenAI-compatible provider by appending one entry:
 *   <id>: { name, apiKeyEnv, baseURL, model, supportsVision }
 *
 * Primary provider = process.env.LLM_PROVIDER (default 'gemini').
 * Fallback order = primary, then the remaining entries in registry order.
 */
const PROVIDERS = {
  gemini: {
    name: 'gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
    supportsVision: true,
  },
  groq: {
    name: 'groq',
    apiKeyEnv: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    supportsVision: false, // text-only — vision requests skip it
  },
};

const DEFAULT_MODEL = PROVIDERS.gemini.model;

// Lazily-built client cache. A provider only instantiates its OpenAI client
// when (a) someone tries to use it and (b) its API key env is set — so module
// import never throws on a missing key, and keyless providers are skipped.
const clientCache = new Map();

function getClient(provider) {
  if (clientCache.has(provider.name)) return clientCache.get(provider.name);
  const client = new OpenAI({
    apiKey: process.env[provider.apiKeyEnv],
    baseURL: provider.baseURL,
  });
  clientCache.set(provider.name, client);
  return client;
}

/**
 * Whether a provider is usable right now: its API key env must be set.
 */
function providerHasKey(provider) {
  return Boolean(process.env[provider.apiKeyEnv]);
}

/**
 * Build the ordered fallback chain for a request.
 *
 * @param {object} opts
 * @param {boolean} [opts.requiresVision=false] when true, providers with
 *   supportsVision:false are skipped entirely (a vision call won't degrade
 *   onto a text-only provider — it stays on a vision-capable one or fails).
 * @returns {object[]} ordered list of usable providers
 */
function resolveChain({ requiresVision = false } = {}) {
  const primaryName = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  const primary = PROVIDERS[primaryName] || PROVIDERS.gemini;
  const order = [primary, ...Object.values(PROVIDERS).filter((p) => p !== primary)];
  return order.filter((p) => {
    if (!providerHasKey(p)) return false;
    if (requiresVision && !p.supportsVision) return false;
    return true;
  });
}

/**
 * Should we try the next provider after this error, or give up?
 *
 * Retriable (→ next provider): 429 rate-limit, 401/403 auth (key may be
 *   rotated/expired on one provider but fine on another), any 5xx, and
 *   network/timeout errors.
 * Non-retriable (→ fail fast): 400/404/422 request-shape errors — switching
 *   providers won't fix a malformed prompt, so don't waste a second call.
 */
function isRetriable(err) {
  if (!err) return false;
  const status = err.status || err?.response?.status;
  if (status === 429 || status === 401 || status === 403) return true;
  if (status && status >= 500) return true;
  const code = err.code;
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ECONNABORTED') {
    return true;
  }
  const name = err.name || '';
  if (name === 'AbortError' || name === 'APIConnectionTimeoutError') return true;
  return false;
}

/**
 * Error thrown when every provider in the chain failed with a retriable error.
 * Carries the per-provider failure list so callers/loggers can introspect.
 */
class AllProvidersFailedError extends Error {
  constructor(failures, context = {}) {
    const names = failures.map((f) => f.provider.name).join(', ');
    super(`All LLM providers failed (${names})`);
    this.name = 'AllProvidersFailedError';
    this.failures = failures;
    this.context = context;
  }
}

/**
 * Iterate providers, trying callFn on each until one succeeds.
 *
 * @param {object[]} chain - ordered providers from resolveChain
 * @param {object} opts - passed through to callFn; opts.context used for errors
 * @param {(provider: object, opts: object) => Promise<string>} callFn
 * @returns {Promise<string>} the successful callFn result
 * @throws {AllProvidersFailedError} if every provider failed retriably
 * @throws {Error} the original error on the first non-retriable failure
 */
async function runFallbackChain(chain, opts, callFn) {
  const failures = [];
  for (const provider of chain) {
    try {
      return await callFn(provider, opts);
    } catch (err) {
      if (!isRetriable(err)) throw err; // bad-request — switching won't help
      failures.push({ provider, err });
      if (opts?.logger?.warn) {
        opts.logger.warn(
          { provider: provider.name, status: err?.status, code: err?.code, message: err?.message },
          `LLM provider "${provider.name}" failed, trying next`,
        );
      }
    }
  }
  throw new AllProvidersFailedError(failures, opts?.context || {});
}

/**
 * The real call function: hits the OpenAI SDK against a single provider.
 * Kept separate from the fallback loop so tests can inject a stub.
 */
async function sdkCall(provider, opts) {
  const client = getClient(provider);
  const completion = await client.chat.completions.create(
    {
      model: provider.model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      messages: [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.userContent },
      ],
    },
    { timeout: opts.timeoutMs, maxRetries: 1 },
  );
  return completion.choices[0]?.message?.content?.trim() || '';
}

/**
 * Run a chat completion across the provider chain with automatic fallback.
 *
 * userContent can be a string (text) or an array (vision: text + image_url).
 * An array is treated as a vision request and skips text-only providers.
 *
 * @param {object} args
 * @param {string} args.systemPrompt
 * @param {string|Array} args.userContent
 * @param {number} [args.maxTokens=400]
 * @param {number} [args.temperature=0.3]
 * @param {number} [args.timeoutMs=30000]
 * @param {object} [args.context] - intent metadata for graceful-degradation msgs
 * @param {object} [args.logger] - optional Bolt logger for fallback transitions
 * @returns {Promise<string>} the model's reply text
 */
async function chatComplete({
  systemPrompt,
  userContent,
  maxTokens = 400,
  temperature = 0.3,
  timeoutMs = 30000,
  context,
  logger,
} = {}) {
  const requiresVision = Array.isArray(userContent);
  const chain = resolveChain({ requiresVision });
  return runFallbackChain(
    chain,
    { systemPrompt, userContent, maxTokens, temperature, timeoutMs, context, logger },
    sdkCall,
  );
}

/**
 * Map an LLM error to a user-friendly message. Context-aware: when all
 * providers failed, the message reflects what the user was trying to do
 * (e.g. "I couldn't summarize that — 5 messages were found") instead of a
 * generic "something went wrong".
 *
 * @param {Error} err
 * @param {{intent?: string, messageCount?: number}} [context]
 */
function classifyLlmError(err, context = {}) {
  // Whole chain failed → use intent to say what couldn't be done.
  if (err?.name === 'AllProvidersFailedError') {
    const { intent, messageCount } = context;
    const suffix = 'every AI provider is unavailable. Try again in a moment.';
    if (intent === 'summarize-thread') {
      const countLine = messageCount
        ? `— ${messageCount} message${messageCount === 1 ? ' was' : 's were'} found, but `
        : '— ';
      return `🌱 I couldn't summarize that right now ${countLine}${suffix}`;
    }
    if (intent === 'estimate') {
      return `🌱 I couldn't estimate the impact of that decision right now — ${suffix}`;
    }
    const names = (err.failures || []).map((f) => f.provider.name).join(', ');
    return `🌱 I couldn't complete that right now — ${names || 'all providers'} failed. Try again in a moment.`;
  }

  // Single-provider errors (raw SDK errors, or the non-retriable fail-fast path).
  const status = err?.status || err?.response?.status;
  const code = err?.code;
  if (status === 429) {
    return "🌱 I'm getting rate-limited right now — try again in about a minute.";
  }
  if (status === 401 || status === 403) {
    return "🌱 There's an auth problem with the AI service. Ping the admin.";
  }
  if (status && status >= 500) {
    return '🌱 The AI service is having a moment. Try again in a few seconds.';
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND') {
    return "🌱 I'm having trouble reaching the AI service. Try again.";
  }
  return '🌱 Something went wrong. Please try again.';
}

/**
 * Normalize bullet output from LLMs that ignore strict format rules.
 * Splits on `-`, `*`, or `•` markers; rejoins as `- ` per line.
 */
function normalizeBullets(text) {
  if (!text) return text;
  const parts = text
    .split(/(?:^|\s+)[-*•]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return text;
  return parts.map((p) => `- ${p}`).join('\n');
}

module.exports = {
  chatComplete,
  classifyLlmError,
  normalizeBullets,
  PROVIDERS,
  resolveChain,
  runFallbackChain,
  isRetriable,
  AllProvidersFailedError,
  DEFAULT_MODEL,
};
