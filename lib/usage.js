const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Lightweight mention-usage tracking.
 *
 * Mentions (@GreenLog) are ephemeral estimates — they are NOT logged as
 * decisions. But we still want the weekly digest's Sources line to reflect
 * how many times the bot was actually used. This file records only a
 * timestamp + source type (+ optional channel), deliberately keeping it
 * separate from data/logs.json so the decision list stays clean.
 *
 * File: data/usage.json — array of { timestamp, source, channelId } records.
 * Write-mutex protected, same corrupt-JSON recovery as the log store.
 */

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  try {
    await fs.access(USAGE_FILE);
  } catch {
    await fs.writeFile(USAGE_FILE, '[]\n', { encoding: 'utf8', mode: 0o600 });
  }
}

async function readAllUsage() {
  try {
    await ensureFile();
    const raw = await fs.readFile(USAGE_FILE, 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    if (err instanceof SyntaxError) {
      try {
        const backupPath = `${USAGE_FILE}.corrupt-${Date.now()}`;
        await fs.rename(USAGE_FILE, backupPath);
        console.error(`[usage] data/usage.json was corrupted, backed up to ${backupPath}, starting fresh`);
      } catch {
        // backup failed — still proceed with empty array
      }
      return [];
    }
    throw err;
  }
}

let writeChain = Promise.resolve();

/**
 * Record one mention usage event. Failures are swallowed (a failed usage
 * counter write must never break the user's estimate reply).
 *
 * @param {{ source?: string, channelId?: string|null, timestamp?: string }} entry
 * @returns {Promise<object|null>} the stored record, or null on failure
 */
async function recordUsage(entry = {}) {
  const enriched = {
    timestamp: entry.timestamp || new Date().toISOString(),
    source: entry.source || 'mention-direct',
    channelId: entry.channelId || null,
  };
  try {
    const next = writeChain.then(async () => {
      const all = await readAllUsage();
      all.push(enriched);
      await fs.writeFile(USAGE_FILE, `${JSON.stringify(all, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    });
    writeChain = next.catch(() => {});
    await next;
    return enriched;
  } catch {
    return null;
  }
}

/**
 * Count usage events of each source type within an ISO date range.
 *
 * @param {{ startISO?: string, endISO?: string }} range
 * @returns {Promise<{ 'mention-direct': number, 'mention-thread': number, other: number, total: number }>}
 */
async function countUsageBySource({ startISO, endISO } = {}) {
  const all = await readAllUsage();
  const start = startISO ? new Date(startISO).getTime() : Number.NEGATIVE_INFINITY;
  const end = endISO ? new Date(endISO).getTime() : Number.POSITIVE_INFINITY;
  const counts = { 'mention-direct': 0, 'mention-thread': 0, other: 0, total: 0 };
  for (const u of all) {
    const t = new Date(u.timestamp).getTime();
    if (Number.isNaN(t)) continue;
    if (t < start || t >= end) continue;
    counts.total++;
    if (counts[u.source] !== undefined && u.source !== 'other') counts[u.source]++;
    else counts.other++;
  }
  return counts;
}

module.exports = {
  recordUsage,
  readAllUsage,
  countUsageBySource,
  USAGE_FILE,
};
