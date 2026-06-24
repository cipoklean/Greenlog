# AGENTS.md — GreenLog

Slack bot for tracking team sustainability decisions and publishing weekly carbon-impact digests.

Built with Slack Bolt (Socket Mode) and an OpenAI-compatible multi-provider LLM layer (Gemini primary, Groq fallback).

## Setup

```sh
cp .env.sample .env   # Fill in GEMINI_API_KEY, SLACK_BOT_TOKEN, SLACK_APP_TOKEN
npm install
npm start
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `LLM_PROVIDER` | Primary LLM provider (`gemini` or `groq`; default: `gemini`) |
| `GEMINI_API_KEY` | Gemini API key (default primary, vision-capable) |
| `GEMINI_MODEL` | Gemini model override (default: `gemini-3.1-flash-lite`) |
| `GROQ_API_KEY` | Groq API key (text-only fallback; leave unset to disable) |
| `GROQ_MODEL` | Groq model override (default: `llama-3.3-70b-versatile`) |
| `SLACK_BOT_TOKEN` | Bot token (`xoxb-`) |
| `SLACK_APP_TOKEN` | App-level token (`xapp-`) for Socket Mode |
| `GREENLOG_DIGEST_CHANNEL` | Default channel for weekly digest (env fallback) |
| `GREENLOG_TZ` | Default timezone for week boundaries (env fallback) |
| `PORT` | HTTP keep-alive port (default: 3000) |

## Commands

```sh
npm install          # Install dependencies
npm start            # Start the app
npm run lint         # Biome lint and format check
npm run lint:fix     # Auto-fix lint and format issues
npm run check        # Type check JavaScript with tsc (checkJs)
npm test             # Run tests (node:test)
```

## Architecture

### Entry Point

`app.js` — creates the Slack Bolt app in Socket Mode, registers all listeners, and starts an HTTP keep-alive server.

### Listeners

- `listeners/commands.js` — `/greenlog` slash command handler (log, week, digest, config, undo, list, help)
- `listeners/mention.js` — `@GreenLog` app mention handler (ad-hoc carbon estimates)
- `listeners/digestCron.js` — weekly digest cron job (Monday 9am) + canvas publishing

### Library Modules

- `lib/llm.js` — Multi-provider LLM layer (PROVIDERS registry, automatic fallback chain, capability-aware routing). Gemini is the default primary; Groq is the text-only fallback. Context-aware error messages for graceful degradation.
- `lib/store.js` — JSON file persistence for log entries (`data/logs.json`)
- `lib/configStore.js` — per-workspace settings persistence (`data/config.json`)
- `lib/digest.js` — weekly digest aggregation, rendering (text + Slack blocks)
- `lib/carbonEstimate.js` — LLM prompt, response parsing, impact classification
- `lib/slackCanvas.js` — Slack canvas publishing for weekly digests
- `lib/slackHttp.js` — TLS 1.2 file download from Slack (for image attachments)
- `lib/appHome.js` — Slack App Home tab UI (settings, run digest)
- `lib/welcomeDm.js` — onboarding welcome DM with channel picker
- `lib/onboarding.js` — auto-detect workspace timezone from user profile
- `lib/logList.js` — recent log listing with delete buttons
- `lib/handler.js` — safe async handler wrapper with error recovery
- `lib/errorCard.js` — error card block builder
- `lib/rateLimit.js` — in-memory sliding-window rate limiter for LLM calls
- `lib/usage.js` — lightweight mention-usage tracking (`data/usage.json`, separate from decision logs)

### Data Flow

1. User runs `/greenlog log <decision>` or mentions `@GreenLog`
2. Decision text is sent to the LLM (primary provider, with automatic fallback to the next on retriable errors)
3. Response is parsed into magnitude, direction, category, and explanation
4. For `/greenlog log` only — the entry is persisted to `data/logs.json`
5. `@GreenLog` mentions are ephemeral (not persisted), but usage is counted in `data/usage.json`
6. Structured Slack message (blocks) is returned to the user
7. Weekly cron aggregates all logs, builds a digest, and posts it to the configured channel with an optional Slack canvas

### File Storage

- `data/logs.json` — array of log entries (JSON, write-mutex protected)
- `data/config.json` — per-workspace settings (JSON, write-mutex protected)
- `data/usage.json` — mention-usage events (JSON, write-mutex protected)
- All three files have corrupt-JSON recovery (rename + start fresh)

## Testing

Tests use the Node.js built-in test runner (`node:test`) and assertion module (`node:assert`).

```sh
npm test             # Run all tests
```

### Conventions

- Test files live in `tests/` and mirror the source directory structure
- File naming: `<source-file>.test.js`
- Use `describe()` / `it()` / `beforeEach()` blocks from `node:test`
- Use `mock.fn()` from `node:test` for mocking
- Assertions use `node:assert`