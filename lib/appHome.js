const {
    workspaceKey,
    resolveWorkspaceConfig,
    setTimezone,
    setDigestChannel,
    isValidTimezone,
} = require('./configStore');
const { postWeeklyDigest } = require('../listeners/digestCron');

const COMMON_ZONES = [
    'UTC',
    'Africa/Algiers', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Cairo',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Shanghai',
    'Australia/Sydney', 'Pacific/Auckland',
];

function buildTimezoneOptions(currentTz) {
    const set = new Set();
    if (currentTz) set.add(currentTz);
    for (const z of COMMON_ZONES) set.add(z);
    return [...set].slice(0, 100).map(z => ({
        text: { type: 'plain_text', text: z, emoji: false },
        value: z,
    }));
}

async function publishAppHome({ teamId, enterpriseId, userId, client, logger }) {
    try {
        if (!userId || !client) return;
        const cfg = await resolveWorkspaceConfig({ teamId, enterpriseId });
        const tzSrc = cfg.sources.timezone;
        const chSrc = cfg.sources.digestChannel;
        const chDisplay = cfg.digestChannel ? '<#' + cfg.digestChannel + '>' : '_(not set)_';
        const tzSrcLabel = ({
            config: 'set by you',
            detected: 'auto-detected',
            env: 'environment default',
            default: 'system default',
        })[tzSrc] || tzSrc;
        const chSrcLabel = ({
            config: 'set by you',
            env: 'environment default',
            fallback: 'fallback channel',
            none: 'not configured',
        })[chSrc] || chSrc;

        const tzOptions = buildTimezoneOptions(cfg.timezone);

        const settingsTzBlock = {
            type: 'section',
            block_id: 'apphome_timezone_block',
            text: { type: 'mrkdwn', text: '*Timezone*\nUsed for weekly digest boundaries.' },
            accessory: {
                type: 'static_select',
                action_id: 'apphome_timezone_select',
                placeholder: { type: 'plain_text', text: 'Select timezone' },
                options: tzOptions,
                initial_option: {
                    text: { type: 'plain_text', text: cfg.timezone, emoji: false },
                    value: cfg.timezone,
                },
            },
        };

        const channelAccessory = {
            type: 'conversations_select',
            action_id: 'apphome_digest_channel_select',
            placeholder: { type: 'plain_text', text: 'Select a channel' },
            filter: { include: ['public', 'private'], exclude_bot_users: true },
        };
        if (cfg.digestChannel) channelAccessory.initial_conversation = cfg.digestChannel;

        const settingsChannelBlock = {
            type: 'section',
            block_id: 'apphome_channel_block',
            text: { type: 'mrkdwn', text: '*Digest channel*\nWhere the weekly digest will post.' },
            accessory: channelAccessory,
        };

        const settingsActionsBlock = {
            type: 'actions',
            block_id: 'apphome_actions_block',
            elements: [
                {
                    type: 'button',
                    action_id: 'apphome_run_digest_now',
                    text: { type: 'plain_text', text: '▶ Run digest now', emoji: true },
                    style: 'primary',
                },
            ],
        };

        await client.views.publish({
            user_id: userId,
            view: {
                type: 'home',
                blocks: [
                    {
                        type: 'header',
                        text: { type: 'plain_text', text: '🌱 GreenLog', emoji: true },
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: 'Track the carbon impact of your team\'s decisions. GreenLog posts a weekly digest summarizing what was logged.',
                        },
                    },
                    { type: 'divider' },
                    {
                        type: 'header',
                        text: { type: 'plain_text', text: 'Status', emoji: true },
                    },
                    {
                        type: 'section',
                        fields: [
                            { type: 'mrkdwn', text: '*Timezone*\n`' + cfg.timezone + '`\n_' + tzSrcLabel + '_' },
                            { type: 'mrkdwn', text: '*Digest channel*\n' + chDisplay + '\n_' + chSrcLabel + '_' },
                        ],
                    },
                    {
                        type: 'context',
                        elements: [{ type: 'mrkdwn', text: 'Workspace key: `' + (cfg.workspaceKey || '(none)') + '`' }],
                    },
                    { type: 'divider' },
                    {
                        type: 'header',
                        text: { type: 'plain_text', text: 'Settings', emoji: true },
                    },
                    settingsTzBlock,
                    settingsChannelBlock,
                    settingsActionsBlock,
                    { type: 'divider' },
                    {
                        type: 'header',
                        text: { type: 'plain_text', text: 'Quick reference', emoji: true },
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: [
                                '• `/greenlog log <decision>` — log a sustainability decision',
                                '• `/greenlog week` — see this week\'s impact',
                                '• `/greenlog digest` — publish the digest now',
                                '• `/greenlog config` — view current settings',
                                '• Mention `@GreenLog` in any channel for an ad-hoc estimate',
                            ].join('\n'),
                        },
                    },
                    {
                        type: 'context',
                        elements: [{ type: 'mrkdwn', text: '🌍 Built for the Slack Agent Builder Challenge — Agent for Good track.' }],
                    },
                ],
            },
        });
        if (logger && logger.info) logger.info('published App Home for ' + userId);
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        if (logger && logger.error) logger.error('publishAppHome failed: ' + msg);
    }
}

