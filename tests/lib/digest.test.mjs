import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  aggregateLogs,
  getCurrentWeekRange,
  renderDigestBlocks,
  renderDigestText,
  toDisplayDateString,
  toLocalDateString,
} from '../../lib/digest.js';

// Helper: create a minimal log entry
function makeLog(overrides = {}) {
  return {
    id: 'test-1',
    timestamp: '2026-06-15T10:00:00.000Z',
    decision: 'Test decision',
    impact: 'Medium positive',
    magnitude: 'Medium',
    direction: 'positive',
    category: 'Energy',
    why: 'Because reasons',
    source: 'slash',
    userId: 'U123',
    channelId: 'C456',
    ...overrides,
  };
}

describe('aggregateLogs', () => {
  it('returns empty summary for empty array', () => {
    const result = aggregateLogs([]);
    assert.strictEqual(result.totalCount, 0);
    assert.deepStrictEqual(result.byDirection, { positive: 0, negative: 0, neutral: 0 });
    assert.deepStrictEqual(result.byMagnitude, { Large: 0, Medium: 0, Small: 0, Negligible: 0 });
    assert.strictEqual(result.topPositive, null);
    assert.strictEqual(result.topNegative, null);
  });

  it('counts total logs', () => {
    const result = aggregateLogs([makeLog(), makeLog({ id: 'test-2' }), makeLog({ id: 'test-3' })]);
    assert.strictEqual(result.totalCount, 3);
  });

  it('aggregates by direction', () => {
    const logs = [
      makeLog({ direction: 'positive', impact: 'Medium positive' }),
      makeLog({ id: 'test-2', direction: 'positive', impact: 'Small positive', magnitude: 'Small' }),
      makeLog({ id: 'test-3', direction: 'negative', impact: 'Large negative', magnitude: 'Large' }),
      makeLog({ id: 'test-4', direction: 'neutral' }),
    ];
    const result = aggregateLogs(logs);
    assert.strictEqual(result.byDirection.positive, 2);
    assert.strictEqual(result.byDirection.negative, 1);
    assert.strictEqual(result.byDirection.neutral, 1);
  });

  it('aggregates by magnitude', () => {
    const logs = [
      makeLog({ magnitude: 'Large' }),
      makeLog({ id: 'test-2', magnitude: 'Large' }),
      makeLog({ id: 'test-3', magnitude: 'Medium' }),
      makeLog({ id: 'test-4', magnitude: 'Small' }),
      makeLog({ id: 'test-5', magnitude: 'Negligible' }),
    ];
    const result = aggregateLogs(logs);
    assert.strictEqual(result.byMagnitude.Large, 2);
    assert.strictEqual(result.byMagnitude.Medium, 1);
    assert.strictEqual(result.byMagnitude.Small, 1);
    assert.strictEqual(result.byMagnitude.Negligible, 1);
  });

  it('aggregates by category', () => {
    const logs = [
      makeLog({ category: 'Energy' }),
      makeLog({ id: 'test-2', category: 'Energy' }),
      makeLog({ id: 'test-3', category: 'Transport' }),
      makeLog({ id: 'test-4', category: 'Digital' }),
      makeLog({ id: 'test-5', category: 'Digital' }),
      makeLog({ id: 'test-6', category: 'Digital' }),
    ];
    const result = aggregateLogs(logs);
    assert.strictEqual(result.byCategory.Energy, 2);
    assert.strictEqual(result.byCategory.Transport, 1);
    assert.strictEqual(result.byCategory.Digital, 3);
  });

  it('aggregates by source', () => {
    const logs = [
      makeLog({ source: 'slash' }),
      makeLog({ id: 'test-2', source: 'mention-direct' }),
      makeLog({ id: 'test-3', source: 'mention-thread' }),
    ];
    const result = aggregateLogs(logs);
    assert.strictEqual(result.bySource.slash, 1);
    assert.strictEqual(result.bySource['mention-direct'], 1);
    assert.strictEqual(result.bySource['mention-thread'], 1);
  });

  it('maps unknown source to "other"', () => {
    const logs = [makeLog({ source: 'weird-source' })];
    const result = aggregateLogs(logs);
    assert.strictEqual(result.bySource.other, 1);
  });

  it('uses "Uncategorized" for missing category', () => {
    const logs = [makeLog({ category: undefined })];
    const result = aggregateLogs(logs);
    assert.strictEqual(result.byCategory.Uncategorized, 1);
  });

  it('finds top positive by magnitude rank', () => {
    const logs = [
      makeLog({ id: 'a', direction: 'positive', magnitude: 'Small', decision: 'small' }),
      makeLog({ id: 'b', direction: 'positive', magnitude: 'Large', decision: 'big win' }),
      makeLog({ id: 'c', direction: 'positive', magnitude: 'Medium', decision: 'ok' }),
    ];
    const result = aggregateLogs(logs);
    assert.strictEqual(result.topPositive.decision, 'big win');
    assert.strictEqual(result.topPositive.id, 'b');
  });

  it('finds top negative by magnitude rank', () => {
    const logs = [
      makeLog({ id: 'a', direction: 'negative', magnitude: 'Medium', decision: 'bad' }),
      makeLog({ id: 'b', direction: 'negative', magnitude: 'Large', decision: 'worst' }),
    ];
    const result = aggregateLogs(logs);
    assert.strictEqual(result.topNegative.decision, 'worst');
    assert.strictEqual(result.topNegative.id, 'b');
  });
});

