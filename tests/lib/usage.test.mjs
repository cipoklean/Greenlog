import assert from 'node:assert';
import { beforeEach, describe, it, mock } from 'node:test';

// Virtual filesystem — must exist before mock.module runs
const vfs = {};

// Toggle: when true, writeFile rejects. Used to exercise recordUsage's
// failure-swallowing try/catch.
let writeFileShouldFail = false;

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
    if (writeFileShouldFail) throw new Error('disk full');
    vfs[path] = data;
  }),
  rename: mock.fn(async (oldPath, newPath) => {
    if (oldPath in vfs) {
      vfs[newPath] = vfs[oldPath];
      delete vfs[oldPath];
    }
  }),
};

// Mock fs/promises BEFORE usage.js is imported
mock.module('node:fs/promises', {
  defaultExport: fsMock,
  namedExports: fsMock,
});

const usage = await import('../../lib/usage.js');

beforeEach(() => {
  for (const key of Object.keys(vfs)) delete vfs[key];
  writeFileShouldFail = false;
});

describe('readAllUsage', () => {
  it('returns empty array for a fresh file', async () => {
    const all = await usage.readAllUsage();
    assert.deepStrictEqual(all, []);
  });

  it('returns parsed usage records from existing file', async () => {
    vfs[usage.USAGE_FILE] = JSON.stringify([{ timestamp: '2026-06-15T10:00:00.000Z', source: 'mention-direct' }]);
    const all = await usage.readAllUsage();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].source, 'mention-direct');
  });

  it('recovers from corrupt JSON by renaming and starting fresh', async () => {
    vfs[usage.USAGE_FILE] = '{invalid json!!!';
    const all = await usage.readAllUsage();
    assert.deepStrictEqual(all, []);
    const renameCalls = fsMock.rename.mock.calls.filter((c) => c.arguments[0] === usage.USAGE_FILE);
    assert.ok(renameCalls.length > 0, 'should rename corrupt file');
  });
});

describe('recordUsage', () => {
  it('appends a usage record with auto timestamp and default source', async () => {
    const result = await usage.recordUsage({});
    assert.ok(result.timestamp, 'should have a timestamp');
    assert.strictEqual(result.source, 'mention-direct');
  });

  it('persists the record so it shows up on next read', async () => {
    await usage.recordUsage({ source: 'mention-thread', channelId: 'C123' });
    await usage.recordUsage({ source: 'mention-direct', channelId: 'C456' });
    const all = await usage.readAllUsage();
    assert.strictEqual(all.length, 2);
    assert.strictEqual(all[0].source, 'mention-thread');
    assert.strictEqual(all[1].channelId, 'C456');
  });

  it('resolves null instead of throwing when the write fails', async () => {
    writeFileShouldFail = true;
    const result = await usage.recordUsage({});
    assert.strictEqual(result, null);
  });
});

describe('countUsageBySource', () => {
  it('counts nothing when usage file is empty', async () => {
    const counts = await usage.countUsageBySource({
      startISO: '2026-06-08T00:00:00.000Z',
      endISO: '2026-06-15T00:00:00.000Z',
    });
    assert.deepStrictEqual(counts, {
      'mention-direct': 0,
      'mention-thread': 0,
      other: 0,
      total: 0,
    });
  });

  it('counts direct + thread mentions within range', async () => {
    await usage.recordUsage({ source: 'mention-direct', timestamp: '2026-06-10T10:00:00.000Z' });
    await usage.recordUsage({ source: 'mention-direct', timestamp: '2026-06-11T10:00:00.000Z' });
    await usage.recordUsage({ source: 'mention-thread', timestamp: '2026-06-12T10:00:00.000Z' });
    const counts = await usage.countUsageBySource({
      startISO: '2026-06-08T00:00:00.000Z',
      endISO: '2026-06-15T00:00:00.000Z',
    });
    assert.strictEqual(counts['mention-direct'], 2);
    assert.strictEqual(counts['mention-thread'], 1);
    assert.strictEqual(counts.total, 3);
  });

  it('excludes usage outside the date range', async () => {
    await usage.recordUsage({ source: 'mention-direct', timestamp: '2026-06-01T10:00:00.000Z' }); // before
    await usage.recordUsage({ source: 'mention-direct', timestamp: '2026-06-10T10:00:00.000Z' }); // in range
    await usage.recordUsage({ source: 'mention-direct', timestamp: '2026-06-20T10:00:00.000Z' }); // after
    const counts = await usage.countUsageBySource({
      startISO: '2026-06-08T00:00:00.000Z',
      endISO: '2026-06-15T00:00:00.000Z',
    });
    assert.strictEqual(counts.total, 1);
  });

  it('counts unknown source types under other', async () => {
    await usage.recordUsage({ source: 'weird', timestamp: '2026-06-10T10:00:00.000Z' });
    const counts = await usage.countUsageBySource({
      startISO: '2026-06-08T00:00:00.000Z',
      endISO: '2026-06-15T00:00:00.000Z',
    });
    assert.strictEqual(counts.other, 1);
    assert.strictEqual(counts.total, 1);
  });

  it('ignores records with invalid timestamps', async () => {
    await usage.recordUsage({ source: 'mention-direct', timestamp: 'not-a-date' });
    const counts = await usage.countUsageBySource();
    assert.strictEqual(counts.total, 0);
  });
});
