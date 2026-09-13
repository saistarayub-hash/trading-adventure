# 🦊 Trading Companion — your live side-panel coach

A small always-on-top window that sits on the side of your screen while you look at charts.
You feed it **videos and links**, it turns them into a searchable playbook, and then it **watches your
screen** and teaches you in the moment: what it sees, the rule that applies, the risk, and one thing to learn.

It works **with no API key at all** (offline demo mode, using the built-in 20-module curriculum plus a
real pixel-level chart reader), and gets much sharper once you connect a brain.

> ⚠️ This is an **education tool, not financial advice** and not a signal service. It will never tell you
> to buy or sell. Trade on a demo account until your process is boring and consistent.

---

## 1. Run it

### Option A — the desktop app (recommended: real always-on-top side panel)

```bash
cd companion
npm install        # downloads Electron once, ~150 MB
npm start          # or from the project root: npm run companion
```

You get a frameless panel docked to the **right edge** of your screen, floating above your charting app.

| Shortcut | What it does |
|---|---|
| `Ctrl/Cmd + Shift + Space` | Show / hide the panel |
| `Ctrl/Cmd + Shift + B` | **Bubble mode** — shrink it to a draggable pill in the corner |
| `Ctrl/Cmd + Shift + L` | Start / stop screen watching |
| `Ctrl/Cmd + Shift + K` | "Look at my screen" once, right now |
| `Ctrl/Cmd + Enter` | Ask the coach about the current screen |

There is also a **tray icon**: show/hide, bubble mode, look now, start/stop watching, pick a specific
window to watch, quit. Closing the window hides it — quit from the tray.

Settings → **Window** lets you dock it left or right, change width, opacity and always-on-top.

### Option B — one-click install (installer scripts)

```bash
./install.sh          # macOS / Linux: deps + launcher in ~/.local/bin + menu entry
install.bat           # Windows: deps + Desktop & Start-Menu shortcuts (no admin needed)
```

Add `--installer` / `/installer` to also build a **real installer**: a Windows Setup `.exe` (NSIS),
a macOS `.dmg` (x64 + arm64), or a Linux AppImage + `.deb`, into `companion/release/`.
`--remove` / `/remove` undoes the shortcuts; `--dry-run` / `/dry` shows what would happen.

### Option C — in the browser (no install)

```bash
node server.js
# open http://localhost:8081/companion
```

Same interface. Screen watching uses the browser's share-screen prompt instead of silent capture, and
the panel cannot float over *other* applications. Great for trying it out or using it on a second monitor
in its own window.

### Which one should I pick?

| | Desktop (A) | Installer (B) | Browser (C) |
|---|---|---|---|
| Floats above your charting app | ✅ | ✅ | ❌ |
| Silent capture, no prompt | ✅ | ✅ | share prompt |
| Needs Node.js | ✅ | ✅ | ✅ (server) |
| Needs Electron download | ✅ | ✅ | ❌ |
| Good for a first look | | | ✅ |

### Try it with sample material first

```bash
node tools/seed-demo.js
```

That loads five short starter texts (market structure, the 1% rule, breakouts, psychology, levels and
liquidity) so search, citations and coaching have something to quote before you feed it your own videos.

---

## 1b. Android / iPhone

There is no Electron on a phone, and Android will not let one app float over your banking app anyway —
so the companion installs as a **full-screen app (PWA)** and gets a superpower instead: **your camera
becomes the screen share**.

**Install (30 seconds):**

