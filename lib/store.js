const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const LOG_FILE = path.join(DATA_DIR, 'logs.json');

async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  try {
    await fs.access(LOG_FILE);
  } catch {
    await fs.writeFile(LOG_FILE, '[]\n', { encoding: 'utf8', mode: 0o600 });
  }
}

async function readAllLogs() {
  try {
    await ensureFile();
    const raw = await fs.readFile(LOG_FILE, 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    if (err instanceof SyntaxError) {
      try {
        const backupPath = `${LOG_FILE}.corrupt-${Date.now()}`;
        await fs.rename(LOG_FILE, backupPath);
        console.error(`[store] data/logs.json was corrupted, backed up to ${backupPath}, starting fresh`);
      } catch {
        // backup failed — still proceed with empty array
      }
      return [];
    }
    throw err;
  }
}

let writeChain = Promise.resolve();

async function appendLog(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('appendLog: entry must be an object');
  }
  const enriched = {
    id: entry.id || `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    ...entry,
  };

  // Serialize writes through a single in-process promise chain.
  // Prevents read-modify-write races (writeFile on Windows truncates
  // to 0 bytes before writing — concurrent callers can hit empty state).
  const next = writeChain.then(async () => {
    const logs = await readAllLogs();
    logs.push(enriched);
    await fs.writeFile(LOG_FILE, `${JSON.stringify(logs, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  });
  writeChain = next.catch(() => {}); // keep chain alive on failure
  await next; // surface error to THIS caller's .catch
  return enriched;
}

async function getLogsForRange({ startISO, endISO, channelId } = {}) {
  const logs = await readAllLogs();
  const start = startISO ? new Date(startISO).getTime() : Number.NEGATIVE_INFINITY;
  const end = endISO ? new Date(endISO).getTime() : Number.POSITIVE_INFINITY;
  return logs.filter((l) => {
    const t = new Date(l.timestamp).getTime();
    if (Number.isNaN(t)) return false;
    if (t < start || t > end) return false;
    if (channelId && l.channelId !== channelId) return false;
    return true;
  });
}

async function deleteLogById({ id, userId } = {}) {
  if (!id) return { ok: false, reason: 'no-id' };
  const next = writeChain.then(async () => {
    const logs = await readAllLogs();
    const idx = logs.findIndex((l) => l.id === id);
    if (idx === -1) return { ok: false, reason: 'not-found' };
    const found = logs[idx];
    if (userId && found.userId && found.userId !== userId) {
      return { ok: false, reason: 'not-owner', log: found };
    }
    logs.splice(idx, 1);
    await fs.writeFile(LOG_FILE, `${JSON.stringify(logs, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, deleted: found };
  });
  writeChain = next.catch(() => {});
  return await next;
}
module.exports = { appendLog, readAllLogs, getLogsForRange, deleteLogById, LOG_FILE };
