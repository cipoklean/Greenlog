import assert from 'node:assert';
import { before, describe, it } from 'node:test';

// Set dummy keys before importing llm.js (which reads env at module load for
// provider config). Both providers keyed so resolveChain can return either.
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.GROQ_API_KEY = 'test-groq-key';

let classifyLlmError;
let normalizeBullets;
let resolveChain;
let isRetriable;
let runFallbackChain;
let AllProvidersFailedError;
let PROVIDERS;

before(async () => {
  const mod = await import('../../lib/llm.js');
  classifyLlmError = mod.classifyLlmError;
  normalizeBullets = mod.normalizeBullets;
  resolveChain = mod.resolveChain;
  isRetriable = mod.isRetriable;
  runFallbackChain = mod.runFallbackChain;
  AllProvidersFailedError = mod.AllProvidersFailedError;
  PROVIDERS = mod.PROVIDERS;
});

describe('classifyLlmError', () => {
  it('returns rate-limit message for 429', () => {
    const msg = classifyLlmError({ status: 429 });
    assert.ok(msg.includes('rate-limited'));
  });

  it('returns rate-limit message for 429 via response.status', () => {
    const msg = classifyLlmError({ response: { status: 429 } });
    assert.ok(msg.includes('rate-limited'));
  });

  it('returns auth message for 401', () => {
    const msg = classifyLlmError({ status: 401 });
    assert.ok(msg.includes('auth problem'));
  });

  it('returns auth message for 403', () => {
    const msg = classifyLlmError({ status: 403 });
    assert.ok(msg.includes('auth problem'));
  });

  it('returns server error message for 500+', () => {
    const msg = classifyLlmError({ status: 500 });
    assert.ok(msg.includes('having a moment'));
  });

  it('returns server error message for 503', () => {
    const msg = classifyLlmError({ status: 503 });
    assert.ok(msg.includes('having a moment'));
  });

  it('returns network error for ETIMEDOUT', () => {
    const msg = classifyLlmError({ code: 'ETIMEDOUT' });
    assert.ok(msg.includes('trouble reaching'));
  });

  it('returns network error for ECONNRESET', () => {
    const msg = classifyLlmError({ code: 'ECONNRESET' });
    assert.ok(msg.includes('trouble reaching'));
  });

  it('returns network error for ENOTFOUND', () => {
    const msg = classifyLlmError({ code: 'ENOTFOUND' });
    assert.ok(msg.includes('trouble reaching'));
  });

  it('returns generic message for unknown errors', () => {
    const msg = classifyLlmError({ message: 'something weird' });
    assert.ok(msg.includes('Something went wrong'));
  });

  it('returns generic message for null/undefined', () => {
    const msg = classifyLlmError(null);
    assert.ok(msg.includes('Something went wrong'));
    const msg2 = classifyLlmError(undefined);
    assert.ok(msg2.includes('Something went wrong'));
  });
});

describe('classifyLlmError — context-aware (AllProvidersFailedError)', () => {
  function makeChainError(failures) {
    return new AllProvidersFailedError(failures, {});
  }

  it('summarize-thread intent with count mentions the message count', () => {
    const err = makeChainError([
      { provider: PROVIDERS.gemini, err: { status: 429 } },
      { provider: PROVIDERS.groq, err: { status: 503 } },
    ]);
    const msg = classifyLlmError(err, { intent: 'summarize-thread', messageCount: 5 });
    assert.ok(msg.includes("couldn't summarize"), `got: ${msg}`);
    assert.ok(msg.includes('5 messages were found'), `got: ${msg}`);
    assert.ok(msg.includes('every AI provider is unavailable'), `got: ${msg}`);
  });

  it('summarize-thread intent with count of 1 is singular', () => {
    const err = makeChainError([{ provider: PROVIDERS.gemini, err: { status: 429 } }]);
    const msg = classifyLlmError(err, { intent: 'summarize-thread', messageCount: 1 });
    assert.ok(msg.includes('1 message was found'), `got: ${msg}`);
  });

  it('summarize-thread intent without count still reads sanely', () => {
    const err = makeChainError([{ provider: PROVIDERS.gemini, err: { status: 429 } }]);
    const msg = classifyLlmError(err, { intent: 'summarize-thread' });
    assert.ok(msg.includes("couldn't summarize"), `got: ${msg}`);
    assert.ok(!msg.includes('undefined'), `got: ${msg}`);
  });

  it('estimate intent names the decision', () => {
    const err = makeChainError([{ provider: PROVIDERS.gemini, err: { status: 429 } }]);
    const msg = classifyLlmError(err, { intent: 'estimate' });
    assert.ok(msg.includes('estimate the impact'), `got: ${msg}`);
    assert.ok(msg.includes('every AI provider is unavailable'), `got: ${msg}`);
  });

  it('unknown intent falls back to naming the failed providers', () => {
    const err = makeChainError([
      { provider: PROVIDERS.gemini, err: { status: 429 } },
      { provider: PROVIDERS.groq, err: { status: 503 } },
    ]);
    const msg = classifyLlmError(err, {});
    assert.ok(msg.includes('gemini'), `got: ${msg}`);
    assert.ok(msg.includes('groq'), `got: ${msg}`);
  });
});

