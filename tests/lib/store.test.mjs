import assert from 'node:assert';
import { beforeEach, describe, it, mock } from 'node:test';

// Virtual filesystem — must exist before mock.module runs
const vfs = {};

// Build mock functions directly (not inside beforeEach)
const fsMock = {
  mkdir: mock.fn(async (_dir, _opts) => {}),
  access: mock.fn(async (path) => {
    if (!(path in vfs)) {
      const err = new Error('ENOENT: no such file');
      err.code = 'ENOENT';
      throw err;
    }
  }),
  readFile: mock.fn(async (path, _encoding) => {
    if (!(path in vfs)) {
      const err = new Error('ENOENT: no such file');
      err.code = 'ENOENT';
      throw err;
    }
    return vfs[path];
  }),
  writeFile: mock.fn(async (path, data, _encoding) => {
    vfs[path] = data;
  }),
  rename: mock.fn(async (oldPath, newPath) => {
    if (oldPath in vfs) {
      vfs[newPath] = vfs[oldPath];
      delete vfs[oldPath];
    }
  }),
};

// Mock fs/promises BEFORE store.js is imported
mock.module('node:fs/promises', {
  defaultExport: fsMock,
  namedExports: fsMock,
});

// Now import store — it will use mocked fs
const store = await import('../../lib/store.js');

// Reset VFS between tests
beforeEach(() => {
  for (const key of Object.keys(vfs)) delete vfs[key];
  fsMock.mkdir.mock.resetCalls();
  fsMock.access.mock.resetCalls();
  fsMock.readFile.mock.resetCalls();
  fsMock.writeFile.mock.resetCalls();
  fsMock.rename.mock.resetCalls();
});

describe('readAllLogs', () => {
  it('returns empty array for new file', async () => {
    const logs = await store.readAllLogs();
    assert.deepStrictEqual(logs, []);
    assert.ok(fsMock.writeFile.mock.calls.length > 0, 'should create initial file');
  });

  it('returns parsed logs from existing file', async () => {
    vfs[store.LOG_FILE] = JSON.stringify([{ id: '1', decision: 'Test', timestamp: '2026-01-01T00:00:00.000Z' }]);
    const logs = await store.readAllLogs();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].id, '1');
  });

  it('returns empty array for empty file', async () => {
    vfs[store.LOG_FILE] = '';
    const logs = await store.readAllLogs();
    assert.deepStrictEqual(logs, []);
  });

  it('returns empty array for whitespace-only file', async () => {
    vfs[store.LOG_FILE] = '   \n  ';
    const logs = await store.readAllLogs();
    assert.deepStrictEqual(logs, []);
  });

  it('handles corrupt JSON by renaming and returning empty', async () => {
    vfs[store.LOG_FILE] = '{invalid json!!!';
    const logs = await store.readAllLogs();
    assert.deepStrictEqual(logs, []);
    const renameCalls = fsMock.rename.mock.calls.filter((c) => c.arguments[0] === store.LOG_FILE);
    assert.ok(renameCalls.length > 0, 'should rename corrupt file');
  });
});

describe('appendLog', () => {
  it('throws on non-object entry', async () => {
    await assert.rejects(() => store.appendLog(null), /entry must be an object/);
  });

  it('appends a log entry with auto-generated id and timestamp', async () => {
    const entry = { decision: 'Switched to LEDs', impact: 'Medium positive' };
    const result = await store.appendLog(entry);
    assert.ok(result.id, 'should have an id');
    assert.ok(result.timestamp, 'should have a timestamp');
    assert.strictEqual(result.decision, 'Switched to LEDs');
  });

  it('preserves provided id and timestamp', async () => {
    const result = await store.appendLog({
      id: 'custom-id',
      timestamp: '2026-01-01T00:00:00.000Z',
      decision: 'Test',
    });
    assert.strictEqual(result.id, 'custom-id');
    assert.strictEqual(result.timestamp, '2026-01-01T00:00:00.000Z');
  });

  it('persists to the log file', async () => {
    await store.appendLog({ decision: 'First' });
    await store.appendLog({ decision: 'Second' });
    const logs = await store.readAllLogs();
    assert.strictEqual(logs.length, 2);
  });
});

describe('getLogsForRange', () => {
  it('filters by date range', async () => {
    await store.appendLog({ decision: 'A', timestamp: '2026-06-10T10:00:00.000Z' });
    await store.appendLog({ decision: 'B', timestamp: '2026-06-12T10:00:00.000Z' });
    await store.appendLog({ decision: 'C', timestamp: '2026-06-14T10:00:00.000Z' });

    const logs = await store.getLogsForRange({
      startISO: '2026-06-11T00:00:00.000Z',
      endISO: '2026-06-13T00:00:00.000Z',
    });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].decision, 'B');
  });

  it('filters by channelId', async () => {
    await store.appendLog({ decision: 'Ch1', channelId: 'C1', timestamp: '2026-06-10T10:00:00.000Z' });
    await store.appendLog({ decision: 'Ch2', channelId: 'C2', timestamp: '2026-06-10T10:00:00.000Z' });
    const logs = await store.getLogsForRange({ channelId: 'C1' });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].channelId, 'C1');
  });

  it('skips entries with invalid timestamps', async () => {
    await store.appendLog({ decision: 'Bad', timestamp: 'not-a-date' });
    const logs = await store.getLogsForRange();
    assert.strictEqual(logs.length, 0);
  });
});

describe('deleteLogById', () => {
  it('returns not-found for missing id', async () => {
    const result = await store.deleteLogById({ id: 'nonexistent' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'not-found');
  });

  it('returns no-id when id is missing', async () => {
    const result = await store.deleteLogById({});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'no-id');
  });

  it('deletes an existing log', async () => {
    const entry = await store.appendLog({ decision: 'Delete me' });
    const result = await store.deleteLogById({ id: entry.id });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.deleted.decision, 'Delete me');
    const logs = await store.readAllLogs();
    assert.strictEqual(logs.length, 0);
  });

  it('enforces ownership check', async () => {
    const entry = await store.appendLog({ decision: 'Mine', userId: 'U123' });
    const result = await store.deleteLogById({ id: entry.id, userId: 'U999' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'not-owner');
    const logs = await store.readAllLogs();
    assert.strictEqual(logs.length, 1);
  });

  it('allows delete when log has no userId', async () => {
    const entry = await store.appendLog({ decision: 'No owner' });
    const result = await store.deleteLogById({ id: entry.id, userId: 'U999' });
    assert.strictEqual(result.ok, true);
  });
});
