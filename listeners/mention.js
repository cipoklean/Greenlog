const { chatComplete, classifyLlmError } = require('../lib/llm');
const { CARBON_ESTIMATE_SYSTEM_PROMPT, parseEstimate, impactDots, sanitizeMrkdwn } = require('../lib/carbonEstimate');
const { checkRateLimit, formatRetryMessage } = require('../lib/rateLimit');
const { recordUsage } = require('../lib/usage');

const MENTION_REGEX = /<@[UW][A-Z0-9]+(?:\|[^>]+)?>/g;

function stripMentions(text = '') {
  return text.replace(MENTION_REGEX, '').trim();
}

async function fetchThreadText({ client, channel, threadTs, selfBotUserId, logger }) {
  try {
    const res = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit: 50,
    });
    if (!res.ok || !Array.isArray(res.messages)) return { text: '', count: 0 };
    const human = res.messages
      .filter((m) => m.user && m.user !== selfBotUserId)
      .map((m) => stripMentions(m.text || ''))
      .filter((t) => t.length > 0);
    return { text: human.join('\n'), count: human.length };
  } catch (err) {
    logger?.error?.({ err }, 'greenlog fetchThreadText failed');
    return { text: '', count: 0 };
  }
}

async function estimateImpact(userContent, { context } = {}) {
  const raw = await chatComplete({
    systemPrompt: CARBON_ESTIMATE_SYSTEM_PROMPT,
    userContent,
    temperature: 0.3,
    maxTokens: 200,
    timeoutMs: 15000,
    context,
  });
  return { raw, parsed: parseEstimate(raw) };
}

function formatCard({ headerLine, impact, category, why }) {
  return [headerLine, '', `*Impact:* ${impact} ${impactDots(impact)}`, `*Category:* ${category}`, `*Why:* ${why}`].join(
    '\n',
  );
}

async function handleAppMention({ event, client, context, logger }) {
  const channel = event.channel;
  const replyTs = event.thread_ts || event.ts;
  const replyInThread = (body) => client.chat.postMessage({ channel, thread_ts: replyTs, text: body });

  try {
    const selfBotUserId = context?.botUserId || null;
    const stripped = stripMentions(event.text || '');
    const inThread = event.thread_ts && event.thread_ts !== event.ts;

    // Route 3: empty standalone mention → greeting
    if (!inThread && !stripped) {
      await replyInThread(
        [
          "🌱 *Hi! I'm GreenLog.* Mention me with a sustainability decision and I'll estimate the carbon impact.",
          '',
          'Try one of these:',
          '• `@GreenLog switched our office to LED lighting`',
          '• `@GreenLog` inside a thread that discusses a decision',
          '',
          'Or use `/greenlog log <decision>` to log directly.',
        ].join('\n'),
      );
      return;
    }

    // Decide decision text + header line. Mentions are ephemeral estimates —
    // they are NOT persisted as decisions; only `/greenlog log` writes to
    // the weekly digest. We do, however, count mention *usage* (below) so the
    // digest can still report how many times the bot was used.
    let decisionForLLM;
    let headerLine;
    let source;
    let llmContext;

    if (inThread) {
      const { text: threadText, count } = await fetchThreadText({
        client,
        channel,
        threadTs: event.thread_ts,
        selfBotUserId,
        logger,
      });
      if (!threadText) {
        await replyInThread(
          "🌱 I couldn't read this thread. Make sure I'm invited to the channel, or mention me with a decision in the text directly.",
        );
        return;
      }
      decisionForLLM = `Decision context from team discussion:\n\n${threadText}`;
      headerLine = '🌱 *Carbon impact for this thread:*';
      source = 'mention-thread';
      llmContext = { intent: 'summarize-thread', messageCount: count };
    } else {
      decisionForLLM = stripped;
      headerLine = `🌱 *Estimated impact:* ${stripped}`;
      source = 'mention-direct';
      llmContext = { intent: 'estimate' };
    }

    // Rate-limit LLM calls per user to prevent cost-abuse via spamming.
    const rl = checkRateLimit({ teamId: context?.teamId, userId: event.user });
    if (!rl.allowed) {
      await replyInThread(formatRetryMessage(rl.retryAfterMs));
      return;
    }

    // Count this mention as usage (for the digest Sources line) but do NOT
    // log the decision itself. Failure here is non-fatal.
    recordUsage({ source, channelId: channel }).catch((err) => logger?.error?.({ err }, 'greenlog recordUsage failed'));

    const { raw, parsed } = await estimateImpact(decisionForLLM, { context: llmContext });
    const { impact, category, why } = parsed;

    if (!impact || !category || !why) {
      // Parse failed — render raw, no persistence
      await replyInThread(`🌱 ${sanitizeMrkdwn(raw)}`);
      return;
    }

    await replyInThread(formatCard({ headerLine, impact, category, why }));
  } catch (err) {
    logger?.error?.('greenlog mention error', err);
    try {
      await replyInThread(classifyLlmError(err, llmContext));
    } catch {
      // swallow — don't crash on reply failure
    }
  }
}

function registerMentionHandler(app) {
  app.event('app_mention', handleAppMention);
}

module.exports = { registerMentionHandler, handleAppMention };
