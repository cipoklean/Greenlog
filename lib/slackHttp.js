const https = require('node:https');
const { URL } = require('node:url');

const slackHttpsAgent = new https.Agent({
  keepAlive: false,
  rejectUnauthorized: true,
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.2',
});

/**
 * Single download attempt via node:https with TLS 1.2 + curl UA.
 * Follows up to 2 redirects. 15s timeout.
 */
function downloadOnce(urlStr, slackToken, redirectsLeft = 2) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        agent: slackHttpsAgent,
        headers: {
          Authorization: `Bearer ${slackToken}`,
          'User-Agent': 'curl/8.4.0',
          Accept: '*/*',
          Connection: 'close',
        },
        timeout: 15000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
          return downloadOnce(res.headers.location, slackToken, redirectsLeft - 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Slack returned HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ buf: Buffer.concat(chunks), mime: res.headers['content-type'] }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Download timed out after 15s'));
    });
    req.end();
  });
}

/**
 * Download a Slack file as { buf, mime }, retrying up to 3 times with
 * exponential backoff (500ms, 1s, 2s) on transient errors.
 * Skips retry on auth errors.
 */
async function downloadSlackFile(urlStr, slackToken, maxRetries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await downloadOnce(urlStr, slackToken);
    } catch (err) {
      lastErr = err;
      if (err.message?.includes('HTTP 401') || err.message?.includes('HTTP 403')) throw err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastErr;
}

/**
 * Download a Slack file and return a base64 data URL ready for Gemini Vision.
 * Falls back to process.env.SLACK_BOT_TOKEN if no token is passed.
 */
async function downloadSlackFileAsDataUrl(urlStr, slackToken) {
  const token = slackToken || process.env.SLACK_BOT_TOKEN;
  const { buf, mime } = await downloadSlackFile(urlStr, token);
  return `data:${mime || 'image/png'};base64,${buf.toString('base64')}`;
}

module.exports = {
  slackHttpsAgent,
  downloadSlackFile,
  downloadSlackFileAsDataUrl,
};
