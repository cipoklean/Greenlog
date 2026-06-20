import assert from 'node:assert';
import { describe, it } from 'node:test';
import { impactDots, parseEstimate, sanitizeMrkdwn, splitImpact } from '../../lib/carbonEstimate.js';

describe('splitImpact', () => {
  it('parses "Large positive"', () => {
    const result = splitImpact('Large positive');
    assert.deepStrictEqual(result, { magnitude: 'Large', direction: 'positive' });
  });

  it('parses "Medium negative"', () => {
    const result = splitImpact('Medium negative');
    assert.deepStrictEqual(result, { magnitude: 'Medium', direction: 'negative' });
  });

  it('parses "Small neutral"', () => {
    const result = splitImpact('Small neutral');
    assert.deepStrictEqual(result, { magnitude: 'Small', direction: 'neutral' });
  });

  it('parses "Negligible neutral"', () => {
    const result = splitImpact('Negligible neutral');
    assert.deepStrictEqual(result, { magnitude: 'Negligible', direction: 'neutral' });
  });

  it('is case-insensitive', () => {
    const result = splitImpact('LARGE POSITIVE');
    assert.deepStrictEqual(result, { magnitude: 'Large', direction: 'positive' });
  });

  it('returns nulls for empty string', () => {
    const result = splitImpact('');
    assert.deepStrictEqual(result, { magnitude: null, direction: null });
  });

  it('returns nulls for null/undefined', () => {
    assert.deepStrictEqual(splitImpact(null), { magnitude: null, direction: null });
    assert.deepStrictEqual(splitImpact(undefined), { magnitude: null, direction: null });
  });

  it('returns nulls for invalid format', () => {
    const result = splitImpact('garbage text here');
    assert.deepStrictEqual(result, { magnitude: null, direction: null });
  });

  it('returns nulls for partial match (only magnitude)', () => {
    const result = splitImpact('Large');
    assert.deepStrictEqual(result, { magnitude: null, direction: null });
  });
});

describe('parseEstimate', () => {
  it('parses a well-formed LLM response', () => {
    const raw = ['Impact: Large positive', 'Category: Energy', 'Why: Switched to renewables'].join('\n');
    const result = parseEstimate(raw);
    assert.deepStrictEqual(result, {
      impact: 'Large positive',
      category: 'Energy',
      why: 'Switched to renewables',
    });
  });

  it('handles extra whitespace around colons', () => {
    const raw = 'Impact  :  Medium negative\nCategory : Transport\nWhy : Reduced flights';
    const result = parseEstimate(raw);
    assert.deepStrictEqual(result, {
      impact: 'Medium negative',
      category: 'Transport',
      why: 'Reduced flights',
    });
  });

  it('is case-insensitive for keys', () => {
    const raw = 'IMPACT: Small neutral\ncategory: Digital\nWHY: Less data transfer';
    const result = parseEstimate(raw);
    assert.deepStrictEqual(result, {
      impact: 'Small neutral',
      category: 'Digital',
      why: 'Less data transfer',
    });
  });

  it('returns nulls for missing fields', () => {
    const raw = 'Impact: Large positive';
    const result = parseEstimate(raw);
    assert.deepStrictEqual(result, { impact: 'Large positive', category: null, why: null });
  });

  it('returns nulls for empty input', () => {
    const result = parseEstimate('');
    assert.deepStrictEqual(result, { impact: null, category: null, why: null });
  });

  it('returns nulls for unrecognized format', () => {
    const raw = 'This is not the expected format at all';
    const result = parseEstimate(raw);
    assert.deepStrictEqual(result, { impact: null, category: null, why: null });
  });
});

describe('impactDots', () => {
  it('returns 3 green dots for Large positive', () => {
    assert.strictEqual(impactDots('Large positive'), '🟢🟢🟢');
  });

  it('returns 3 red dots for Large negative', () => {
    assert.strictEqual(impactDots('Large negative'), '🔴🔴🔴');
  });

  it('returns 2 green dots for Medium positive', () => {
    assert.strictEqual(impactDots('Medium positive'), '🟢🟢');
  });

  it('returns 1 dot for Small', () => {
    assert.strictEqual(impactDots('Small positive'), '🟢');
    assert.strictEqual(impactDots('Small negative'), '🔴');
    assert.strictEqual(impactDots('Small neutral'), '⚪');
  });

  it('returns single dot for Negligible', () => {
    assert.strictEqual(impactDots('Negligible neutral'), '⚪');
    assert.strictEqual(impactDots('Negligible positive'), '🟢');
  });

  it('handles case-insensitive', () => {
    assert.strictEqual(impactDots('LARGE POSITIVE'), '🟢🟢🟢');
  });

  it('returns neutral dot for null/undefined', () => {
    assert.strictEqual(impactDots(null), '⚪');
    assert.strictEqual(impactDots(undefined), '⚪');
    assert.strictEqual(impactDots(''), '⚪');
  });
});

describe('sanitizeMrkdwn', () => {
  it('returns non-string input unchanged', () => {
    assert.strictEqual(sanitizeMrkdwn(null), null);
    assert.strictEqual(sanitizeMrkdwn(undefined), undefined);
    assert.strictEqual(sanitizeMrkdwn(42), 42);
  });

  it('returns string with no angle brackets unchanged', () => {
    assert.strictEqual(sanitizeMrkdwn('Switched to renewables'), 'Switched to renewables');
  });

  it('neutralizes broadcast mentions <!channel>, <!here>, <!everyone>', () => {
    assert.strictEqual(sanitizeMrkdwn('<!channel> look'), '＜!channel＞ look');
    assert.strictEqual(sanitizeMrkdwn('ping <!here>'), 'ping ＜!here＞');
  });

  it('neutralizes user mentions <@U123>', () => {
    assert.strictEqual(sanitizeMrkdwn('cc <@U12345>'), 'cc ＜@U12345＞');
  });

  it('neutralizes channel mentions <#C123|general>', () => {
    assert.strictEqual(sanitizeMrkdwn('see <#C12345|general>'), 'see ＜#C12345|general＞');
  });

  it('neutralizes link syntax <http://evil.com|click here>', () => {
    assert.strictEqual(sanitizeMrkdwn('<http://evil.com|click here>'), '＜http://evil.com|click here＞');
  });

  it('handles multiple bracket pairs in one string', () => {
    assert.strictEqual(
      sanitizeMrkdwn('<@U1> and <#C2|chan> and <!channel>'),
      '＜@U1＞ and ＜#C2|chan＞ and ＜!channel＞',
    );
  });

  it('returns empty string unchanged', () => {
    assert.strictEqual(sanitizeMrkdwn(''), '');
  });

  it('does not touch other markdown like *bold* or _italic_', () => {
    assert.strictEqual(sanitizeMrkdwn('*bold* _italic_ ~strike~'), '*bold* _italic_ ~strike~');
  });
});
