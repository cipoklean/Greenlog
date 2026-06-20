const { chatComplete, classifyLlmError } = require('../lib/llm');
const { appendLog, readAllLogs, deleteLogById } = require('../lib/store');
const { buildWeeklyDigest, renderDigestText } = require('../lib/digest');
const { postWeeklyDigest } = require('./digestCron');
const { resolveWorkspaceConfig } = require('../lib/configStore');
const { sendWelcomeDmIfNeeded } = require('../lib/welcomeDm');
const { ensureWorkspaceTimezone } = require('../lib/onboarding');
const { safeHandler } = require('../lib/handler');
const { buildLogListBlocks } = require('../lib/logList');
const { buildErrorCard } = require('../lib/errorCard');
const {
  CARBON_ESTIMATE_SYSTEM_PROMPT,
  parseEstimate,
  splitImpact,
  impactDots,
  sanitizeMrkdwn,
} = require('../lib/carbonEstimate');
const { checkRateLimit, formatRetryMessage } = require('../lib/rateLimit');

function parseSubcommand(text = '') {
  const trimmed = text.trim();
  if (!trimmed) return { sub: 'help', rest: '' };
  const [sub, ...restArr] = trimmed.split(/\s+/);
  return { sub: sub.toLowerCase(), rest: restArr.join(' ') };
}

async function handleLog({ respond, decision, meta, logger }) {
  if (!decision) {
    await respond({
      response_type: 'ephemeral',
      text: '🌱 *Usage:* `/greenlog log <decision>`\nExample: `/greenlog log switched our 5 dev servers to renewable energy`',
    });
    return;
  }

  // Rate-limit LLM calls per user to prevent cost-abuse via spamming.
  const rl = checkRateLimit({ teamId: meta?.teamId, userId: meta?.userId });
  if (!rl.allowed) {
    await respond({
      response_type: 'ephemeral',
      text: formatRetryMessage(rl.retryAfterMs),
    });
    return;
  }

  try {
    const raw = await chatComplete({
      systemPrompt: CARBON_ESTIMATE_SYSTEM_PROMPT,
      userContent: decision,
      temperature: 0.3,
      maxTokens: 200,
      timeoutMs: 15000,
    });
    const { impact, category, why } = parseEstimate(raw);

    if (!impact || !category || !why) {
      // Parse failed — render raw, skip persistence (don't store garbage)
      await respond({
        response_type: 'ephemeral',
        text: `🌱 *Logged:* ${decision}\n\n${sanitizeMrkdwn(raw)}`,
      });
      return;
    }

    // Parse succeeded — persist + render structured card
    const { magnitude, direction } = splitImpact(impact);
    let savedLog = null;
    try {
      savedLog = await appendLog({
        teamId: meta?.teamId || null,
        channelId: meta?.channelId || null,
        channelName: meta?.channelName || null,
        userId: meta?.userId || null,
        decision,
        impact,
        magnitude,
        direction,
        category,
        why,
      });
    } catch (err) {
      logger?.error?.({ err }, 'greenlog appendLog failed');
    }

    const dirEmoji = direction === 'positive' ? '🟢' : direction === 'negative' ? '🔴' : '⚪';
    const fallbackText = [
      `🌱 *Logged:* ${decision}`,
      '',
      `*Impact:* ${impact} ${impactDots(impact)}`,
      `*Category:* ${category}`,
      `*Why:* ${why}`,
    ].join('\n');

    const logBlocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🌱 Decision logged', emoji: true },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `${dirEmoji} *${impact}* ${impactDots(impact)} · \`${category}\`` }],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `_${decision}_` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Why:* ${why}` },
      },
    ];

    if (savedLog?.id) {
      logBlocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '↩️ Undo', emoji: true },
            style: 'danger',
            action_id: 'greenlog_delete_log',
            value: savedLog.id,
            confirm: {
              title: { type: 'plain_text', text: 'Undo this log?' },
              text: { type: 'mrkdwn', text: 'Remove this entry from your records?' },
              confirm: { type: 'plain_text', text: 'Undo' },
              deny: { type: 'plain_text', text: 'Keep' },
            },
          },
        ],
      });
    }

    await respond({
      response_type: 'ephemeral',
      text: fallbackText,
      blocks: logBlocks,
    });
  } catch (err) {
    logger?.error?.('greenlog log error', err);
    await respond({
      response_type: 'ephemeral',
      ...buildErrorCard({
        title: "Couldn't estimate impact",
        body: classifyLlmError(err),
        hint: 'Try again in a moment, or rephrase your decision.',
      }),
    });
  }
}

