import assert from 'node:assert';
import { describe, it } from 'node:test';
import { isValidTimezone, workspaceKey } from '../../lib/configStore.js';

describe('isValidTimezone', () => {
  it('accepts UTC', () => {
    assert.strictEqual(isValidTimezone('UTC'), true);
  });

  it('accepts common IANA timezones', () => {
    assert.strictEqual(isValidTimezone('America/New_York'), true);
    assert.strictEqual(isValidTimezone('Europe/London'), true);
    assert.strictEqual(isValidTimezone('Asia/Tokyo'), true);
    assert.strictEqual(isValidTimezone('Australia/Sydney'), true);
    assert.strictEqual(isValidTimezone('Pacific/Auckland'), true);
  });

  it('accepts Africa and other region timezones', () => {
    assert.strictEqual(isValidTimezone('Africa/Cairo'), true);
    assert.strictEqual(isValidTimezone('Asia/Kolkata'), true);
    assert.strictEqual(isValidTimezone('America/Los_Angeles'), true);
  });

  it('rejects invalid timezone strings', () => {
    assert.strictEqual(isValidTimezone('NotATimezone'), false);
    assert.strictEqual(isValidTimezone('Mars/Olympus'), false);
    assert.strictEqual(isValidTimezone(''), false);
  });

  it('rejects null/undefined/non-string', () => {
    assert.strictEqual(isValidTimezone(null), false);
    assert.strictEqual(isValidTimezone(undefined), false);
    assert.strictEqual(isValidTimezone(123), false);
    assert.strictEqual(isValidTimezone({}), false);
  });

  it('rejects whitespace-only strings', () => {
    assert.strictEqual(isValidTimezone('   '), false);
  });
});

describe('workspaceKey', () => {
  it('prefers enterprise_id (snake_case)', () => {
    const key = workspaceKey({ enterprise_id: 'E123', team_id: 'T456' });
    assert.strictEqual(key, 'E123');
  });

  it('prefers enterprise_id (camelCase)', () => {
    const key = workspaceKey({ enterpriseId: 'E789', teamId: 'T012' });
    assert.strictEqual(key, 'E789');
  });

  it('falls back to team_id when no enterprise_id', () => {
    const key = workspaceKey({ team_id: 'T456' });
    assert.strictEqual(key, 'T456');
  });

  it('falls back to teamId when no enterprise', () => {
    const key = workspaceKey({ teamId: 'T012' });
    assert.strictEqual(key, 'T012');
  });

  it('returns null for empty object', () => {
    assert.strictEqual(workspaceKey({}), null);
  });

  it('throws on null (no null guard)', () => {
    assert.throws(() => workspaceKey(null), /Cannot read properties/);
  });

  it('returns null when called with no args', () => {
    assert.strictEqual(workspaceKey(), null);
  });
});
