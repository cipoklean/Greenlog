import assert from 'node:assert';
import { before, describe, it } from 'node:test';

// Set dummy key before importing llm.js (which instantiates OpenAI at module level)
process.env.GEMINI_API_KEY = 'test-dummy-key';

let classifyLlmError;
let normalizeBullets;

before(async () => {
  const mod = await import('../../lib/llm.js');
  classifyLlmError = mod.classifyLlmError;
  normalizeBullets = mod.normalizeBullets;
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
