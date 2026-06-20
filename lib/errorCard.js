function buildErrorCard({ title = 'Something went wrong', body = '', hint } = {}) {
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: `⚠️ ${title}`, emoji: true } }];
  if (body) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: body } });
  }
  if (hint) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `💡 ${hint}` }] });
  }
  return {
    text: `⚠️ ${title}${body ? `: ${body}` : ''}${hint ? ` — ${hint}` : ''}`,
    blocks,
  };
}

module.exports = { buildErrorCard };