describe('renderDigestText', () => {
  const range = { startISO: '2026-06-08T00:00:00.000Z', endISO: '2026-06-15T00:00:00.000Z', tz: 'UTC' };

  it('renders empty digest message', () => {
    const digest = {
      range,
      logs: [],
      summary: {
        totalCount: 0,
        byCategory: {},
        byDirection: { positive: 0, negative: 0, neutral: 0 },
        byMagnitude: {},
        bySource: { slash: 0, 'mention-direct': 0, 'mention-thread': 0, other: 0 },
        topPositive: null,
        topNegative: null,
      },
    };
    const text = renderDigestText(digest);
    assert.ok(text.includes('No sustainability decisions logged'));
    assert.ok(text.includes('weekly digest'));
  });

  it('renders non-empty digest with counts', () => {
    const digest = {
      range,
      logs: [makeLog()],
      summary: {
        totalCount: 1,
        byCategory: { Energy: 1 },
        byDirection: { positive: 1, negative: 0, neutral: 0 },
        byMagnitude: { Large: 0, Medium: 1, Small: 0, Negligible: 0 },
        bySource: { slash: 1, 'mention-direct': 0, 'mention-thread': 0, other: 0 },
        topPositive: makeLog({ decision: 'Big win' }),
        topNegative: null,
      },
    };
    const text = renderDigestText(digest);
    assert.ok(text.includes('*1* decision logged'));
    assert.ok(text.includes('positive'));
    assert.ok(text.includes('Energy'));
    assert.ok(text.includes('Big win'));
  });

  it('uses singular "decision" for count of 1', () => {
    const digest = {
      range,
      logs: [makeLog()],
      summary: {
        totalCount: 1,
        byCategory: {},
        byDirection: { positive: 0, negative: 0, neutral: 0 },
        byMagnitude: {},
        bySource: { slash: 0, 'mention-direct': 0, 'mention-thread': 0, other: 0 },
        topPositive: null,
        topNegative: null,
      },
    };
    const text = renderDigestText(digest);
    assert.ok(text.includes('*1* decision logged'));
  });

  it('uses plural "decisions" for count > 1', () => {
    const digest = {
      range,
      logs: [makeLog(), makeLog({ id: 'test-2' })],
      summary: {
        totalCount: 2,
        byCategory: {},
        byDirection: { positive: 0, negative: 0, neutral: 0 },
        byMagnitude: {},
        bySource: { slash: 0, 'mention-direct': 0, 'mention-thread': 0, other: 0 },
        topPositive: null,
        topNegative: null,
      },
    };
    const text = renderDigestText(digest);
    assert.ok(text.includes('*2* decisions logged'));
  });

  it('shows top negative when present', () => {
    const digest = {
      range,
      logs: [makeLog({ direction: 'negative', decision: 'Bad thing', magnitude: 'Large' })],
      summary: {
        totalCount: 1,
        byCategory: {},
        byDirection: { positive: 0, negative: 1, neutral: 0 },
        byMagnitude: { Large: 1, Medium: 0, Small: 0, Negligible: 0 },
        bySource: { slash: 0, 'mention-direct': 0, 'mention-thread': 0, other: 0 },
        topPositive: null,
        topNegative: makeLog({ direction: 'negative', decision: 'Bad thing', magnitude: 'Large' }),
      },
    };
    const text = renderDigestText(digest);
    assert.ok(text.includes('Top negative impact'));
    assert.ok(text.includes('Bad thing'));
  });

  it('includes channel-scoped indicator', () => {
    const digest = {
      range,
      logs: [],
      summary: {
        totalCount: 0,
        byCategory: {},
        byDirection: { positive: 0, negative: 0, neutral: 0 },
        byMagnitude: {},
        bySource: { slash: 0, 'mention-direct': 0, 'mention-thread': 0, other: 0 },
        topPositive: null,
        topNegative: null,
      },
    };
    const text = renderDigestText(digest, { channelScoped: true });
    assert.ok(text.includes('this channel'));
  });
});

