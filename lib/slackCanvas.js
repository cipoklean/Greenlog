// lib/slackCanvas.js — best-effort shared-canvas publishing for Slack.
// Wraps the create → access.set → URL-build dance with full try/catch fallback.
// Reusable for any Slack project that publishes a canvas alongside a channel
// message and links to it.

/**
 * Create a Slack canvas, share it with the target channel, and return its URL.
 * Every step is best-effort: failures log a warning and return ok:false.
 *
 * @param {Object} args
 * @param {Object} args.client - Bolt WebClient (or any Slack client with canvases.* and auth.test).
 * @param {string} args.title - Canvas title.
 * @param {string} args.markdown - Canvas body content (Slack canvas markdown).
 * @param {string} args.channelId - Channel ID to share the canvas with.
 * @param {Object} [args.logger] - Bolt logger (optional).
 * @returns {Promise<{ok: boolean, canvasId: string|null, canvasUrl: string, error: string|null}>}
 */
async function publishSharedCanvas({ client, title, markdown, channelId, logger }) {
  let canvasId = null;
  let canvasUrl = '';
  try {
    const canvasRes = await client.canvases.create({
      title,
      document_content: {
        type: 'markdown',
        markdown,
      },
    });
    if (!canvasRes?.ok || !canvasRes.canvas_id) {
      return { ok: false, canvasId: null, canvasUrl: '', error: 'canvases.create returned no canvas_id' };
    }
    canvasId = canvasRes.canvas_id;

    // Share with the channel so members can open the canvas
    try {
      await client.canvases.access.set({
        canvas_id: canvasId,
        access_level: 'read',
        channel_ids: [channelId],
      });
    } catch (shareErr) {
      logger?.warn?.(`[slackCanvas] share failed: ${shareErr?.message || shareErr}`);
    }

    // Build URL via auth.test().url — handles standard workspaces
    // (app.slack.com) and Enterprise Grid (<ws>.enterprise.slack.com) uniformly.
    try {
      const auth = await client.auth.test();
      if (auth?.ok && auth.team_id && auth.url) {
        canvasUrl = `${auth.url}docs/${auth.team_id}/${canvasId}`;
      }
    } catch (urlErr) {
      logger?.warn?.(`[slackCanvas] auth.test for URL failed: ${urlErr?.message || urlErr}`);
    }

    logger?.info?.(`[slackCanvas] created: ${canvasId}${canvasUrl ? ` → ${canvasUrl}` : ''}`);
    return { ok: true, canvasId, canvasUrl, error: null };
  } catch (canvasErr) {
    const msg = canvasErr?.message || String(canvasErr);
    logger?.warn?.(`[slackCanvas] create failed: ${msg}`);
    return { ok: false, canvasId, canvasUrl, error: msg };
  }
}

module.exports = {
  publishSharedCanvas,
};
