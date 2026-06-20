const { getConfig, setTimezone, isValidTimezone, workspaceKey } = require('./configStore');

async function ensureWorkspaceTimezone({ teamId, enterpriseId, userId, client, logger }) {
  const key = workspaceKey({ team_id: teamId, enterprise_id: enterpriseId });
  if (!key || !userId || !client) {
    return { detected: false, timezone: null, source: 'skipped' };
  }
  try {
    const existing = await getConfig(key);
    if (existing.timezone) {
      return { detected: false, timezone: existing.timezone, source: 'existing' };
    }
    const info = await client.users.info({ user: userId });
    const tz = info?.user?.tz;
    if (!tz || !isValidTimezone(tz)) {
      logger?.warn?.(`[greenlog onboarding] users.info returned no usable tz for ${userId} (got: ${tz})`);
      return { detected: false, timezone: null, source: 'failed' };
    }
    await setTimezone(key, tz);
    logger?.info?.(`[greenlog onboarding] auto-detected timezone for workspace ${key}: ${tz} (from user ${userId})`);
    return { detected: true, timezone: tz, source: 'detected' };
  } catch (err) {
    logger?.warn?.('[greenlog onboarding] ensureWorkspaceTimezone failed:', err?.message || err);
    return { detected: false, timezone: null, source: 'failed' };
  }
}

module.exports = { ensureWorkspaceTimezone };
