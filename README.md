# 🦊 Professor Fox's Trading Adventure

Learn trading the easy way — written like a 10-year-old would understand it.
Short fun lessons, friendly quizzes, points and levels that add up, and your own AI tutor fox.

---

## 🖥 New: the Trading Companion

A second app for the person actually sitting at the charts: an **always-on-top side panel** that you feed
videos and links, which then **watches your screen and teaches you while you trade**.

* 📥 **Feed it** — YouTube links, articles, PDFs, subtitle files or pasted notes/transcripts.
* 🧠 **It learns them properly** — text is extracted, chunked, embedded **locally** and indexed with both
  BM25 and vector search, so retrieval is hybrid, fast and click-through citable.
* ✨ **Distil** any source into strategy cards: setup → entry → invalidation → target → risk → checklist.
* 👀 **Watch mode** — screenshots every few seconds; an offline pixel-level chart reader plus (optionally)
  a vision model; the coach speaks up **only when something meaningful changed**.
* 🎯 Every card reads: 👀 what I see · 📏 the rule · ✅ what to do · ⚠️ risk · 🎓 learn this — grounded in
  **your** material, never generic filler, and it never says "buy" or "sell".
* 📚 A built-in **20-module curriculum** adapts to your weakest topics *and* to the gaps in your library.
* 📓 Journal, rule-break tracking and a **✨ weekly review** that turns your entries into feedback.
* 🔓 Works with **no API key at all** (offline demo mode). Add a brain when you want the vision model.
* 🖱 Run it as a real desktop window, or in the browser with the identical interface.

```bash
./install.sh            # one-click install on macOS/Linux (install.bat on Windows)
./install.sh --installer   # …and build a real Setup.exe / .dmg / AppImage+.deb
cd companion && npm install && npm start   # or run the desktop panel straight from the repo
node server.js                             # or browser: http://localhost:8081/companion
node tools/seed-demo.js                    # optional: load a starter library to try it immediately
```

📘 **Full guide → [`README-companion.md`](README-companion.md)** ·
🖥 **Desktop shell → [`companion/README.md`](companion/README.md)**

---

## Quick start

Simplest way — just double-click **`index.html`**. Everything runs in your browser. No install.

Or, if you have Node.js:

```bash
node server.js
# open http://localhost:8081
```

With the server running you also get:

- **Accounts & saved progress** — open "Save your adventure!" and sign up (username/password **or
  "Sign in with Google"**). Your stars, streaks and levels are stored on the server (`users.json`),
  so you can log in from any device. If the server is offline, the app still works as a guest and
  keeps progress in that browser until you log in again.
- **Self-updating lessons** — lessons are stored on the server too (`lessons.json`). The creator
  account (by default the username **`yubi`**) sees an **"Add / edit a lesson"** card on the home
  page and can publish new lessons that appear for everyone instantly — no redeploy needed.
- **Share with friends on your Wi-Fi** — the server prints a `http://192.168.x.x:8081` address at
  startup. Anyone on your network can open it.
- **Put it on the real internet in ~2 minutes** — see *Hosting* below.

### Turning on "Sign in with Google"

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an
   **OAuth 2.0 Client ID** (Application type: **Web application**).
2. In **Authorized JavaScript origins** add your site URL (e.g. `https://your-site.onrender.com`).
3. Set the **Client ID** as the environment variable `GOOGLE_CLIENT_ID` on your host (Render).
4. The "Sign in with Google" button then appears on the login card.

### Making yourself the creator (so you can add lessons)

Sign up with the username exactly **`yubi`** (any password) — that account automatically gets the
👑 creator badge and the lesson editor. The creator name is set with the `CREATOR` environment
variable (default `yubi`).

## Hosting (share it anywhere on the internet)

### Option 1 — free instant tunnel (for a temporary link)

If you have a healthy internet connection on this PC, install **cloudflared** once
(see [developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads)),
then:

```bash
node server.js          # in one terminal
cloudflared tunnel --url http://localhost:8081   # in another
```

It prints a public `https://….trycloudflare.com` link. Send that link to anyone — they can sign up
and save their progress on your PC's server. (The link changes every restart.)

### Option 2 — free hosting with Render (keeps running even when your PC is off)

