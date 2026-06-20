/**
 * In-memory sliding-window rate limiter for LLM call protection.
 *
 * Single-process bot (Slack Socket Mode), so an in-process Map is sufficient.
 * Per-user-per-workspace keying: one user spamming won't throttle their team.
 *
 * Defaults overridable via env:
 *   GREENLOG_RATE_LIMIT_MAX         (default 10) calls per window
 *   GREENLOG_RATE_LIMIT_WINDOW_MS   (default 60000) window length in ms
 */

const DEFAULT_MAX = Number(process.env.GREENLOG_RATE_LIMIT_MAX) || 10;
const DEFAULT_WINDOW_MS = Number(process.env.GREENLOG_RATE_LIMIT_WINDOW_MS) || 60_000;

// Sweep interval for dormant keys — keeps memory bounded over time.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// Map<key, number[]> — timestamps of recent allowed calls, ascending.
const buckets = new Map();

function makeKey({ teamId, userId } = {}) {
  const team = teamId || 'global';
  const user = userId || 'anonymous';
  return `${team}:${user}`;
}

/**
 * Check whether a call is allowed under the rate limit.
 * Records the call timestamp if allowed.
 *
 * @param {object} opts
 * @param {string} [opts.teamId]
 * @param {string} [opts.userId]
 * @param {number} [opts.max]      max calls per window (default from env / 10)
 * @param {number} [opts.windowMs] window length ms (default from env / 60s)
 * @param {() => number} [opts.now] injectable clock (default Date.now)
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
 */
function checkRateLimit({ teamId, userId, max = DEFAULT_MAX, windowMs = DEFAULT_WINDOW_MS, now = Date.now } = {}) {
  const key = makeKey({ teamId, userId });
  const t = now();

  const limit = max > 0 ? Math.floor(max) : DEFAULT_MAX;
  const window = windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS;

  const windowStart = t - window;
  const arr = buckets.get(key) || [];

  // Prune timestamps that have fallen out of the sliding window.
  let firstValid = 0;
  while (firstValid < arr.length && arr[firstValid] <= windowStart) firstValid++;
  const fresh = firstValid > 0 ? arr.slice(firstValid) : arr;

  if (fresh.length >= limit) {
    // Slot opens when the oldest in-window call expires.
    const oldestInWindow = fresh[0];
    const retryAfterMs = Math.max(0, oldestInWindow + window - t);
    buckets.set(key, fresh);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  fresh.push(t);
  buckets.set(key, fresh);
  return { allowed: true, remaining: Math.max(0, limit - fresh.length), retryAfterMs: 0 };
}

/**
 * Remove all timestamps older than the current window for every key.
 * Called periodically to keep memory bounded when many users cycle through.
 */
function sweepStale({ windowMs = DEFAULT_WINDOW_MS, now = Date.now } = {}) {
  const t = now();
  const window = windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS;
  const windowStart = t - window;
  for (const [key, arr] of buckets) {
    let firstValid = 0;
    while (firstValid < arr.length && arr[firstValid] <= windowStart) firstValid++;
    if (firstValid >= arr.length) {
      buckets.delete(key);
    } else if (firstValid > 0) {
      buckets.set(key, arr.slice(firstValid));
    }
  }
}

// Schedule a periodic sweep. unref'd so it never keeps the process alive.
let sweepTimer = null;
function startSweepTimer() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepStale(), SWEEP_INTERVAL_MS);
  if (sweepTimer.unref) sweepTimer.unref();
}

// Auto-start on first import (safe in tests; timer is unref'd).
startSweepTimer();

/**
 * Build a user-friendly "slow down" message from a retry-after duration.
 */
function formatRetryMessage(retryAfterMs) {
  const secs = Math.ceil((retryAfterMs || 0) / 1000);
  if (secs <= 1) return '🌱 Slow down — try again in a moment.';
  return `🌱 Slow down — you're logging a lot. Try again in ~${secs}s.`;
}

/**
 * Reset all buckets. For testing only.
 */
function reset() {
  buckets.clear();
}

module.exports = {
  checkRateLimit,
  sweepStale,
  formatRetryMessage,
  reset,
};
