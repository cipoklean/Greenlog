const { workspaceKey, resolveWorkspaceConfig, getConfig, updateConfig, setDigestChannel } = require('./configStore');

async function sendWelcomeDmIfNeeded({ teamId, enterpriseId, userId, client, logger }) {
  try {
    const key = workspaceKey({ team_id: teamId, enterprise_id: enterpriseId });
    if (!key || !userId || !client) return;

    const cfg = await getConfig(key);
    if (cfg?.onboardingDmSent) return;

    const im = await client.conversations.open({ users: userId });
    const dmChannelId = im?.channel?.id;
    if (!dmChannelId) return;

    const resolved = await resolveWorkspaceConfig({ teamId, enterpriseId });
    const tzSource = resolved.sources.timezone;
    const tzLine =
      tzSource === 'config' || tzSource === 'detected'
        ? `🕒 We detected your timezone as \`${resolved.timezone}\`.`
        : `🕒 Using default timezone \`${resolved.timezone}\`. You can change this from App Home soon.`;

    await client.chat.postMessage({
      channel: dmChannelId,
      text: '🌱 Welcome to GreenLog!',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: "🌱 *Welcome to GreenLog!*\n\nGreenLog tracks the carbon impact of your team's decisions and posts a weekly digest. Use `/greenlog log <decision>` anytime, or mention `@GreenLog` in any channel for an ad-hoc estimate.",
          },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: tzLine },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '📣 *Pick a channel for the weekly digest:*' },
          accessory: {
            type: 'conversations_select',
            action_id: 'welcome_digest_channel_select',
            placeholder: { type: 'plain_text', text: 'Select a channel' },
            filter: { include: ['public', 'private'], exclude_bot_users: true },
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: 'You can change this anytime from the GreenLog App Home tab (coming soon).',
            },
          ],
        },
      ],
    });

    await updateConfig(key, {
      onboardingDmSent: true,
      onboardingDmAt: new Date().toISOString(),
      onboardingDmUserId: userId,
    });
    if (logger?.info) logger.info(`sent welcome DM to ${userId} for workspace ${key}`);
  } catch (err) {
    const msg = err?.message ? err.message : String(err);
    if (logger?.error) logger.error(`sendWelcomeDmIfNeeded failed: ${msg}`);
  }
}

function registerWelcomeActions(app) {
  app.action('welcome_digest_channel_select', async ({ ack, body, action, client, logger }) => {
    await ack();
    try {
      const channelId = action?.selected_conversation;
      if (!channelId) return;

      const teamId = body?.team?.id;
      const enterpriseId = body?.enterprise?.id || null;
      const userId = body?.user?.id;
      const key = workspaceKey({ team_id: teamId, enterprise_id: enterpriseId });
      if (!key) {
        if (logger?.warn) logger.warn('welcome_digest_channel_select: no workspace key');
        return;
      }

      await setDigestChannel(key, channelId);
      console.log(`[welcomeAction] persisted channel ${channelId}, userId=${userId}, key=${key}`);

      const im = await client.conversations.open({ users: userId });
      console.log(`[welcomeAction] conversations.open ok=${im?.ok}, channelId=${im?.channel?.id}`);
      const dmChannelId = im?.channel?.id;
      if (dmChannelId) {
        await client.chat.postMessage({
          channel: dmChannelId,
          text: `✅ Got it — weekly digests will post to <#${channelId}>. Run \`/greenlog config\` anytime to confirm.`,
        });
      }
      if (logger?.info) logger.info(`set digest channel ${channelId} for workspace ${key}`);
    } catch (err) {
      const msg = err?.message ? err.message : String(err);
      if (logger?.error) logger.error(`welcome_digest_channel_select handler failed: ${msg}`);
    }
  });
}

module.exports = { sendWelcomeDmIfNeeded, registerWelcomeActions };
