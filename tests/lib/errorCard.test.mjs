import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildErrorCard } from '../../lib/errorCard.js';

describe('buildErrorCard', () => {
  it('returns blocks with header and fallback text', () => {
    const result = buildErrorCard({ title: 'Test error' });
    assert.ok(result.text.includes('⚠️ Test error'));
    assert.ok(Array.isArray(result.blocks));
    assert.strictEqual(result.blocks[0].type, 'header');
    assert.strictEqual(result.blocks[0].text.text, '⚠️ Test error');
  });

  it('includes body when provided', () => {
    const result = buildErrorCard({ title: 'Oops', body: 'Something broke' });
    assert.ok(result.text.includes('Something broke'));
    assert.strictEqual(result.blocks.length, 2);
    assert.strictEqual(result.blocks[1].type, 'section');
    assert.strictEqual(result.blocks[1].text.text, 'Something broke');
  });

  it('includes hint when provided', () => {
    const result = buildErrorCard({ title: 'Oops', hint: 'Try again later' });
    assert.ok(result.text.includes('Try again later'));
    const hintBlock = result.blocks.find((b) => b.type === 'context');
    assert.ok(hintBlock);
    assert.strictEqual(hintBlock.elements[0].text, '💡 Try again later');
  });

  it('includes all three: title, body, and hint', () => {
    const result = buildErrorCard({
      title: 'Big problem',
      body: 'The server is down',
      hint: 'Check the logs',
    });
    assert.strictEqual(result.blocks.length, 3);
    assert.ok(result.text.includes('Big problem'));
    assert.ok(result.text.includes('The server is down'));
    assert.ok(result.text.includes('Check the logs'));
  });

  it('uses defaults when no args provided', () => {
    const result = buildErrorCard();
    assert.ok(result.text.includes('Something went wrong'));
    assert.strictEqual(result.blocks.length, 1);
  });

  it('uses defaults when empty object', () => {
    const result = buildErrorCard({});
    assert.ok(result.text.includes('Something went wrong'));
    assert.strictEqual(result.blocks.length, 1);
  });
});
