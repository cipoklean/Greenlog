'use strict';

const { readAllLogs, deleteLogById } = require('./store');
const { resolveWorkspaceConfig } = require('./configStore');

const LIST_LIMIT = 10;

function shortDecision(d) {
    if (!d) return '(no decision)';
    return d.length > 80 ? d.slice(0, 77) + '...' : d;
}

function formatTimestamp(iso, tz = 'UTC') {
    try {
        return new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
        }).format(new Date(iso));
    } catch {
        return iso || '(unknown time)';
    }
}

async function buildLogListBlocks({ userId, tz = 'UTC' } = {}) {
    const all = await readAllLogs();
    const mine = all
        .filter((l) => l.userId === userId)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, LIST_LIMIT);

    const blocks = [
        {
            type: 'header',
            text: { type: 'plain_text', text: '🌱 Your recent GreenLog entries', emoji: true },
        },
    ];

    if (mine.length === 0) {
        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: '_You have no logged decisions yet._\nTry `/greenlog log <decision>` to log one.' },
        });
        return blocks;
    }

    blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Showing your last *${mine.length}* logged decision${mine.length === 1 ? '' : 's'} (most recent first) · times in *${tz}*` }],
    });
    blocks.push({ type: 'divider' });

    for (const log of mine) {
        const timeStr = formatTimestamp(log.timestamp, tz);
        const dirEmoji = log.direction === 'positive' ? '🟢' : log.direction === 'negative' ? '🔴' : '⚪';
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `${dirEmoji} *${shortDecision(log.decision)}*\n_${log.impact || 'unknown impact'}_ · \`${log.category || 'Uncategorized'}\` · ${timeStr}`,
            },
            accessory: {
                type: 'button',
                text: { type: 'plain_text', text: '🗑️ Delete', emoji: true },
                style: 'danger',
                action_id: 'greenlog_delete_log',
                value: log.id,
                confirm: {
                    title: { type: 'plain_text', text: 'Delete this log?' },
                    text: { type: 'mrkdwn', text: `Remove _${shortDecision(log.decision)}_ permanently?` },
                    confirm: { type: 'plain_text', text: 'Delete' },
                    deny: { type: 'plain_text', text: 'Cancel' },
                },
            },
        });
    }

    return blocks;
}

function registerLogListActions(app) {
    app.action('greenlog_delete_log', async ({ ack, respond, body, logger }) => {
        await ack();
        const logId = body.actions?.[0]?.value;
        const userId = body.user?.id;
        if (!logId || !userId) {
            logger?.warn?.('[greenlog] delete action missing logId or userId');
            return;
        }

        const result = await deleteLogById({ id: logId, userId });

        if (!result.ok) {
            let msg = '⚠️ Could not delete that log.';
            if (result.reason === 'not-found') msg = '⚠️ That log was already deleted.';
            if (result.reason === 'not-owner') msg = '⚠️ You can only delete logs you created.';
            await respond({ response_type: 'ephemeral', replace_original: false, text: msg });
            return;
        }

        logger?.info?.(`[greenlog] deleted log ${logId} by user ${userId}`);

        const cfg = await resolveWorkspaceConfig({
            teamId: body.team?.id,
            enterpriseId: body.enterprise?.id || body.team?.enterprise_id,
        });
        const blocks = await buildLogListBlocks({ userId, tz: cfg.timezone });
        await respond({
            replace_original: true,
            response_type: 'ephemeral',
            text: 'Your recent GreenLog entries',
            blocks,
        });
    });
}

module.exports = { buildLogListBlocks, registerLogListActions, LIST_LIMIT };
