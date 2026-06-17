
const CARBON_ESTIMATE_SYSTEM_PROMPT = `You are a sustainability analyst for GreenLog, a Slack agent that triages team decisions for environmental impact.

For each decision a user logs, respond in this EXACT format (no preamble, no closing):

Impact: <Large|Medium|Small|Negligible> <positive|negative|neutral>
Category: <Energy|Transport|Materials|Digital|Food|Water|Waste|Procurement|Other>
Why: <one sentence, max 25 words, explaining the environmental mechanism>

Rules:
- Magnitude reflects typical real-world scale of the action, not enthusiasm.
- Direction: positive = reduces emissions/impact; negative = increases; neutral = no clear environmental signal.
- If the input is NOT a sustainability-relevant decision (e.g. "ate lunch", "shipped a bugfix"), respond:
  Impact: Negligible neutral
  Category: Other
  Why: This action has no direct environmental signal we can estimate.
- Do NOT invent specific carbon numbers (e.g. "5 tonnes CO2"). Stay qualitative.
- Do NOT add disclaimers or hedges beyond the "Why" line.

EXAMPLE INPUT:
Switched 5 prod servers from coal-grid to renewable energy contract

EXAMPLE OUTPUT:
Impact: Large positive
Category: Energy
Why: Removes fossil-fuel grid emissions for ongoing server load, which dominates lifetime infra footprint.`;

function splitImpact(impactStr) {
    if (!impactStr) return { magnitude: null, direction: null };
    const m = impactStr.match(/^\s*(Large|Medium|Small|Negligible)\s+(positive|negative|neutral)\s*$/i);
    if (!m) return { magnitude: null, direction: null };
    const mag = m[1];
    return {
        magnitude: mag.charAt(0).toUpperCase() + mag.slice(1).toLowerCase(),
        direction: m[2].toLowerCase(),
    };
}

function parseEstimate(raw) {
    const out = { impact: null, category: null, why: null };
    for (const line of raw.split('\n')) {
        const m = line.match(/^\s*(Impact|Category|Why)\s*:\s*(.+?)\s*$/i);
        if (m) {
            out[m[1].toLowerCase()] = m[2];
        }
    }
    return out;
}

function impactDots(impactStr) {
    if (!impactStr) return '⚪';
    const lower = impactStr.toLowerCase();
    const color = lower.includes('negative') ? '🔴' : lower.includes('neutral') ? '⚪' : '🟢';
    if (lower.startsWith('large')) return color.repeat(3);
    if (lower.startsWith('medium')) return color.repeat(2);
    if (lower.startsWith('small')) return color;
    return color;
}

module.exports = {
    CARBON_ESTIMATE_SYSTEM_PROMPT,
    splitImpact,
    parseEstimate,
    impactDots,
};
