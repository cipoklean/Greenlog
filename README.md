# GreenLog

**Honest climate triage for Slack.**

GreenLog turns Slack into a sustainability log. Log decisions in plain English, get instant qualitative triage — magnitude, direction, category, and a one-sentence *why* — and an honest *"we don't know"* when there's no environmental signal to estimate.

Built solo for the **2026 Slack Agent Builder Challenge** — Agent for Good track.

---

## What it does

GreenLog meets climate decisions where they actually happen: Slack threads. Four surfaces, one philosophy.

### `/greenlog log <decision>`

Type any decision in plain English (e.g. *"switched our staging cluster to a renewable-powered region in europe-north"*). Gemini parses it and returns a card with:

- **Magnitude** — Large / Medium / Small / Negligible (rendered with 🟢🟢🟢 or 🔴🔴🔴 indicators)
- **Direction** — positive / negative / neutral
- **Category** — Energy, Transport, Materials, Other, and four more (8 total)
- **Why** — one sentence explaining the environmental mechanism
- **↩️ Undo button** — one-click removal

When the input is ambiguous (e.g. *"i drove to work today"* with no distance), GreenLog asks a short Block Kit follow-up before producing the card.

### `/greenlog digest`

Posts the week's digest to the configured channel — decisions grouped by category, with the net direction. Auto-runs every Monday in the workspace timezone, or trigger it on demand from the App Home.

### `@GreenLog` thread mention

Ad-hoc *"what if"* estimates inside any thread. Same card shape — but **not persisted**. For decisions still being debated.

### App Home

- **Timezone** — auto-detected from the installer, overridable from a dropdown
- **Digest channel** — pick from a conversations selector
- **▶ Run digest now** — trigger the weekly digest on demand
- **Quick reference** for all commands

Every setting is source-labelled so you always know what's auto vs user-set.

---

## 🎯 The differentiator: honest uncertainty

Most carbon tools invent confident-sounding kg CO₂e numbers. GreenLog refuses.

When a logged decision has **no environmental signal** — a bug fix, a doc edit, a routine deploy, a meeting reschedule — the card says so explicitly:

> *"This action has no direct environmental signal we can estimate."*
> 

No invented numbers. No fake precision. An honest *"we don't know"* is what makes the magnitudes you do see worth trusting.

---

## Tech stack

