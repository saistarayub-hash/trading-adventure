'use strict';
/* companion/main.js — Electron shell: the always-on-top side panel.
 *
 * Responsibilities:
 *   • a frameless, always-on-top window docked to a screen edge (a real
 *     "pop-up on the side" that floats above your charting app)
 *   • a bubble mode that shrinks it to a draggable pill
 *   • screen capture via desktopCapturer, with our own window masked out
 *   • the knowledge base + engine, running in-process via companion-core.js
 *   • tray icon and global shortcuts
 *
 * AI calls happen in the renderer (companion.js + ai.js) so API keys never
 * leave this machine and never touch the knowledge-base process. */

const { app, BrowserWindow, screen, desktopCapturer, ipcMain, Tray, Menu, globalShortcut, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const UI_FILE = path.join(ROOT, 'companion.html');

let core = null;
try {
  core = require(path.join(ROOT, 'companion-core')).createCore({
    dataDir: process.env.COMPANION_DATA || path.join(app.getPath('userData'), 'companion-data')
  });
} catch (e) {
  console.error('Could not start the companion engine:', e.message);
}

let win = null;
let tray = null;
let fullBounds = null;
let bubbled = false;
let chosenWindow = null;   // { id, name } when capture mode is 'window'
let hiddenByUser = false;

/* ══════════════════════════════ window ══════════════════════════════ */

function workArea() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return display.workArea;
}

function desiredBounds(bubble) {
  const wa = workArea();
  const s = (core && core.settings) || {};
  if (bubble) {
    const w = 250, h = 68;
    return { x: wa.x + wa.width - w - 16, y: wa.y + wa.height - h - 16, width: w, height: h };
  }
  const width = Math.max(320, Math.min(900, Number(s.width) || 400));
  const x = (s.dock === 'left') ? wa.x : wa.x + wa.width - width;
  return { x, y: wa.y, width, height: wa.height };
}

function createWindow() {
  const s = (core && core.settings) || {};
  const b = desiredBounds(false);

  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    minWidth: 320, minHeight: 260,
    frame: false,
    transparent: false,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    hasShadow: true,
    show: false,
    backgroundColor: '#0b0f16',
    title: 'Trading Companion',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  fullBounds = b;
  applyWindowSettings({ onTop: s.onTop !== false, opacity: s.opacity, dock: s.dock, width: s.width });

  // Keep our own panel out of the screenshots we take of the user's screen.
  try { win.setContentProtection(s.excludeSelf !== false); } catch {}

  win.loadFile(UI_FILE).catch((e) => {
    dialog.showErrorBox('Trading Companion could not start', String(e && e.message || e));
  });

  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('close', () => { try { globalShortcut.unregisterAll(); } catch {} });
  win.on('hide', () => { hiddenByUser = true; send('command', 'hidden'); });
  win.on('show', () => { hiddenByUser = false; send('command', 'shown'); });
  win.on('resized', () => { if (!bubbled) fullBounds = win.getBounds(); });
  win.on('moved', () => { if (!bubbled) fullBounds = win.getBounds(); });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
}

function applyWindowSettings(opts) {
  if (!win) return;
  const o = opts || {};
  if (typeof o.onTop === 'boolean') {
    win.setAlwaysOnTop(o.onTop, 'screen-saver');
    if (o.onTop) { try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {} }
  }
  if (typeof o.opacity === 'number' && o.opacity >= 40 && o.opacity <= 100) {
    win.setOpacity(o.opacity / 100);
  }
  if (!bubbled && (o.dock || o.width)) {
    const b = desiredBounds(false);
    win.setBounds(b);
    fullBounds = b;
  }
}

function setBubble(on) {
  if (!win) return;
  bubbled = !!on;
  if (bubbled) {
    if (!fullBounds) fullBounds = win.getBounds();
    win.setBounds(desiredBounds(true));
    win.setResizable(false);
  } else {
    win.setResizable(true);
    win.setBounds(fullBounds || desiredBounds(false));
  }
  send('command', bubbled ? 'hidden' : 'shown');
}

function toggleVisibility() {
  if (!win) return;
  if (bubbled) { setBubble(false); win.show(); win.focus(); return; }
  if (win.isVisible() && win.isFocused()) { win.hide(); }
  else { win.show(); win.focus(); }
}

function send(channel, payload) {
  try { if (win && !win.isDestroyed()) win.webContents.send('tc:' + channel, payload); } catch {}
}

/* ══════════════════════════════ capture ══════════════════════════════ */

