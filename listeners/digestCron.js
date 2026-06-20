const cron = require('node-cron');
const { buildWeeklyDigest, renderDigestText, renderDigestBlocks, DEFAULT_TZ } = require('../lib/digest');
const { publishSharedCanvas } = require('../lib/slackCanvas');
const { resolveWorkspaceConfig } = require('../lib/configStore');

const SCHEDULE = '0 9 * * 1';

async function postWeeklyDigest({ client, logger, channelId, teamId, enterpriseId } = {}) {
  let resolvedTeamId = teamId;
  let resolvedEnterpriseId = enterpriseId;
  if (!resolvedTeamId && !resolvedEnterpriseId && client) {
    try {
      const auth = await client.auth.test();
      resolvedTeamId = auth.team_id;
      resolvedEnterpriseId = auth.enterprise_id;
    } catch (err) {
      logger?.warn?.('[greenlog] auth.test failed in postWeeklyDigest:', err?.message || err);
    }
  }
  const cfg = await resolveWorkspaceConfig({
    teamId: resolvedTeamId,
    enterpriseId: resolvedEnterpriseId,
    fallbackChannel: channelId,
  });
  const target = channelId || cfg.digestChannel;
  if (!target) {
    logger?.warn?.(
      '[greenlog] no digest channel — workspace has no configured channel and no env fallback. ' +
        'Run `/greenlog channel` in your target channel to set one.',
    );
    return { posted: false, reason: 'no-channel' };
  }
  const tz = cfg.timezone;
  try {
    const digest = await buildWeeklyDigest({ channelId: target, tz });
    const text = renderDigestText(digest, { channelScoped: true });

    const range = digest.range;
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: range.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const startStr = fmt.format(new Date(range.startISO));
    const endStr = fmt.format(new Date(new Date(range.endISO).getTime() - 86400000));
    const canvasTitle = `🌱 GreenLog Weekly Digest — ${startStr} → ${endStr}`;

    let canvasLink = '';
    const canvasRes = await publishSharedCanvas({
      client,
      title: canvasTitle,
      markdown: text,
      channelId: target,
      logger,
    });
    if (canvasRes.ok && canvasRes.canvasUrl) {
      canvasLink = `\n\n📋 *Canvas:* <${canvasRes.canvasUrl}|${canvasTitle}>`;
    }

    const blocks = renderDigestBlocks(digest, {
      channelScoped: true,
      canvasUrl: canvasRes.ok ? canvasRes.canvasUrl : null,
    });

    const res = await client.chat.postMessage({
      channel: target,

      text: text + canvasLink,

      blocks,
    });
    logger?.info?.(
      `[greenlog] digest posted to ${target} (ts=${res.ts}${canvasLink ? ' + canvas linked' : ''}, tz=${tz}/${cfg.sources.timezone}, channel-src=${cfg.sources.digestChannel})`,
    );
    return { posted: true, ts: res.ts, canvasLink };
  } catch (err) {
    logger?.error?.('[greenlog] digest post failed:', err);
    return { posted: false, error: err };
  }
}

function registerDigestCron(app) {
  app.action('digest_open_canvas', async ({ ack }) => {
    await ack();
  });

  (async () => {
    let teamId = null;
    let enterpriseId = null;
    try {
      const auth = await app.client.auth.test();
      teamId = auth.team_id;
      enterpriseId = auth.enterprise_id;
    } catch (err) {
      app.logger?.warn?.('[greenlog] auth.test failed at cron registration:', err?.message || err);
    }
    const cfg = await resolveWorkspaceConfig({ teamId, enterpriseId });
    const tz = cfg.timezone || DEFAULT_TZ;

    cron.schedule(
      SCHEDULE,
      async () => {
        await postWeeklyDigest({
          client: app.client,
          logger: app.logger,
          teamId,
          enterpriseId,
        });
      },
      { timezone: tz },
    );

    const channelHint = cfg.digestChannel
      ? `${cfg.digestChannel} (${cfg.sources.digestChannel})`
      : 'unresolved — set via /greenlog channel';
    app.logger?.info?.(
      `[greenlog] digest cron scheduled: "${SCHEDULE}" (${tz}/${cfg.sources.timezone}), channel: ${channelHint}, workspaceKey: ${cfg.workspaceKey}`,
    );
  })().catch((err) => {
    app.logger?.error?.('[greenlog] digest cron registration failed:', err);
  });
}

module.exports = { registerDigestCron, postWeeklyDigest };
