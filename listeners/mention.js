'use strict';

const { chatComplete, classifyLlmError } = require('../lib/llm');
const { appendLog } = require('../lib/store');
const {
    CARBON_ESTIMATE_SYSTEM_PROMPT,
    parseEstimate,
    splitImpact,
    impactDots,
} = require('../lib/carbonEstimate');

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
        if (!res.ok || !Array.isArray(res.messages)) return '';
        return res.messages
            .filter((m) => m.user && m.user !== selfBotUserId)
            .map((m) => stripMentions(m.text || ''))
            .filter((t) => t.length > 0)
            .join('\n');
    } catch (err) {
        logger?.error?.({ err }, 'greenlog fetchThreadText failed');
        return '';
    }
}

async function estimateImpact(userContent) {
    const raw = await chatComplete({
        systemPrompt: CARBON_ESTIMATE_SYSTEM_PROMPT,
        userContent,
        temperature: 0.3,
        maxTokens: 200,
        timeoutMs: 15000,
    });
    return { raw, parsed: parseEstimate(raw) };
}

function formatCard({ headerLine, impact, category, why }) {
    return [
        headerLine,
        '',
        `*Impact:* ${impact} ${impactDots(impact)}`,
        `*Category:* ${category}`,
        `*Why:* ${why}`,
    ].join('\n');
}

async function handleAppMention({ event, client, context, logger }) {
    const channel = event.channel;
    const replyTs = event.thread_ts || event.ts;
    const replyInThread = (body) =>
        client.chat.postMessage({ channel, thread_ts: replyTs, text: body });

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

        // Decide decision text + source tag
        let decisionForLLM;
        let decisionForStore;
        let source;
        let headerLine;

        if (inThread) {
            const threadText = await fetchThreadText({
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
            decisionForStore = `[thread] ${threadText.slice(0, 500)}`;
            source = 'mention-thread';
            headerLine = '🌱 *Carbon impact for this thread:*';
        } else {
            decisionForLLM = stripped;
            decisionForStore = stripped;
            source = 'mention-direct';
            headerLine = `🌱 *Estimated impact:* ${stripped}`;
        }

        const { raw, parsed } = await estimateImpact(decisionForLLM);
        const { impact, category, why } = parsed;

        if (!impact || !category || !why) {
            // Parse failed — render raw, skip persistence
            await replyInThread(`🌱 ${raw}`);
            return;
        }

        // Persist
        const { magnitude, direction } = splitImpact(impact);
        appendLog({
            teamId: event.team || null,
            channelId: channel,
            channelName: null,
            userId: event.user || null,
            threadTs: replyTs,
            source,
            decision: decisionForStore,
            impact,
            magnitude,
            direction,
            category,
            why,
        }).catch((err) => {
            logger?.error?.({ err }, 'greenlog appendLog failed (mention)');
        });

        await replyInThread(formatCard({ headerLine, impact, category, why }));
    } catch (err) {
        logger?.error?.('greenlog mention error', err);
        try {
            await replyInThread(
                `🌱 Couldn't estimate impact right now: ${classifyLlmError(err)}`,
            );
        } catch {
            // swallow — don't crash on reply failure
        }
    }
}

function registerMentionHandler(app) {
    app.event('app_mention', handleAppMention);
}

module.exports = { registerMentionHandler, handleAppMention };