describe('normalizeBullets', () => {
  it('returns null/undefined as-is', () => {
    assert.strictEqual(normalizeBullets(null), null);
    assert.strictEqual(normalizeBullets(undefined), undefined);
    assert.strictEqual(normalizeBullets(''), '');
  });

  it('converts dash bullets to uniform format', () => {
    const result = normalizeBullets('- Reduce energy use\n- Switch to LEDs\n- Use public transit');
    assert.strictEqual(result, '- Reduce energy use\n- Switch to LEDs\n- Use public transit');
  });

  it('converts asterisk bullets to dash format', () => {
    const result = normalizeBullets('* Reduce energy use\n* Switch to LEDs');
    assert.strictEqual(result, '- Reduce energy use\n- Switch to LEDs');
  });

  it('converts bullet character to dash format', () => {
    const result = normalizeBullets('• Reduce energy use\n• Switch to LEDs');
    assert.strictEqual(result, '- Reduce energy use\n- Switch to LEDs');
  });

  it('handles mixed bullet styles', () => {
    const result = normalizeBullets('- First item\n* Second item\n• Third item');
    assert.strictEqual(result, '- First item\n- Second item\n- Third item');
  });

  it('trims whitespace from each bullet', () => {
    const result = normalizeBullets('-   Reduce energy use   \n*  Switch to LEDs  ');
    assert.strictEqual(result, '- Reduce energy use\n- Switch to LEDs');
  });

  it('adds dash prefix to plain text (no bullets found)', () => {
    const result = normalizeBullets('Just a plain sentence with no bullets');
    assert.strictEqual(result, '- Just a plain sentence with no bullets');
  });
});

describe('isRetriable', () => {
  it('returns true for 429 rate-limit', () => {
    assert.strictEqual(isRetriable({ status: 429 }), true);
  });
  it('returns true for 401 auth', () => {
    assert.strictEqual(isRetriable({ status: 401 }), true);
  });
  it('returns true for 403 auth', () => {
    assert.strictEqual(isRetriable({ status: 403 }), true);
  });
  it('returns true for 500 server error', () => {
    assert.strictEqual(isRetriable({ status: 500 }), true);
  });
  it('returns true for 503 server error', () => {
    assert.strictEqual(isRetriable({ status: 503 }), true);
  });
  it('returns true for ETIMEDOUT', () => {
    assert.strictEqual(isRetriable({ code: 'ETIMEDOUT' }), true);
  });
  it('returns true for ECONNRESET', () => {
    assert.strictEqual(isRetriable({ code: 'ECONNRESET' }), true);
  });
  it('returns true for ENOTFOUND', () => {
    assert.strictEqual(isRetriable({ code: 'ENOTFOUND' }), true);
  });
  it('returns true for AbortError', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    assert.strictEqual(isRetriable(err), true);
  });
  it('returns true for ECONNABORTED', () => {
    assert.strictEqual(isRetriable({ code: 'ECONNABORTED' }), true);
  });
  it('returns false for 400 bad request', () => {
    assert.strictEqual(isRetriable({ status: 400 }), false);
  });
  it('returns false for 404 not found', () => {
    assert.strictEqual(isRetriable({ status: 404 }), false);
  });
  it('returns false for 422 unprocessable', () => {
    assert.strictEqual(isRetriable({ status: 422 }), false);
  });
  it('returns false for null/undefined', () => {
    assert.strictEqual(isRetriable(null), false);
    assert.strictEqual(isRetriable(undefined), false);
  });
  it('returns false for unknown error shapes', () => {
    assert.strictEqual(isRetriable({ message: 'weird' }), false);
  });
});

describe('resolveChain', () => {
  it('defaults to gemini as primary when LLM_PROVIDER unset', () => {
    const prev = process.env.LLM_PROVIDER;
    delete process.env.LLM_PROVIDER;
    const chain = resolveChain();
    assert.strictEqual(chain[0].name, 'gemini');
    assert.ok(chain.length >= 1);
    process.env.LLM_PROVIDER = prev;
  });

  it('respects LLM_PROVIDER as primary', () => {
    const prev = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = 'groq';
    const chain = resolveChain();
    assert.strictEqual(chain[0].name, 'groq');
    process.env.LLM_PROVIDER = prev;
  });

  it('skips providers whose API key env is unset', () => {
    const prevGroq = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    const chain = resolveChain();
    assert.ok(
      chain.every((p) => p.name !== 'groq'),
      'groq should be skipped without a key',
    );
    process.env.GROQ_API_KEY = prevGroq;
  });

  it('skips text-only providers when requiresVision is true', () => {
    const chain = resolveChain({ requiresVision: true });
    assert.ok(
      chain.every((p) => p.supportsVision),
      `got: ${chain.map((p) => p.name).join(',')}`,
    );
    assert.ok(
      chain.every((p) => p.name !== 'groq'),
      'groq is text-only and must be skipped for vision',
    );
  });

  it('includes text-only providers for plain text requests', () => {
    const chain = resolveChain({ requiresVision: false });
    assert.ok(
      chain.some((p) => p.name === 'groq'),
      'groq should be available for text',
    );
  });
});

