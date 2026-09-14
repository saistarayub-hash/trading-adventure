# Changelog

All notable work on this repository. The project started as *Professor Fox's Trading Adventure*
(a kid-friendly trading-education web app) and grew a second, grown-up product: the **Trading
Companion** — an always-on-top coaching panel with a retrieval-augmented brain.

## [1.1.0] — Trading Companion release

### Added — the companion brain (`engine/`, zero dependencies, Node 18+)
- `net` `text` `youtube` `ingest`: fetch with redirects/caps; HTML main-body extraction with
  boilerplate removal; PDF text via zlib; YouTube watch-page scraping (brace-depth JSON scanner),
  caption-track selection (manual > auto), JSON3/XML caption decoding, chapters, timedtext
  fallback; SRT/VTT subtitle parsing
- `chunk` `embed` `bm25` `kb`: sentence-aware sliding-window chunking with keyphrases; local
  256-dim feature-hashing embeddings; Okapi BM25; a knowledge base with **hybrid retrieval**,
  source-diverse results, click-through citations, coverage-gap analysis, strategy cards,
  journal and skill profile
- `vision`: offline pixel-level chart reader (64×40 ink grid → trend, momentum, volatility,
  position, chart-vs-not) plus the vision-model prompt and strict JSON contract
- `curriculum`: 20 market-agnostic modules in 4 levels with drills, mistakes, scenario quizzes
  and an adaptive planner; `distill`: source → strategy cards / glossary / quiz / lesson
- `coach`: the live loop — scene-key rate limiting (speaks only when something changed), KB
  grounding with citations, risk always sized to your configured %, full **no-key offline mode**

### Added — shells
- `companion/` Electron shell: frameless always-on-top window docked to a screen edge, bubble
  mode, tray, global shortcuts, desktopCapturer with self-masking, allow-listed IPC preload
- `companion.html/.css/.js`: one UI for Electron and browser; five tabs + settings
- `companion-core.js` + `server-companion.js`: shared operations layer and a thin HTTP adapter
  behind a socket-peer access gate with an SSRF guard (X-Forwarded-For is never trusted)
- `ai.js` gained `vision()` and `json()` across all providers, with a separate vision model

### Added — install everywhere
- `install.sh` / `install.bat`: one-click installers (launcher + menu entries / shortcuts),
  `--installer` builds real packages, `--remove`, `--dry-run`
- electron-builder 26 config validated against its official JSON schema: NSIS Setup .exe,
  unsigned dmg (x64+arm64), AppImage + deb; packaged-mode path resolution via `app.isPackaged`
- `tools/make-icons.js`: every icon generated from one vector description — runtime PNGs,
  `.ico` (7 entries), `.icns` (11 Apple slots), PWA any+maskable icons; self-verifying
- **Android**: installable PWA (manifest, conservative service worker, install prompt,
  home-screen shortcuts), **camera-as-screen-share** coaching, remote server URL + token
  (device-local only), and a Capacitor shell; `.github/workflows/android-apk.yml` builds a real
  signed APK on GitHub runners and mirrors it to the `apk-artifact` branch

### Added — docs & safety
- `README-companion.md` (full guide), `companion/README.md`, README sections, `docs/rebrand-brief.md`
- `.gitignore` now excludes `.data/`, `users.json`, `lessons.json`, generated native projects,
  release output and the `.secret` signing key `auth.js` creates

### Fixed
- `npm test` silently stopped after suite A (exit code 1 despite passing) — the companion-link
  boot snippet now guards on `document.getElementById` existing under the test harness's DOM stub
- Access gate trusted `X-Forwarded-For` (spoofable) — now uses the socket peer; token and creator
  sessions remain as explicit escapes; LAN callers can no longer probe localhost/metadata
- Topic tagging noise floor: one stray word no longer tags a whole document

### Verified
- 439 assertions across three suites (`npm test`), icon round-trips, installer dry-runs,
  self-contained mobile export, live HTTP end-to-end, and the CI-built APK parsed back
  (zip structure, payload, debug signature)

## [1.0.0] — Professor Fox's Trading Adventure (pre-existing)
- Landing page, lessons + quizzes, stars/levels/streaks, family accounts, leaderboard,
  multi-provider AI chat ("Ask Fox"), plug-ins, no-dependency Node server
