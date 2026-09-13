# 🖥 Trading Companion — desktop shell

The always-on-top side panel. This folder is only the **Electron shell**; the brain lives in the
project's `engine/` folder and the UI is `../companion.html` + `../companion.js` + `../companion.css`.
Keep this folder **inside** the project folder — it loads its neighbours by relative path.

## Run

```bash
cd companion
npm install     # one-off: downloads Electron (~150 MB)
npm start
```

From the project root you can also run:

```bash
npm run companion:install   # one-off
npm run companion           # start the panel
```

## What you get

- A frameless window docked to the **right edge** of the screen, floating above your charting app
  (`alwaysOnTop` at screen-saver level, visible on all workspaces).
- **Bubble mode** — shrinks the window to a draggable pill in the corner; click it to expand.
- **Tray icon** — show/hide, bubble mode, look now, start/stop watching, pick a window to capture, quit.
- **Global shortcuts**

  | Shortcut | Action |
  |---|---|
  | `Ctrl/Cmd + Shift + Space` | show / hide |
  | `Ctrl/Cmd + Shift + B` | bubble mode |
  | `Ctrl/Cmd + Shift + L` | start / stop watching |
  | `Ctrl/Cmd + Shift + K` | look at my screen now |

- **Screen capture** via `desktopCapturer` — the whole screen, or one window you pick. Your own panel is
  excluded (window content protection **and** the region is masked out of the frame), so the coach never
  reads its own advice back off the screen.
- The knowledge base runs **in this process** (`companion-core.js`), stored under Electron's user-data
  folder — Settings → Your data shows the exact path.

## Data location

| OS | Path |
|---|---|
| Windows | `%APPDATA%\trading-companion\companion-data\` |
| macOS | `~/Library/Application Support/trading-companion/companion-data/` |
| Linux | `~/.config/trading-companion/companion-data/` |

Override with `COMPANION_DATA=/some/folder npm start` — useful to share one knowledge base between the
desktop app and `node server.js`.

## Security

`preload.js` exposes exactly one function (`invoke`) with an **explicit channel allow-list**, plus two
event subscriptions. `contextIsolation` is on, `nodeIntegration` is off, and the renderer can never reach
`fs`, `child_process`, or arbitrary IPC. External links open in your real browser, never inside the panel.

## Linux / Wayland note

`desktopCapturer` needs an X11 session, or a Wayland compositor that supports the screen-share portal.
If frames come back empty, switch to "capture a specific window", or run the browser mode
(`node server.js` → `http://localhost:8081/companion`).

## Packaging (optional)

The shell has no build step and no dependencies other than Electron. To ship an installer, add
[`electron-builder`](https://www.electron.build/) as a dev dependency and point it at this folder, making
sure the parent project files (`engine/`, `companion-core.js`, `companion.html/.js/.css`, `ai.js`) are
included as extra resources — the panel loads them by relative path.

📘 Full guide: [`../README-companion.md`](../README-companion.md)