describe('runFallbackChain', () => {
  it('returns the result of the first successful provider', async () => {
    const calls = [];
    const result = await runFallbackChain(
      [PROVIDERS.gemini, PROVIDERS.groq],
      { systemPrompt: 'p', userContent: 'hi' },
      async (provider) => {
        calls.push(provider.name);
        return `reply-from-${provider.name}`;
      },
    );
    assert.strictEqual(result, 'reply-from-gemini');
    assert.deepStrictEqual(calls, ['gemini']);
  });

  it('falls over to the next provider on a retriable error (429)', async () => {
    const calls = [];
    const result = await runFallbackChain(
      [PROVIDERS.gemini, PROVIDERS.groq],
      { systemPrompt: 'p', userContent: 'hi' },
      async (provider) => {
        calls.push(provider.name);
        if (provider.name === 'gemini') {
          const e = new Error('rate limited');
          e.status = 429;
          throw e;
        }
        return 'reply-from-groq';
      },
    );
    assert.strictEqual(result, 'reply-from-groq');
    assert.deepStrictEqual(calls, ['gemini', 'groq']);
  });

  it('falls over on a 5xx server error', async () => {
    const result = await runFallbackChain([PROVIDERS.gemini, PROVIDERS.groq], {}, async (provider) => {
      if (provider.name === 'gemini') {
        const e = new Error('down');
        e.status = 503;
        throw e;
      }
      return 'ok';
    });
    assert.strictEqual(result, 'ok');
  });

  it('falls over on an auth error (401)', async () => {
    const result = await runFallbackChain([PROVIDERS.gemini, PROVIDERS.groq], {}, async (provider) => {
      if (provider.name === 'gemini') {
        const e = new Error('unauthorized');
        e.status = 401;
        throw e;
      }
      return 'ok';
    });
    assert.strictEqual(result, 'ok');
  });

  it('falls over on a timeout (ETIMEDOUT)', async () => {
    const result = await runFallbackChain([PROVIDERS.gemini, PROVIDERS.groq], {}, async (provider) => {
      if (provider.name === 'gemini') {
        const e = new Error('timed out');
        e.code = 'ETIMEDOUT';
        throw e;
      }
      return 'ok';
    });
    assert.strictEqual(result, 'ok');
  });

  it('throws AllProvidersFailedError when every provider fails retriably', async () => {
    await assert.rejects(
      () =>
        runFallbackChain([PROVIDERS.gemini, PROVIDERS.groq], { context: { intent: 'estimate' } }, async (provider) => {
          const e = new Error('nope');
          e.status = provider.name === 'gemini' ? 429 : 503;
          throw e;
        }),
      (err) => {
        assert.strictEqual(err.name, 'AllProvidersFailedError');
        assert.strictEqual(err.failures.length, 2);
        assert.strictEqual(err.failures[0].provider.name, 'gemini');
        assert.strictEqual(err.failures[1].provider.name, 'groq');
        assert.deepStrictEqual(err.context, { intent: 'estimate' });
        return true;
      },
    );
  });

  it('fail-fasts on a non-retriable error and never calls the next provider', async () => {
    const calls = [];
    await assert.rejects(
      () =>
        runFallbackChain([PROVIDERS.gemini, PROVIDERS.groq], {}, async (provider) => {
          calls.push(provider.name);
          const e = new Error('bad request');
          e.status = 400;
          throw e;
        }),
      (err) => {
        assert.strictEqual(err.status, 400);
        return true;
      },
    );
    assert.deepStrictEqual(calls, ['gemini'], 'groq must not be called on a 400');
  });

  it('logs a warning on each fallback transition when a logger is provided', async () => {
    const warnings = [];
    const logger = { warn: (meta, msg) => warnings.push({ meta, msg }) };
    await runFallbackChain([PROVIDERS.gemini, PROVIDERS.groq], { logger }, async (provider) => {
      if (provider.name === 'gemini') {
        const e = new Error('rate limited');
        e.status = 429;
        throw e;
      }
      return 'ok';
    });
    assert.strictEqual(warnings.length, 1);
    assert.strictEqual(warnings[0].meta.provider, 'gemini');
    assert.ok(warnings[0].msg.includes('trying next'));
  });
});