async function captureFrame(opts) {
  const o = opts || {};
  const s = (core && core.settings) || {};
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const scale = display.scaleFactor || 1;
  const thumbSize = {
    width: Math.max(320, Math.round(display.size.width * scale)),
    height: Math.max(200, Math.round(display.size.height * scale))
  };

  let sources = [];
  let usedWindow = false;
  if (s.capture === 'window' && chosenWindow) {
    sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: thumbSize });
    sources = sources.filter((x) => x.id === chosenWindow.id);
    usedWindow = true;
  }
  if (!sources.length) {
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: thumbSize });
    // Prefer the display the cursor is on.
    const match = sources.filter((x) => String(x.display_id) === String(display.id));
    if (match.length) sources = match;
  }
  if (!sources.length) return { ok: false, error: 'No screen source was available to capture.' };

  const src = sources[0];
  const thumb = src.thumbnail;
  if (!thumb || thumb.isEmpty()) {
    return { ok: false, error: 'Captured an empty frame. On Linux/Wayland you may need a screen-share permission or an X11 session.' };
  }

  const quality = Math.round(Math.max(30, Math.min(95, Number(o.quality || s.quality || 0.72) * 100)));
  const jpeg = thumb.toJPEG(quality);
  const dataUrl = 'data:image/jpeg;base64,' + jpeg.toString('base64');

  // Where our own panel sits inside the frame, in image pixels — the renderer
  // paints over it so the coach never reads its own advice off the screen.
  let mask = null;
  if (!usedWindow && s.excludeSelf !== false && win && !win.isDestroyed()) {
    const b = win.getBounds();
    const size = thumb.getSize();
    const k = size.width / Math.max(1, display.size.width);
    mask = {
      x: Math.round((b.x - display.bounds.x) * k),
      y: Math.round((b.y - display.bounds.y) * k),
      w: Math.round(b.width * k),
      h: Math.round(b.height * k),
      width: size.width,
      height: size.height
    };
  }

  return { ok: true, dataUrl, mask, sourceName: src.name, displayId: display.id, at: Date.now() };
}

async function listWindows() {
  const wa = workArea();
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
  return sources
    .filter((s) => s.name && !/^(Trading Companion|Program Manager)$/i.test(s.name))
    .map((s) => ({ id: s.id, name: s.name }))
    .slice(0, 40);
}

async function pickWindow() {
  const list = await listWindows();
  if (!list.length) return { ok: false, error: 'No other windows were found to capture.' };
  return new Promise((resolve) => {
    const menu = Menu.buildFromTemplate(
      list.map((w) => ({
        label: w.name.length > 60 ? w.name.slice(0, 60) + '…' : w.name,
        click: () => {
          chosenWindow = w;
          if (core) core.saveSettings({ capture: 'window' });
          resolve({ ok: true, id: w.id, name: w.name });
        }
      })).concat([{ type: 'separator' }, {
        label: 'Capture the whole screen instead',
        click: () => { chosenWindow = null; if (core) core.saveSettings({ capture: 'screen' }); resolve({ ok: true, id: null, name: 'whole screen' }); }
      }])
    );
    menu.popup({ window: win || undefined, callback: () => { /* dismissed */ } });
    // If the menu is dismissed without a click, resolve so the caller is not stuck.
    setTimeout(() => resolve({ ok: false, error: 'Window picker dismissed.' }), 60000);
  });
}

/* ══════════════════════════════ tray + shortcuts ══════════════════════════════ */

function createTray() {
  try {
    const iconPath = path.join(__dirname, process.platform === 'win32' ? 'icon16.png' : 'icon32.png');
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return;
    if (process.platform === 'darwin') image.setTemplateImage(false);
    tray = new Tray(image.resize({ width: 18, height: 18 }));
    tray.setToolTip('Trading Companion');
    const rebuild = () => {
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: bubbled ? 'Open panel' : 'Show / hide', click: () => toggleVisibility() },
        { label: bubbled ? 'Bubble mode: on' : 'Bubble mode: off', click: () => setBubble(!bubbled) },
        { type: 'separator' },
        { label: 'Look at my screen now', click: () => { if (bubbled) setBubble(false); send('command', 'look'); } },
        { label: 'Start / stop watching', click: () => send('command', 'watch') },
        { type: 'separator' },
        { label: 'Capture a specific window…', click: async () => { await pickWindow(); } },
        { label: 'Quit', click: () => { app.quit(); } }
      ]));
    };
    tray.on('click', () => { toggleVisibility(); rebuild(); });
    tray.on('right-click', rebuild);
    rebuild();
  } catch (e) {
    console.warn('Tray unavailable:', e.message);
  }
}

