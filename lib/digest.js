'use strict';

const { readAllLogs } = require('./store');

/**
 * Default timezone for week boundaries and date display. Pure fallback used
 * only when no per-call tz is supplied. Workspace-specific tz is resolved at
 * the call site (via lib/configStore.resolveWorkspaceConfig) and passed into
 * buildWeeklyDigest({ tz }). Set GREENLOG_TZ in .env to change the fallback
 * for the dev workspace.
 */
const DEFAULT_TZ = process.env.GREENLOG_TZ || 'UTC';

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function dateFmt(tz) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
}

function weekdayFmt(tz) {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
    });
}

function toLocalDateString(d, tz = DEFAULT_TZ) {
    return dateFmt(tz).format(d);
}

function toDisplayDateString(isoString, tz = DEFAULT_TZ) {
    return toLocalDateString(new Date(isoString), tz);
}

/**
 * Resolve the UTC instant when the local clock first reads 00:00:00 on
 * the given local date in the given tz. Handles arbitrary IANA tz including DST jumps.
 */
function localMidnightUTC(localDateStr, tz = DEFAULT_TZ) {
    const [y, m, d] = localDateStr.split('-').map(Number);
    const sentinel = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    }).formatToParts(sentinel);
    const o = Object.fromEntries(
        parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
    );
    const hour = +o.hour % 24;
    const localAsUTC = Date.UTC(
        +o.year, +o.month - 1, +o.day, hour, +o.minute, +o.second,
    );
    const offsetMs = localAsUTC - sentinel.getTime();
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs);
}

/**
 * ISO 8601 week: Monday 00:00 -> next Monday 00:00 in the given TZ.
 * Returned ISO strings are always UTC.
 */
function getCurrentWeekRange(now = new Date(), tz = DEFAULT_TZ) {
    const todayStr = toLocalDateString(now, tz);
    const dow = WEEKDAYS[weekdayFmt(tz).format(now)];
    const daysFromMon = (dow + 6) % 7;
    const [y, m, d] = todayStr.split('-').map(Number);
    const todayNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const mondayNoon = new Date(todayNoon.getTime() - daysFromMon * 86400000);
    const mondayLocal = toLocalDateString(mondayNoon, tz);
    const startUTC = localMidnightUTC(mondayLocal, tz);
    const endUTC = new Date(startUTC.getTime() + 7 * 86400000);
    return {
        startISO: startUTC.toISOString(),
        endISO: endUTC.toISOString(),
        tz,
    };
}

function aggregateLogs(logs) {
    const magRank = { Large: 3, Medium: 2, Small: 1, Negligible: 0 };
    const summary = {
        totalCount: logs.length,
        byCategory: {},
        byDirection: { positive: 0, negative: 0, neutral: 0 },
        byMagnitude: { Large: 0, Medium: 0, Small: 0, Negligible: 0 },
        bySource: { slash: 0, 'mention-direct': 0, 'mention-thread': 0, other: 0 },
        topPositive: null,
        topNegative: null,
    };
    for (const log of logs) {
        const cat = log.category || 'Uncategorized';
        summary.byCategory[cat] = (summary.byCategory[cat] || 0) + 1;
        if (log.direction && summary.byDirection[log.direction] !== undefined) {
            summary.byDirection[log.direction]++;
        }
        if (log.magnitude && summary.byMagnitude[log.magnitude] !== undefined) {
            summary.byMagnitude[log.magnitude]++;
        }
        const src = log.source || 'slash';
        if (summary.bySource[src] !== undefined) summary.bySource[src]++;
        else summary.bySource.other++;
        const rank = magRank[log.magnitude] ?? 0;
        if (log.direction === 'positive') {
            const cur = summary.topPositive ? (magRank[summary.topPositive.magnitude] ?? 0) : -1;
            if (rank > cur) summary.topPositive = log;
        }
        if (log.direction === 'negative') {
            const cur = summary.topNegative ? (magRank[summary.topNegative.magnitude] ?? 0) : -1;
            if (rank > cur) summary.topNegative = log;
        }
    }
    return summary;
}

async function buildWeeklyDigest({ now = new Date(), channelId, tz = DEFAULT_TZ } = {}) {
    const { startISO, endISO, tz: resolvedTz } = getCurrentWeekRange(now, tz);
    const all = await readAllLogs();
    const start = new Date(startISO).getTime();
    const end = new Date(endISO).getTime();
    const filtered = all.filter((log) => {
        const t = new Date(log.timestamp).getTime();
        if (Number.isNaN(t)) return false;
        if (t < start || t >= end) return false;
        if (channelId && log.channelId !== channelId) return false;
        return true;
    });
    return {
        range: { startISO, endISO, tz: resolvedTz },
        channelId: channelId || null,
        logs: filtered,
        summary: aggregateLogs(filtered),
    };
}

/**
 * Render a digest result as Slack-mrkdwn text. Tz is read from digest.range.tz,
 * which is set by buildWeeklyDigest at construction time.
 */