1. Run the server somewhere your phone can reach: same Wi-Fi (`http://192.168.x.x:8081`) or a tunnel /
   Render deploy for away-from-home (see the main README's *Hosting* section).
2. On the phone, open `http://…:8081/companion` in Chrome (Android) or Safari (iOS).
3. Android: the **📲 Install as an app** button appears in Settings (or browser menu → *Add to Home
   screen*). iOS: *Share → Add to Home Screen*. You get a home-screen icon, full-screen window, offline
   shell and home-screen shortcuts ("Look", "Feed").
4. First launch: Settings → **Companion server** — enter the URL (and the server token if you are not on
   your LAN; set `COMPANION_TOKEN=…` when starting the server). The token is stored **on the phone only**.

**Coach through the camera:** Settings → Screen watching → capture source **📷 Camera**, prop the phone
up, point it at your monitor, press **▶ Start watching**. Every interval the frame goes through the exact
same pipeline as a desktop screenshot: offline pixel reader → your playbook citations → coach card.
(On a phone this is the default source, because phones have no screen-share API.)

**Want a real .apk instead?** The repo ships a Capacitor shell:

```bash
node tools/make-mobile.js        # exports the UI to mobile/www (verified self-contained)
cd mobile && npm install
npx cap add android && npx cap sync
npx cap open android             # Android Studio → Run / Build APK
```

The APK is the same web app in a WebView; enter your server URL once in Settings. Building the APK needs
the Android SDK on your machine (Android Studio installs it). `mobile/android/`, `mobile/www/` are
gitignored — they are generated, not source.

---

## 2. Your first 10 minutes

1. **Feed** tab → paste a YouTube link (a trading lesson you like) → **📥 Learn these**.
   Captions, chapters, title and description are pulled automatically and chopped into searchable pieces.
2. On that source, press **✨ Distil into playbook**. The AI converts it into strategy cards:
   setup → entry → invalidation → target → risk → pre-trade checklist.
3. **Coach** tab → **▶ Start watching** → put a chart on screen (TradingView, your broker, a demo account).
4. Every few seconds a card appears: 👀 what I see · 📏 the rule · ✅ what to do · ⚠️ risk · 🎓 learn this.
   Cards only appear when something **meaningfully changed** — it does not nag you every 8 seconds.
5. **Learn** tab shows your next best lesson, ranked by your weakest quiz topics *and* by what your own
   library does not cover yet.

---

## 3. Feeding it (what works, what does not)

| You give it | What happens |
|---|---|
| **YouTube link** (watch / youtu.be / shorts / embed / live) | Pulls captions (prefers human captions over auto-generated), chapters, title, description. 12 links at a time. |
| **Article / blog / docs link** | Fetches the page, strips nav/scripts/cookie banners/footers, keeps the main body, headings and author. |
| **PDF link or upload** | Extracts text from FlateDecode streams (works for text PDFs; scanned image-only PDFs cannot be read offline). |
| **Pasted text** | Anything: a transcript you copied yourself, your own notes, a strategy write-up, a chat log. |
| **File upload** | `.txt .md .csv .json .srt .vtt .html .pdf` — subtitle files have timestamps and `[Music]` stripped. |
| Vimeo / Twitch / TikTok / X / Instagram / MP3 | **Not supported** (they block scraping). Open the transcript yourself, copy it, paste it. It learns it identically. |
| A video with **captions turned off** | It learns title + chapters + description and tells you so, with instructions for pasting the transcript. |

Everything you feed is chunked, embedded **locally** and indexed with BM25. Retrieval is hybrid, so a
question like *"where does my stop go on a breakout retest"* pulls the exact passage from *your* material,
and the coach quotes it with `[1]`-style citations you can click to read in full.

### Distilling = the actual "learning"

Search alone just finds quotes. **Distil** is what turns a 40-minute video into a card you can trade from:

```
🎯 Retest entry
SETUP         A level breaks with volume and price returns to it.
ENTRY         First close back in the breakout direction.
INVALIDATION  A close back inside the old range.
TARGET        Range height projected from the break.
RISK          1%, stop inside the range.
CHECKLIST     ☐ Did volume expand?  ☐ Is this the first retest?
MISTAKES      Chasing the first candle out of the range.
```

The live coach prefers **your** cards over generic advice, and you can publish any card as a lesson into
the main **Professor Fox** app (`📤 Publish as lesson`) so it shows up with quizzes and points there too.

---

## 4. How screen watching works

Two independent readers run on every frame:

**1. The offline pixel reader (no AI, no key).** Your screenshot is downsampled and every pixel is
classified as green ink, red ink or bright ink into a 64×40 grid. From that grid the engine reconstructs a
rough price path column by column and measures:

- trend (linear-regression slope of the path) and how strong it is
- momentum (green share in the right half vs the left half)
- volatility (path range and average candle spread) and expansion spikes
- where the latest candles sit in the visible range (top / middle / bottom)
- whether the screen is even a chart (a white document page or a watchlist is detected as "not a chart")

It is approximate and it says so — but it is instant, private, free, and it is **fed to the AI as a hint**,
which measurably improves small models on chart images.

**2. The vision model (when connected).** Your screenshot plus the offline pre-read plus quotes from your
library plus your playbook plus your recent journal go to a vision model under a strict JSON contract:
screen type, symbol, timeframe, trend, structure, patterns, levels, indicators, momentum, risk flags,
what to notice, the disciplined next step, and the one lesson this screen teaches.

Then the coach:

- **grounds** the answer in your library (citations, never invented prices or indicators),
- **rate-limits itself** — it compares a "scene key" (trend + momentum + volatility + position + patterns +
  flags) with the last card and stays quiet unless something changed or the cooldown expired,
- **picks a lesson** from the 20-module curriculum based on the regime on screen and your weakest topics,
- **always includes one risk point**, using *your* configured risk %, and
- **never says "buy" or "sell"** — that is a hard rule in its system prompt.

Your own panel is masked out of its own screenshots (window content protection plus painting over the
region), so the coach never reads its own advice back off the screen.

---

## 5. Connecting a brain (optional but recommended)

Settings → **Brain**. Keys are stored **only on your machine** and calls go straight from the app to the
provider — never through the server that holds your knowledge base.

| Provider | Cost | Vision? | Notes |
|---|---|---|---|
| **Google Gemini** | Free tier | ✅ | Easiest start: free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **OpenAI** | Paid | ✅ | `gpt-4o-mini` is cheap and good at chart reads |
| **Anthropic** | Paid | ✅ | Claude haiku/sonnet |
| **OpenRouter** | Pay-as-you-go | ✅ | One key, many models |
| **Groq** | Free tier | ✅ | Very fast; Llama 4 Scout |
| **Google Gemini** on a phone | Free tier | ✅ | The PWA talks straight to the provider from the phone, same as desktop. |
| **Ollama** | Free, local | ✅ with a vision model | `ollama pull llama3.2-vision` (or `llava`). Nothing leaves your PC. |
| **LM Studio** | Free, local | ✅ with a vision model | Local server on `http://localhost:1234` |

The app picks a **separate vision model** for screenshots, so you can keep a fast text model and a
vision-capable one at the same time. If your provider cannot see images, the app says so and keeps using
the offline reader.

**Token cost tip:** 8-second intervals at balanced quality is roughly 4–5 requests/minute while you watch.
Use `calm` sensitivity, a 15–30s interval, or `low` image quality to cut that down. Offline demo mode
costs nothing and still teaches.

---

## 6. The curriculum (built in, no key needed)

20 modules in 4 levels, each with rules, entry/invalidation/target, risk note, a practice drill,
"what to watch for on your screen", common beginner mistakes, and scenario quizzes:

- **🌱 Foundation** — what moves price · market structure · candle anatomy · support/resistance · the 1% rule
- **📖 Reading charts** — trend + pullback · breakouts & fakeouts · chart patterns · volume · multi-timeframe
- **🎯 Playbooks** — supply/demand & order blocks · a complete moving-average system · RSI & divergence · range trading · liquidity sweeps
- **🧠 Execution & mind** — trading plan · journaling · psychology & tilt · backtesting & expectancy · building your own edge

It is deliberately **market-agnostic** (crypto, stocks and forex alike) because the fundamentals are the
same, and risk management is never allowed to sink to the bottom of your plan.

Your **skill profile** tracks exposure and quiz accuracy per topic; the planner promotes what you keep
getting wrong and what your fed library does not cover.

---

## 7. Journal and reviews

Save any coaching card to the journal with one click, or log trades and **rule breaks** yourself.
The journal does three jobs: it stops the coach repeating itself (recent entries go into its prompt),
it surfaces patterns ("3 rule breaks, all widening a stop"), and **✨ Weekly review** turns your entries
into specific feedback with fixes for next week.

---

## 8. Your data, privacy and safety

- **Knowledge base**: one JSON file. Desktop app → your Electron user-data folder; server mode → `./.data/knowledge.json`
  (shown at the bottom of Settings). Export / import / erase from Settings → Your data.
- **API keys**: localStorage on your machine only. The server never sees them.
- **Screenshots**: processed in memory and sent only to the AI provider *you* chose. Nothing is stored on disk.
  Offline demo mode sends nothing anywhere.
- **Companion API access**: limited to this machine / your local network, or a signed-in creator account.
  `X-Forwarded-For` is deliberately **not** trusted for that decision. Remote callers can never make your
  server fetch localhost, private IPs, or cloud metadata endpoints (SSRF guard), and non-http schemes are refused.
  Behind a proxy that hides the peer address, set `COMPANION_OPEN=1` or `COMPANION_TOKEN=…`.
- **`.gitignore`** keeps `.data/`, `users.json`, `lessons.json` and `node_modules/` out of git.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| "Screen capture was blocked" (browser) | Allow the share prompt; it must be triggered by a click. Some embedded frames block `getDisplayMedia` — open the page in its own tab. |
| Empty frames on Linux/Wayland | Screen capture needs an X11 session or a compositor that supports the portal API. Try "capture a specific window", or use the browser mode. |
| YouTube: "no downloadable captions" | Open the video → `…` → *Show transcript* → copy → paste into **Feed → Paste text**. It learns the whole thing. |
| A page yields "almost no readable text" | It is a JavaScript app, a video player or a paywall. Paste the text manually. |
| "The brain did not return valid JSON" | Retry, or switch to a stronger model. The engine retries once automatically with a stricter instruction. |
| The coach repeats itself | Raise sensitivity to `calm`, or feed it more material — repetition usually means the scene genuinely has not changed. |
| Panel is in the way | `Ctrl/Cmd+Shift+B` for bubble mode, or reduce opacity in Settings → Window. |
| Port 8081 busy | `PORT=9000 node server.js` |

---

## 10. How it is built

Zero runtime dependencies. Node 18+ (built-in `fetch`), vanilla JS, no build step.

```
engine/                 the brain — pure, dependency-free, unit-tested
  net.js                HTTP with redirects, timeouts, byte caps, real User-Agent
  text.js               HTML → main-body text, PDF → text (zlib), entity decoding, cleanup
  youtube.js            watch-page scrape (brace-depth JSON scanner), caption tracks,
                        JSON3/XML captions, chapters, timedtext fallback
  ingest.js             one entry point: url · youtube · text · file · many
  chunk.js              sentence-aware sliding-window chunking + keyphrases
  embed.js              local feature-hashing embeddings (signed, sublinear tf, L2) + topic tagger
  bm25.js               Okapi BM25 lexical index
  kb.js                 knowledge base: sources, chunks, vectors, hybrid search,
                        source-diverse results, citation context, cards, journal, skills
  vision.js             offline pixel chart reader + vision-model prompt/JSON contract
  curriculum.js         20 modules, skill profile, adaptive planner, quizzes, lesson export
  distill.js            source → strategy cards / terms / quizzes / lessons (prompts + strict parsers)
  coach.js              the live coaching loop, scene-key rate limiting, offline fallback

companion-core.js       operations layer shared by both shells
server-companion.js     HTTP adapter: auth gate, SSRF guard, routing
server.js               existing app server + /api/companion/* + /companion
companion.html/.css/.js the UI (runs in Electron and in the browser unchanged)
companion/main.js       Electron: always-on-top window, tray, shortcuts, desktopCapturer, IPC
companion/preload.js    contextBridge with an explicit channel allow-list
ai.js                   multi-provider AI layer + vision() and json() extensions
tools/seed-demo.js      starter library so you can try it immediately
test-companion.js       311 tests: engine, parsers, security gate, live HTTP, UI wiring
```

The UI runs the *reasoning* (prompts, parsing, offline reading, curriculum) locally and the *storage*
(indexing, retrieval, persistence) through either IPC or HTTP — which is why API keys never have to meet
the knowledge base.

```bash
npm test          # existing app (24) + companion (311)
```