function registerShortcuts() {
  const map = [
    ['CommandOrControl+Shift+Space', () => toggleVisibility()],
    ['CommandOrControl+Shift+B', () => setBubble(!bubbled)],
    ['CommandOrControl+Shift+L', () => send('command', 'watch')],
    ['CommandOrControl+Shift+K', () => send('command', 'look')]
  ];
  for (const [acc, fn] of map) {
    try {
      const ok = globalShortcut.register(acc, fn);
      if (!ok) console.warn('Shortcut already taken by another app:', acc);
    } catch (e) { console.warn('Shortcut failed:', acc, e.message); }
  }
}

/* ══════════════════════════════ IPC ══════════════════════════════ */

const IPC = {
  state: () => (core ? core.state('electron') : { ok: false, error: 'Engine not available.' }),
  ingestUrl: (p) => core.ingestUrl(p && p.url, p && p.language),
  ingestText: (p) => core.ingestText(p && p.text, p && p.title),
  ingestFile: (p) => core.ingestFile(p),
  sourceText: (p) => core.sourceText(p && p.id, p && p.chunkId),
  removeSource: (p) => core.removeSource(p && p.id),
  search: (p) => core.search(p && p.q, p && p.k),
  pack: (p) => core.pack(p && p.query, p && p.question),
  saveDistill: (p) => core.saveDistill(p && p.sourceId, p && p.result),
  saveCard: (p) => core.saveCard(p),
  removeCard: (p) => core.removeCard(p && p.id),
  addJournal: (p) => core.addJournal(p),
  removeJournal: (p) => core.removeJournal(p && p.id),
  saveSkills: (p) => core.saveSkills(p && p.skills),
  saveSettings: (p) => { const r = core.saveSettings(p && p.settings); applyWindowSettings(r.settings || {}); try { win && win.setContentProtection((r.settings || {}).excludeSelf !== false); } catch {} return r; },
  publishLessons: (p) => core.publishLessons(p && p.lessons),
  exportData: () => core.exportData(),
  importData: (p) => core.importData(p && p.data ? p.data : p),
  wipe: () => core.wipe(),

  capture: (p) => captureFrame(p || {}),
  pickWindow: () => pickWindow(),
  listWindows: () => listWindows(),

  bubble: (p) => { setBubble(!!(p && p.on)); return { ok: true, bubbled }; },
  window: (p) => { applyWindowSettings(p || {}); return { ok: true }; },
  close: () => { if (win) win.hide(); return { ok: true }; },
  quit: () => { app.quit(); return { ok: true }; },
  shellInfo: () => ({
    ok: true,
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    dataDir: core ? core.dataDir : null,
    uiFile: UI_FILE,
    displays: screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor }))
  })
};

function registerIpc() {
  ipcMain.handle('tc:invoke', async (event, channel, payload) => {
    const fn = IPC[channel];
    if (typeof fn !== 'function') return { ok: false, error: 'Unknown channel: ' + channel };
    if (!core && channel !== 'shellInfo') return { ok: false, error: 'The companion engine is not available in this shell.' };
    try {
      return await fn(payload);
    } catch (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }
  });
}

/* ══════════════════════════════ lifecycle ══════════════════════════════ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { setBubble(false); win.show(); win.focus(); } });

  app.whenReady().then(() => {
    if (!fs.existsSync(UI_FILE)) {
      dialog.showErrorBox('Missing UI file', 'Could not find companion.html at:\n' + UI_FILE +
        '\n\nKeep the companion folder inside the project folder.');
      app.quit();
      return;
    }
    if (!core) {
      dialog.showErrorBox('Engine failed to load', 'companion-core.js could not be loaded. Run the app from the project root.');
    }
    registerIpc();
    createWindow();
    createTray();
    registerShortcuts();

    screen.on('display-metrics-changed', () => { if (win && !bubbled) win.setBounds(desiredBounds(false)); });

    app.on('activate', () => { if (win) { win.show(); win.focus(); } });
  });

  app.on('window-all-closed', (e) => {
    // Keep running in the tray; the companion is meant to be always available.
    if (process.platform !== 'darwin' && !tray) app.quit();
  });

  app.on('before-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });
}

process.on('uncaughtException', (e) => {
  console.error('Companion main error:', e && e.stack || e);
});