function actionContextKeys(body) {
    const teamId = (body && body.team && body.team.id) || null;
    const enterpriseId = (body && body.enterprise && body.enterprise.id) || null;
    const userId = (body && body.user && body.user.id) || null;
    const key = workspaceKey({ team_id: teamId, enterprise_id: enterpriseId });
    return { teamId, enterpriseId, userId, key };
}

async function dmUser({ client, userId, text }) {
    if (!userId) return;
    const im = await client.conversations.open({ users: userId });
    const dmChannelId = im && im.channel && im.channel.id;
    if (dmChannelId) {
        await client.chat.postMessage({ channel: dmChannelId, text });
    }
}

function registerAppHomeEvents(app) {
    app.event('app_home_opened', async ({ event, body, client, logger }) => {
        try {
            if (event.tab !== 'home') return;
            const teamId = (body && body.team_id) || null;
            const enterpriseId = (body && body.enterprise_id) || null;
            await publishAppHome({
                teamId,
                enterpriseId,
                userId: event.user,
                client,
                logger,
            });
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            if (logger && logger.error) logger.error('app_home_opened handler failed: ' + msg);
        }
    });

    app.action('apphome_timezone_select', async ({ ack, body, action, client, logger }) => {
        await ack();
        try {
            const tz = action && action.selected_option && action.selected_option.value;
            const { teamId, enterpriseId, userId, key } = actionContextKeys(body);
            if (!tz || !key) return;
            if (!isValidTimezone(tz)) {
                if (logger && logger.warn) logger.warn('apphome_timezone_select: invalid tz ' + tz);
                return;
            }
            await setTimezone(key, tz);
            await publishAppHome({ teamId, enterpriseId, userId, client, logger });
            if (logger && logger.info) logger.info('apphome: set tz ' + tz + ' for ' + key);
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            if (logger && logger.error) logger.error('apphome_timezone_select failed: ' + msg);
        }
    });

    app.action('apphome_digest_channel_select', async ({ ack, body, action, client, logger }) => {
        await ack();
        try {
            const channelId = action && action.selected_conversation;
            const { teamId, enterpriseId, userId, key } = actionContextKeys(body);
            if (!channelId || !key) return;
            await setDigestChannel(key, channelId);
            await publishAppHome({ teamId, enterpriseId, userId, client, logger });
            if (logger && logger.info) logger.info('apphome: set channel ' + channelId + ' for ' + key);
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            if (logger && logger.error) logger.error('apphome_digest_channel_select failed: ' + msg);
        }
    });

    app.action('apphome_run_digest_now', async ({ ack, body, client, logger }) => {
        await ack();
        try {
            const { teamId, enterpriseId, userId } = actionContextKeys(body);
            const cfg = await resolveWorkspaceConfig({ teamId, enterpriseId });
            if (!cfg.digestChannel) {
                await dmUser({
                    client,
                    userId,
                    text: '⚠️ No digest channel set yet. Open the GreenLog App Home tab and pick one in *Settings*.',
                });
                return;
            }
            await postWeeklyDigest({
                client,
                logger,
                channelId: cfg.digestChannel,
                teamId,
                enterpriseId,
            });
            await dmUser({
                client,
                userId,
                text: '✅ Posted this week\'s digest to <#' + cfg.digestChannel + '>.',
            });
            if (logger && logger.info) logger.info('apphome: ran digest on demand for ' + cfg.workspaceKey);
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            if (logger && logger.error) logger.error('apphome_run_digest_now failed: ' + msg);
        }
    });
}

module.exports = { publishAppHome, registerAppHomeEvents };
