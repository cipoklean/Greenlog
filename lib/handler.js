function safeHandler(name, fn) {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      args.logger?.error?.(`[${name}] ${err?.message || err}`);
      const text = `Sorry, ${name} hit an error. Please try again.`;
      try {
        if (args.respond) {
          await args.respond({ text, response_type: 'ephemeral', replace_original: false });
        } else if (args.client && args.event) {
          await args.client.chat.postMessage({
            channel: args.event.channel,
            thread_ts: args.event.thread_ts || args.event.ts,
            text,
          });
        }
      } catch {
        // swallow secondary errors
      }
    }
  };
}

module.exports = { safeHandler };
