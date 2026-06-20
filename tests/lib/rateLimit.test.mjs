import assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { checkRateLimit, formatRetryMessage, reset, sweepStale } from '../../lib/rateLimit.js';

describe('checkRateLimit', () => {
  beforeEach(() => reset());

  it('allows the first call and reports remaining', () => {
    const r = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 5, windowMs: 1000, now: () => 0 });
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.remaining, 4);
    assert.strictEqual(r.retryAfterMs, 0);
  });

  it('allows calls up to the limit', () => {
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 5, windowMs: 1000, now: () => 0 });
      assert.strictEqual(r.allowed, true);
    }
  });

  it('blocks the call that would exceed the limit', () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit({ teamId: 'T1', userId: 'U1', max: 3, windowMs: 1000, now: () => 0 });
    }
    const blocked = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 3, windowMs: 1000, now: () => 0 });
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(blocked.remaining, 0);
  });

  it('reports retryAfterMs based on the oldest in-window call', () => {
    checkRateLimit({ teamId: 'T1', userId: 'U1', max: 3, windowMs: 1000, now: () => 0 });
    checkRateLimit({ teamId: 'T1', userId: 'U1', max: 3, windowMs: 1000, now: () => 0 });
    checkRateLimit({ teamId: 'T1', userId: 'U1', max: 3, windowMs: 1000, now: () => 0 });
    // retry = oldest(0) + window(1000) - now(400) = 600
    const blocked = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 3, windowMs: 1000, now: () => 400 });
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(blocked.retryAfterMs, 600);
  });

  it('allows again after the window expires', () => {
    checkRateLimit({ teamId: 'T1', userId: 'U1', max: 2, windowMs: 1000, now: () => 0 });
    checkRateLimit({ teamId: 'T1', userId: 'U1', max: 2, windowMs: 1000, now: () => 0 });
    const blocked = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 2, windowMs: 1000, now: () => 500 });
    assert.strictEqual(blocked.allowed, false);
    // t=1001 → both calls at 0 are now outside the window [1, 1001]
    const allowed = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 2, windowMs: 1000, now: () => 1001 });
    assert.strictEqual(allowed.allowed, true);
    assert.strictEqual(allowed.remaining, 1);
  });

  it('keys independently for different users', () => {
    checkRateLimit({ teamId: 'T1', userId: 'U1', max: 1, windowMs: 1000, now: () => 0 });
    const u1Second = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 1, windowMs: 1000, now: () => 0 });
    const u2First = checkRateLimit({ teamId: 'T1', userId: 'U2', max: 1, windowMs: 1000, now: () => 0 });
    assert.strictEqual(u1Second.allowed, false);
    assert.strictEqual(u2First.allowed, true);
  });

  it('keys independently for different teams', () => {
    checkRateLimit({ teamId: 'T1', userId: 'U1', max: 1, windowMs: 1000, now: () => 0 });
    const blocked = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 1, windowMs: 1000, now: () => 0 });
    const otherTeam = checkRateLimit({ teamId: 'T2', userId: 'U1', max: 1, windowMs: 1000, now: () => 0 });
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(otherTeam.allowed, true);
  });

  it('falls back to defaults when teamId/userId are missing', () => {
    const r = checkRateLimit({ max: 1, windowMs: 1000, now: () => 0 });
    assert.strictEqual(r.allowed, true);
    const blocked = checkRateLimit({ max: 1, windowMs: 1000, now: () => 0 });
    assert.strictEqual(blocked.allowed, false);
  });

  it('falls back to default limit when given invalid max', () => {
    const r = checkRateLimit({ teamId: 'T', userId: 'U', max: 0, windowMs: 1000, now: () => 0 });
    assert.strictEqual(r.allowed, true);
  });

  it('decreases remaining as calls accumulate', () => {
    const r1 = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 3, windowMs: 1000, now: () => 0 });
    const r2 = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 3, windowMs: 1000, now: () => 0 });
    assert.strictEqual(r1.remaining, 2);
    assert.strictEqual(r2.remaining, 1);
  });

  it('uses injected clock consistently', () => {
    let clock = 100;
    const now = () => clock;
    const r1 = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 2, windowMs: 1000, now });
    clock += 200;
    const r2 = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 2, windowMs: 1000, now });
    assert.strictEqual(r1.allowed, true);
    assert.strictEqual(r2.allowed, true);
    clock += 200;
    const blocked = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 2, windowMs: 1000, now });
    assert.strictEqual(blocked.allowed, false);
  });
});

describe('sweepStale', () => {
  beforeEach(() => reset());

  it('removes keys whose timestamps have all expired', () => {
    checkRateLimit({ teamId: 'T1', userId: 'U1', max: 5, windowMs: 1000, now: () => 0 });
    sweepStale({ windowMs: 1000, now: () => 2000 });
    // After sweep the key is gone, so a fresh call starts a new bucket.
    const r = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 5, windowMs: 1000, now: () => 2000 });
    assert.strictEqual(r.remaining, 4);
  });

  it('keeps keys with recent timestamps', () => {
    checkRateLimit({ teamId: 'T1', userId: 'U1', max: 5, windowMs: 1000, now: () => 500 });
    sweepStale({ windowMs: 1000, now: () => 800 });
    const r = checkRateLimit({ teamId: 'T1', userId: 'U1', max: 5, windowMs: 1000, now: () => 800 });
    assert.strictEqual(r.remaining, 3); // 2 used, 3 remaining
  });

  it('handles an empty bucket set without error', () => {
    reset();
    assert.doesNotThrow(() => sweepStale({ windowMs: 1000, now: () => 0 }));
  });
});

describe('formatRetryMessage', () => {
  it('returns a "moment" message for zero/short waits', () => {
    assert.match(formatRetryMessage(0), /moment/i);
    assert.match(formatRetryMessage(999), /moment/i);
  });

  it('includes seconds for longer waits', () => {
    assert.match(formatRetryMessage(5500), /6/);
    assert.match(formatRetryMessage(10000), /10/);
  });

  it('handles null/undefined input', () => {
    assert.ok(typeof formatRetryMessage(undefined) === 'string');
    assert.ok(typeof formatRetryMessage(null) === 'string');
  });
});