function renderDigestText(digest, { channelScoped = false } = {}) {
    const { summary, range } = digest;
    const tz = range.tz || DEFAULT_TZ;
    const startStr = toDisplayDateString(range.startISO, tz);
    const endStr = toDisplayDateString(
        new Date(new Date(range.endISO).getTime() - 86400000).toISOString(),
        tz,
    );
    const header = `🌱 *GreenLog weekly digest* — ${startStr} → ${endStr} (${tz})${channelScoped ? ' · this channel' : ''}`;

    if (summary.totalCount === 0) {
        return [
            header, '',
            'No sustainability decisions logged this week yet.',
            'Try `/greenlog log <decision>` or mention `@GreenLog` in a thread.',
        ].join('\n');
    }

    const categoryLines = Object.entries(summary.byCategory)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, n]) => `• ${cat}: ${n}`);

    const lines = [
        header, '',
        `*${summary.totalCount}* decision${summary.totalCount === 1 ? '' : 's'} logged`,
        `🟢 ${summary.byDirection.positive} positive · 🔴 ${summary.byDirection.negative} negative · ⚪ ${summary.byDirection.neutral} neutral`,
        '', '*By category:*',
        ...categoryLines,
    ];
    if (summary.topPositive) {
        lines.push('', '*Top positive impact:*',
            `_${summary.topPositive.decision}_ — ${summary.topPositive.impact} · ${summary.topPositive.category}`);
    }
    if (summary.topNegative) {
        lines.push('', '*Top negative impact:*',
            `_${summary.topNegative.decision}_ — ${summary.topNegative.impact} · ${summary.topNegative.category}`);
    }
    lines.push('',
        `_Sources: ${summary.bySource.slash} slash · ${summary.bySource['mention-direct']} mention · ${summary.bySource['mention-thread']} thread_`,
    );
    return lines.join('\n');
}

function renderDigestBlocks(digest, { channelScoped = false, canvasUrl = null, canvasTitle = null } = {}) {
    const { summary, range } = digest;
    const tz = range.tz || DEFAULT_TZ;
    const startStr = toDisplayDateString(range.startISO, tz);
    const endStr = toDisplayDateString(
        new Date(new Date(range.endISO).getTime() - 86400000).toISOString(),
        tz,
    );
    const blocks = [];
    blocks.push({
        type: 'header',
        text: { type: 'plain_text', text: '🌱 GreenLog weekly digest', emoji: true },
    });
    const scopeSuffix = channelScoped ? ' · this channel' : '';
    blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `*${startStr} → ${endStr}* · ${tz}${scopeSuffix}` }],
    });
    if (summary.totalCount === 0) {
        blocks.push({ type: 'divider' });
        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: '_No sustainability decisions logged this week yet._' },
        });
        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: 'Try `/greenlog log <decision>` or mention `@GreenLog` in a thread.' },
        });
        return blocks;
    }
    const decisionWord = summary.totalCount === 1 ? 'decision' : 'decisions';
    blocks.push({
        type: 'section',
        text: {
            type: 'mrkdwn',
            text: `*${summary.totalCount}* ${decisionWord} logged this week\n🟢 ${summary.byDirection.positive} positive · 🔴 ${summary.byDirection.negative} negative · ⚪ ${summary.byDirection.neutral} neutral`,
        },
    });
    blocks.push({ type: 'divider' });
    const categories = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]);
    if (categories.length > 0) {
        const fields = categories.slice(0, 10).map(([cat, n]) => ({ type: 'mrkdwn', text: `*${cat}*\n${n}` }));
        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: '*By category*' },
            fields,
        });
    }
    if (summary.topPositive) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `🌟 *Top positive impact*\n_${summary.topPositive.decision}_\n${summary.topPositive.impact} · \`${summary.topPositive.category}\``,
            },
        });
    }
    if (summary.topNegative) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `⚠️ *Top negative impact*\n_${summary.topNegative.decision}_\n${summary.topNegative.impact} · \`${summary.topNegative.category}\``,
            },
        });
    }
    if (canvasUrl) {
        blocks.push({ type: 'divider' });
        blocks.push({
            type: 'actions',
            elements: [{
                type: 'button',
                text: { type: 'plain_text', text: '📋 Open weekly canvas', emoji: true },
                url: canvasUrl,
                style: 'primary',
                action_id: 'digest_open_canvas',
            }],
        });
    }
    blocks.push({
        type: 'context',
        elements: [{
            type: 'mrkdwn',
            text: `_Sources: ${summary.bySource.slash} slash · ${summary.bySource['mention-direct']} mention · ${summary.bySource['mention-thread']} thread_`,
        }],
    });
    return blocks;
}

module.exports = {
    TZ: DEFAULT_TZ,
    DEFAULT_TZ,
    getCurrentWeekRange,
    aggregateLogs,
    buildWeeklyDigest,
    renderDigestText,
	renderDigestBlocks,
    toDisplayDateString,
    toLocalDateString,
};
