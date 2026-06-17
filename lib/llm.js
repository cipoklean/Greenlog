import OpenAI from 'openai';

export const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

export const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

/**
 * Run a Gemini chat completion with sensible defaults.
 * userContent can be a plain string (text) or an array (vision: text + image_url).
 */
export async function chatComplete({
  systemPrompt,
  userContent,
  model = DEFAULT_MODEL,
  maxTokens = 400,
  temperature = 0.3,
  timeoutMs = 30000,
}) {
  const completion = await gemini.chat.completions.create(
    {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    },
    { timeout: timeoutMs, maxRetries: 1 },
  );
  return completion.choices[0]?.message?.content?.trim() || '';
}

/**
 * Map common LLM SDK errors to user-friendly messages.
 */
export function classifyLlmError(err) {
  const status = err?.status || err?.response?.status;
  const code = err?.code;
  if (status === 429) {
    return "I'm getting rate-limited right now — try again in about a minute.";
  }
  if (status === 401 || status === 403) {
    return "There's an auth problem with the AI service. Ping the admin.";
  }
  if (status && status >= 500) {
    return "The AI service is having a moment. Try again in a few seconds.";
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND') {
    return "I'm having trouble reaching the AI service. Try again.";
  }
  return `Something went wrong: ${err?.message || 'unknown error'}`;
}

/**
 * Normalize bullet output from LLMs that ignore strict format rules.
 * Splits on `-`, `*`, or `•` markers; rejoins as `- ` per line.
 */
export function normalizeBullets(text) {
  if (!text) return text;
  const parts = text
    .split(/(?:^|\s+)[-*•]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return text;
  return parts.map((p) => `- ${p}`).join('\n');
}