1. Put this folder on GitHub (a repo whose root is the `trading-tutor` folder).
2. On [render.com](https://render.com) → **New** → **Web Service** → connect the repo.
3. Values: **Build command** leave empty · **Start command** `node server.js`
   · **Instance type** Free.
4. Render sets the `PORT` automatically. Open the URL it gives you.

That's it — open sign-up, accounts, and per-user saved progress work.

Notes:

- Render's free disk is **temporary**: `users.json` may be wiped when the server restarts. Only a few
  dozen accounts → fine for friends and family. For a bigger audience, either pay for a persistent
  disk on Render/Railway, or back up `users.json` from your `node server.js` run occasionally.
- You can also use [Railway](https://railway.com) with the same `node server.js` command.

### A note about cookies vs tokens

Logging in hands your browser a signed token (stored in localStorage) that lets it update your
progress. This was deliberately kept dependency-free and simple. For a serious production launch
(preventing duplicate accounts, abuse, or shared-PC account hijacking) you would add proper account
verification — the current setup is perfect for learning communities, classrooms and family fun.

## Waking up the Fox brain (the AI)

The fox needs a "brain" (a language model) to make stories, answer questions, and invent brand-new
quiz questions. You can plug in **any of these** inside the app: open the **"Ask Fox"** button →
**⚙️ Brain settings** → pick a provider → press **↻ Wake up**.

| Provider | Cost | How to set it up |
|---|---|---|
| **Ollama** (runs on your PC) | Free, no key | Download from [ollama.com](https://ollama.com), install, then open a terminal and run `ollama pull llama3.2` (or `ollama pull tinyllama` on a weaker PC). Selected by default. |
| **Groq** | Free tier | Create a free account at [groq.com](https://groq.com) → API Keys → paste the key into the app. |
| **Google Gemini** | Free tier | Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → paste it in. |
| **OpenAI (ChatGPT)** | Paid | [platform.openai.com](https://platform.openai.com) → API keys. |
| **Anthropic (Claude)** | Paid | [console.anthropic.com](https://console.anthropic.com) → API keys. |
| **OpenRouter** | Pay-as-you-go / free models | [openrouter.ai](https://openrouter.ai) → API keys. |
| **LM Studio** | Free, runs on your PC | Install [lmstudio.ai](https://lmstudio.ai), start the local server (default `http://localhost:1234`). |

- API keys are stored **only in your own browser** (localStorage). They are never uploaded anywhere —
  the app talks straight to the provider you chose.
- When no brain is online, the app still works fully offline with the built-in lessons and questions.
  The AI features (stories, chat, fresh questions) just light up once a brain wakes up.

## How it works

- **Lessons** — 8 short lessons: Money 101, Stocks & Shares, The Stock Market, Bull vs Bear,
  Supply & Demand, The Golden Rule (Risk), Reading a Candle, Long vs Short.
- **Quizzes** — multiple-choice questions after each lesson. Points add up:
  - +10 first try · +5 second try · +2 later tries · +5 first-time bonus per lesson
- **Levels** — climb from 🌱 Money Beginner all the way to 👑 Market Master.
- **Streaks** — answer on the first try to keep your 🔥 streak alive.
- **Ask Fox** — chat with the AI tutor about anything, with kid-friendly answers.

## Files

- `index.html` — app shell
- `styles.css` — playful kid-friendly theme
- `lessons.js` — built-in lessons, questions, and explanations (offline content)
- `ai.js` — multi-provider AI layer (Ollama, OpenAI, Anthropic, Gemini, Groq, OpenRouter, LM Studio)
- `app.js` — quiz engine, scoring, levels, chat UI, accounts, Google sign-in, lesson editor
- `auth.js` — user accounts, secure password hashing, signed tokens, progress storage, Google users
- `server.js` — web server + accounts/lessons API (`/api/…`) + the companion API (`/api/companion/…`)
- `lessons.json` — lessons you publish from the editor (created automatically)
- `test.js` — smoke tests (run with `node test.js`)

**The Trading Companion** ([full guide](README-companion.md)):

- `engine/` — the companion's brain, zero dependencies: `net` `text` `youtube` `ingest` `chunk` `embed`
  `bm25` `kb` `vision` `curriculum` `distill` `coach`
- `companion.html` / `companion.css` / `companion.js` — the companion UI (Electron and browser, unchanged)
- `companion-core.js` — storage + operations layer shared by both shells
- `server-companion.js` — HTTP adapter: local/creator access gate and SSRF guard
- `companion/` — the Electron desktop shell (always-on-top window, tray, shortcuts, screen capture)
- `tools/seed-demo.js` — loads a starter library so you can try it right away
- `test-companion.js` — 311 tests for everything above (run with `node test-companion.js`)

## Fun safety rule

Everything here is **pretend-info for learning**. Real trading can lose real money.
Rule #1 of trading, taught in Lesson 6: **never risk more than you can afford to lose**.
This tool is for education, not financial advice — the Trading Companion included. It teaches a process;
it does not give signals, and it will refuse to.