- [**Slack Bolt for JavaScript**](https://tools.slack.dev/bolt-js/) (Socket Mode)
- **Node.js** (CommonJS)
- **Google Gemini 3.1 Flash-Lite** via the [OpenAI-compatible endpoint](https://ai.google.dev/gemini-api/docs/openai) — uses the `openai` npm package repointed to `https://generativelanguage.googleapis.com/v1beta/openai/`
- **Block Kit** with `text:` fallbacks on every card (screen-reader accessible)
- **Local JSON storage** (`data/logs.json`, `data/config.json`) — no third-party tracking, no external database
- [**Render**](https://render.com) for free hosting + [**UptimeRobot**](https://uptimerobot.com) keep-alive

---

## Setup

### Prerequisites

- Node.js 18+
- A Slack workspace where you can install apps
- A Gemini API key (free tier — generate one at [aistudio.google.com/app/apikey](http://aistudio.google.com/app/apikey))

### 1. Clone & install

```bash
git clone https://github.com/cipoklean/GreenLog.git
cd GreenLog
npm install
```

### 2. Create the Slack app

1. Open [api.slack.com/apps](http://api.slack.com/apps) → **Create New App** → **From an app manifest**
2. Pick your workspace
3. Paste the contents of `manifest.json` into the JSON tab → **Next** → **Create**
4. Click **Install to Workspace** → **Allow**

### 3. Generate tokens

| Variable | Where to find it |
| --- | --- |
| `SLACK_BOT_TOKEN` (`xoxb-...`) | **OAuth & Permissions** → **Bot User OAuth Token** |
| `SLACK_APP_TOKEN` (`xapp-1-...`) | **Basic Information** → **App-Level Tokens** → Generate one with scope `connections:write` |
| `SLACK_SIGNING_SECRET` (32-char hex) | **Basic Information** → **App Credentials** → **Signing Secret** |

### 4. Environment variables

Rename `.env.sample` → `.env` and fill in:

```bash
GEMINI_API_KEY=AIza...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-1-...
SLACK_SIGNING_SECRET=...
```

### 5. Run locally

```bash
node app.js
```

You should see:

```
⚡️ GreenLog is running!
💓 Keep-alive HTTP listening on :3000
```

Verify the health endpoint in another terminal:

```bash
curl http://localhost:3000/health
```

Expected output: `GreenLog is awake`

Then in Slack, try:

```
/greenlog log moved our weekly meeting binders to a shared workspace
```

---

## Project structure

```
greenlog/
├── app.js              # Entry point: Bolt setup, listener wiring, /health server
├── manifest.json       # Slack app manifest
├── lib/                # Core modules
│   ├── llm.js          # Gemini OpenAI-compat client (single LLM seam)
│   ├── triage.js       # Decision parsing → magnitude/direction/category/why
│   ├── errorCard.js    # Single error renderer for all listener failures
│   └── store.js        # JSON read/write for logs + per-workspace config
├── listeners/          # Slack event handlers
│   ├── commands.js     # /greenlog log + /greenlog digest
│   ├── events.js       # @GreenLog mention
│   ├── appHome.js      # App Home view + settings
│   └── actions.js      # Undo button, Run digest now button
├── data/
│   ├── logs.json       # Decision logs
│   └── config.json     # Per-workspace settings (timezone, digest channel)
├── assets/             # App icons referenced in manifest.json
├── package.json        # CommonJS (no "type": "module")
├── .env.sample         # Copy to .env and fill in
├── .gitignore
└── README.md
```

### Architectural disciplines

GreenLog follows two seams:

1. **Single LLM seam** — All Gemini calls go through `lib/llm.js`. Listeners never call the LLM directly, so prompt iteration is one-file.
2. **Single error seam** — Every listener routes failures through one error renderer. No stack traces leak into Slack; users see a screen-reader-friendly Block Kit error card with a request ID.

---

## Sample decisions

Drop these into Slack to see the triage variety:

| Input | Expected output |
| --- | --- |
| `/greenlog log switched our staging cluster from us-east-1 to a renewable-powered region in europe-north` | 🟢🟢🟢 **Large positive** · Energy |
| `/greenlog log booked round-trip flights for the team offsite instead of running it remote` | 🔴🔴 **Medium negative** · Transport |
| `/greenlog log moved our weekly meeting binders to a shared workspace` | 🟢 **Small positive** · Materials |
| `/greenlog log shipped a hotfix for the login flow` | ⚪ **Negligible neutral** · Other — *"This action has no direct environmental signal we can estimate."* |

---

## Deployment

### Render (free tier)

1. Push to GitHub.
2. [render.com](http://render.com) → **New +** → **Web Service** → connect your repo.
3. Settings:
    - **Build command:** `npm install`
    - **Start command:** `node app.js`
    - **Plan:** Free
4. Add all four environment variables in the **Environment** tab.
5. Deploy → wait ~3 minutes → verify `https://your-app.onrender.com/health` returns `GreenLog is awake`.

### UptimeRobot keep-alive

Render's free tier sleeps after 15 minutes of inactivity. To keep GreenLog warm:

1. [uptimerobot.com](http://uptimerobot.com) → **+ New monitor**.
2. Type: **HTTP(s)**.
3. URL: `https://your-app.onrender.com/health`.
4. Interval: **5 minutes**.

---

## Accessibility

GreenLog ships with accessibility built in, not bolted on:

- Every Block Kit card includes a plain-text `text:` fallback for screen readers
- Card colors carry their meaning in shape and label, not just hue (e.g. 🟢🟢🟢 + the word "positive")
- Error cards include plain-English summaries and request IDs — no raw stack traces
- Honest uncertainty cards use explicit language, not just a neutral symbol

---

## Built for the Slack Agent Builder Challenge

- **Track:** Agent for Good
- **Hackathon:** [Slack Agent Builder Challenge 2026](https://slackhack.devpost.com)
- **Builder:** Aghazie David ([@cipoklean](https://github.com/cipoklean))

---

## License

MIT