async function handleGreenlogCommand({ command, ack, respond, client, logger }) {
  await ack();

  // Fire-and-forget welcome DM on first slash command from this workspace
  sendWelcomeDmIfNeeded({
    teamId: command.team_id,
    enterpriseId: command.enterprise_id,
    userId: command.user_id,
    client,
    logger,
  });
  const { sub, rest } = parseSubcommand(command.text);
  // Fire on every slash invocation; idempotent once tz lives in config.
  await ensureWorkspaceTimezone({
    teamId: command.team_id,
    enterpriseId: command.enterprise_id,
    userId: command.user_id,
    client,
    logger,
  });

  try {
    switch (sub) {
      case 'ping':
        await respond({
          response_type: 'ephemeral',
          text: '🌱 pong! GreenLog is online.',
        });
        break;

      case 'log': {
        const meta = {
          teamId: command.team_id,
          channelId: command.channel_id,
          channelName: command.channel_name,
          userId: command.user_id,
        };
        await handleLog({ respond, decision: rest, meta, logger });
        break;
      }

      case 'week': {
        const channelScoped = rest.trim().toLowerCase() === 'channel';
        const cfg = await resolveWorkspaceConfig({
          teamId: command.team_id,
          enterpriseId: command.enterprise_id,
          fallbackChannel: command.channel_id,
        });
        const digest = await buildWeeklyDigest({
          channelId: channelScoped ? command.channel_id : undefined,
          tz: cfg.timezone,
        });
        await respond({
          response_type: 'ephemeral',
          text: renderDigestText(digest, { channelScoped }),
        });
        break;
      }

      case 'digest': {
        const result = await postWeeklyDigest({
          client,
          logger,
          channelId: command.channel_id,
          teamId: command.team_id,
          enterpriseId: command.enterprise_id,
        });
        if (result.posted) {
          await respond({
            response_type: 'ephemeral',
            text: '✅ Digest posted to this channel.',
          });
        } else if (result.reason === 'no-channel') {
          await respond({
            response_type: 'ephemeral',
            ...buildErrorCard({
              title: 'No digest channel configured',
              body: 'GreenLog needs a channel to post weekly digests to.',
              hint: 'Open the GreenLog App Home tab and pick a channel from the dropdown.',
            }),
          });
        } else {
          await respond({
            response_type: 'ephemeral',
            ...buildErrorCard({
              title: "Couldn't post digest",
              body: result.error?.message || 'Unknown error.',
              hint: 'Try `/greenlog digest` again in a few seconds.',
            }),
          });
        }
        break;
      }

      case 'config': {
        const cfg = await resolveWorkspaceConfig({
          teamId: command.team_id,
          enterpriseId: command.enterprise_id,
          fallbackChannel: command.channel_id,
        });
        const ch = cfg.digestChannel ? `<#${cfg.digestChannel}>` : '_(none)_';
        await respond({
          response_type: 'ephemeral',
          text: [
            '🌱 *GreenLog config*',
            '',
            `• *Timezone:* \`${cfg.timezone}\` _(source: ${cfg.sources.timezone})_`,
            `• *Digest channel:* ${ch} _(source: ${cfg.sources.digestChannel})_`,
            `• *Workspace key:* \`${cfg.workspaceKey || '(none)'}\``,
            '',
            '_To change these, open the GreenLog App Home tab._',
          ].join('\n'),
        });
        break;
      }
      case 'undo': {
        const all = await readAllLogs();
        const mine = all
          .filter((l) => l.userId === command.user_id)
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        if (mine.length === 0) {
          await respond({ response_type: 'ephemeral', text: '↩️ Nothing to undo — you have no logged decisions yet.' });
          break;
        }
        const latest = mine[0];
        const result = await deleteLogById({ id: latest.id, userId: command.user_id });
        if (result.ok) {
          await respond({
            response_type: 'ephemeral',
            text: `↩️ Undone: _${result.deleted.decision}_ (${result.deleted.impact || 'unknown impact'})\nRun \`/greenlog list\` to see your remaining logs.`,
          });
        } else {
          await respond({ response_type: 'ephemeral', text: '⚠️ Could not undo — please try again.' });
        }
        break;
      }

      case 'list': {
        const cfg = await resolveWorkspaceConfig({
          teamId: command.team_id,
          enterpriseId: command.enterprise_id,
        });
        const blocks = await buildLogListBlocks({ userId: command.user_id, tz: cfg.timezone });
        await respond({
          response_type: 'ephemeral',
          text: 'Your recent GreenLog entries',
          blocks,
        });
        break;
      }
      default: {
        const helpCfg = await resolveWorkspaceConfig({ teamId: command.team_id, enterpriseId: command.enterprise_id });
        await respond({
          response_type: 'ephemeral',
          text: [
            '🌱 *GreenLog — sustainability tracker*',
            '',
            '*Available commands:*',
            '• `/greenlog ping` — health check',
            '• `/greenlog log <decision>` — get an impact estimate',
            '• `/greenlog list` — show your recent logs with delete buttons',
            '• `/greenlog undo` — delete your most recent log',
            "• `/greenlog week` — this week's impact digest (add `channel` to scope it)",
            "• `/greenlog digest` — publish this week's digest to this channel",
            '• `/greenlog config` — view current timezone + digest channel',
            '',
            'Mention `@GreenLog` in any channel for an ad-hoc carbon impact estimate.',
            '',
            `_Week boundaries use *${helpCfg.timezone}* (source: ${helpCfg.sources.timezone}). To change settings, open the GreenLog App Home tab._`,
          ].join('\n'),
        });
        break;
      }
    }
  } catch (err) {
    logger?.error?.('greenlog command error', err);
    await respond({
      response_type: 'ephemeral',
      ...buildErrorCard({
        title: 'Something went wrong',
        body: `\`${err.message || err}\``,
        hint: 'Try `/greenlog ping` to check status. If this persists, check the server logs.',
      }),
    });
  }
}

function registerGreenlogCommand(app) {
  app.command('/greenlog', async ({ command, ack, respond, client, logger }) => {
    await safeHandler('greenlog-command', () => handleGreenlogCommand({ command, ack, respond, client, logger }))();
  });
}

module.exports = {
  registerGreenlogCommand,
  handleGreenlogCommand,
};
