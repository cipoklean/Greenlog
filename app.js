require('dotenv').config();
const { App, LogLevel } = require('@slack/bolt');
const { registerMentionHandler } = require('./listeners/mention');
const { registerDigestCron } = require('./listeners/digestCron');
require('dotenv').config();
const http = require('http');

const { registerGreenlogCommand } = require('./listeners/commands');
const { registerWelcomeActions } = require('./lib/welcomeDm');
const { registerAppHomeEvents } = require('./lib/appHome');
const { registerLogListActions } = require('./lib/logList');

const app = new App({
	token: process.env.SLACK_BOT_TOKEN,
	appToken: process.env.SLACK_APP_TOKEN,
	socketMode: true,
	logLevel: LogLevel.INFO,
});

registerGreenlogCommand(app);
registerMentionHandler(app);
registerDigestCron(app);
registerWelcomeActions(app);
registerAppHomeEvents(app);
registerLogListActions(app);

(async () => {
	await app.start();
	console.log('🌱 GreenLog is running!');
})();

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
	if (req.url === '/health') {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('AccessMate is awake');
		return;
	}
	res.writeHead(404, { 'Content-Type': 'text/plain' });
	res.end('Not found');
}).listen(PORT, () => {
	console.log(`💓 Keep-alive HTTP listening on :${PORT}`);
});