describe('renderDigestBlocks', () => {
  const range = { startISO: '2026-06-08T00:00:00.000Z', endISO: '2026-06-15T00:00:00.000Z', tz: 'UTC' };

  it('returns an array of blocks', () => {
    const digest = {
      range,
      logs: [],
      summary: {
        totalCount: 0,
        byCategory: {},
        byDirection: { positive: 0, negative: 0, neutral: 0 },
        byMagnitude: {},
        bySource: { slash: 0, 'mention-direct': 0, 'mention-thread': 0, other: 0 },
        topPositive: null,
        topNegative: null,
      },
    };
    const blocks = renderDigestBlocks(digest);
    assert.ok(Array.isArray(blocks));
    assert.ok(blocks.length > 0);
    assert.strictEqual(blocks[0].type, 'header');
  });

  it('shows empty state for no logs', () => {
    const digest = {
      range,
      logs: [],
      summary: {
        totalCount: 0,
        byCategory: {},
        byDirection: { positive: 0, negative: 0, neutral: 0 },
        byMagnitude: {},
        bySource: { slash: 0, 'mention-direct': 0, 'mention-thread': 0, other: 0 },
        topPositive: null,
        topNegative: null,
      },
    };
    const blocks = renderDigestBlocks(digest);
    const hasEmptyMsg = blocks.some((b) => b.type === 'section' && b.text?.text?.includes('No sustainability'));
    assert.ok(hasEmptyMsg);
  });

  it('includes canvas button when canvasUrl is provided', () => {
    const digest = {
      range,
      logs: [makeLog()],
      summary: {
        totalCount: 1,
        byCategory: { Energy: 1 },
        byDirection: { positive: 1, negative: 0, neutral: 0 },
        byMagnitude: { Large: 0, Medium: 1, Small: 0, Negligible: 0 },
        bySource: { slash: 1, 'mention-direct': 0, 'mention-thread': 0, other: 0 },
        topPositive: makeLog(),
        topNegative: null,
      },
    };
    const blocks = renderDigestBlocks(digest, { canvasUrl: 'https://slack.com/canvas/123' });
    const btn = blocks.find((b) => b.type === 'actions');
    assert.ok(btn);
    assert.strictEqual(btn.elements[0].url, 'https://slack.com/canvas/123');
  });

  it('omits canvas button when no canvasUrl', () => {
    const digest = {
      range,
      logs: [makeLog()],
      summary: {
        totalCount: 1,
        byCategory: { Energy: 1 },
        byDirection: { positive: 1, negative: 0, neutral: 0 },
        byMagnitude: { Large: 0, Medium: 1, Small: 0, Negligible: 0 },
        bySource: { slash: 1, 'mention-direct': 0, 'mention-thread': 0, other: 0 },
        topPositive: null,
        topNegative: null,
      },
    };
    const blocks = renderDigestBlocks(digest);
    const btn = blocks.find((b) => b.type === 'actions');
    assert.strictEqual(btn, undefined);
  });
});

describe('toLocalDateString', () => {
  it('formats a UTC date in UTC', () => {
    const d = new Date('2026-06-15T12:00:00Z');
    assert.strictEqual(toLocalDateString(d, 'UTC'), '2026-06-15');
  });

  it('formats a date in a different timezone', () => {
    // 2026-06-15 00:00 UTC = 2026-06-14 20:00 in America/New_York (UTC-4)
    const d = new Date('2026-06-15T00:00:00Z');
    const result = toLocalDateString(d, 'America/New_York');
    assert.strictEqual(result, '2026-06-14');
  });
});

describe('toDisplayDateString', () => {
  it('converts ISO string to local date', () => {
    const result = toDisplayDateString('2026-06-15T10:00:00Z', 'UTC');
    assert.strictEqual(result, '2026-06-15');
  });
});

describe('getCurrentWeekRange', () => {
  it('returns a Monday-to-Monday week range in UTC', () => {
    // June 15, 2026 is a Monday
    const monday = new Date('2026-06-15T12:00:00Z');
    const range = getCurrentWeekRange(monday, 'UTC');
    assert.strictEqual(range.startISO, '2026-06-15T00:00:00.000Z');
    assert.strictEqual(range.endISO, '2026-06-22T00:00:00.000Z');
    assert.strictEqual(range.tz, 'UTC');
  });

  it('returns a Monday-to-Monday range for a mid-week day', () => {
    // June 18, 2026 is a Thursday
    const thursday = new Date('2026-06-18T12:00:00Z');
    const range = getCurrentWeekRange(thursday, 'UTC');
    assert.strictEqual(range.startISO, '2026-06-15T00:00:00.000Z');
    assert.strictEqual(range.endISO, '2026-06-22T00:00:00.000Z');
  });

  it('returns a week range for a Sunday (start of previous Monday)', () => {
    // June 21, 2026 is a Sunday
    const sunday = new Date('2026-06-21T12:00:00Z');
    const range = getCurrentWeekRange(sunday, 'UTC');
    assert.strictEqual(range.startISO, '2026-06-15T00:00:00.000Z');
    assert.strictEqual(range.endISO, '2026-06-22T00:00:00.000Z');
  });
});
