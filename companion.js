'use strict';
/* companion.js — UI + orchestration for the Trading Companion.
 *
 * It runs in three shells and does not care which one:
 *   1. Electron always-on-top window → talks to the engine over IPC (window.companion)
 *   2. Browser tab / live preview    → talks to server.js over HTTP (/api/companion/*)
 *   3. Plain file:// with no server  → coach + curriculum still work offline (no persistence)
 *
 * AI calls always happen HERE, in the renderer, so API keys stay on your machine
 * and are never sent to the server that holds your knowledge base. */

/* ══════════════════════════════ tiny helpers ══════════════════════════════ */

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - Number(ts || 0)) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

function fmtClock(ts) {
  const d = new Date(Number(ts || Date.now()));
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtNum(n) { return (Number(n) || 0).toLocaleString(); }

function debounce(fn, ms) {
  let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms || 250); };
}

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .35s'; setTimeout(() => el.remove(), 380); }, 4200);
}

function setStatus(msg) { const el = $('#sbLeft'); if (el) el.textContent = msg || ''; }

function logLine(text, kind) {
  const box = $('#ingestLog');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'log-line ' + (kind || '');
  el.textContent = text;
  box.prepend(el);
  while (box.children.length > 24) box.lastChild.remove();
}

function setLight(id, state, title) {
  const el = $(id);
  if (!el) return;
  el.className = 'light ' + (state || '');
  if (title) el.title = title;
}

/* ══════════════════════════════ backend bridge ══════════════════════════════ */

const Backend = (function () {
  const ipc = (typeof window !== 'undefined' && window.companion) ? window.companion : null;
  const shell = ipc ? 'electron' : 'browser';
  const fileOnly = !ipc && (typeof location !== 'undefined' && location.protocol === 'file:');

  async function api(path, opts) {
    const o = opts || {};
    // Remote mode: a phone (PWA or APK) can talk to the companion server over
    // the internet when you give it the URL + the token from Settings.
    const base = (Conn.url || '').replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (Conn.token) headers['X-Companion-Token'] = Conn.token;
    const res = await fetch(base + '/api/companion' + path, {
      method: o.method || 'GET',
      headers,
      body: o.body ? JSON.stringify(o.body) : undefined
    });
    let j = null;
    try { j = await res.json(); } catch { j = { ok: false, error: 'Bad response from the server (' + res.status + ').' }; }
    if (!res.ok || !j || j.ok === false) throw new Error((j && j.error) || ('Request failed (' + res.status + ')'));
    return j;
  }

  const noBackend = { ok: false, error: 'No server or desktop shell available.' };

  return {
    shell, isElectron: !!ipc, fileOnly,

    async state() {
      if (ipc) return ipc.invoke('state');
      if (fileOnly) return noBackend;
      return api('/state');
    },
    async ingestUrl(url, language) {
      if (ipc) return ipc.invoke('ingestUrl', { url, language });
      return api('/ingest/url', { method: 'POST', body: { url, language } });
    },
    async ingestText(text, title) {
      if (ipc) return ipc.invoke('ingestText', { text, title });
      return api('/ingest/text', { method: 'POST', body: { text, title } });
    },
    async ingestFile(file) {
      if (ipc) return ipc.invoke('ingestFile', file);
      return api('/ingest/file', { method: 'POST', body: file });
    },
    async sourceText(id) {
      if (ipc) return ipc.invoke('sourceText', { id });
      return api('/sources/' + encodeURIComponent(id) + '/text');
    },
    async removeSource(id) {
      if (ipc) return ipc.invoke('removeSource', { id });
      return api('/sources/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    async search(q, k) {
      if (ipc) return ipc.invoke('search', { q, k });
      return api('/search', { method: 'POST', body: { q, k } });
    },
    async pack(query, question) {
      if (ipc) return ipc.invoke('pack', { query, question });
      try { return await api('/pack', { method: 'POST', body: { query, question } }); }
      catch { return { ok: true, kbContext: { hits: [], block: '' }, playbook: '', cards: [], journal: [] }; }
    },
    async saveDistill(payload) {
      if (ipc) return ipc.invoke('saveDistill', payload);
      return api('/distill', { method: 'POST', body: payload });
    },
    async saveCard(card) {
      if (ipc) return ipc.invoke('saveCard', card);
      return api('/cards', { method: 'POST', body: card });
    },
    async removeCard(id) {
      if (ipc) return ipc.invoke('removeCard', { id });
      return api('/cards/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    async addJournal(entry) {
      if (ipc) return ipc.invoke('addJournal', entry);
      return api('/journal', { method: 'POST', body: entry });
    },
    async removeJournal(id) {
      if (ipc) return ipc.invoke('removeJournal', { id });
      return api('/journal/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    async saveSkills(skills) {
      if (ipc) return ipc.invoke('saveSkills', { skills });
      return api('/skills', { method: 'PUT', body: { skills } });
    },
    async saveSettings(settings) {
      if (ipc) return ipc.invoke('saveSettings', { settings });
      return api('/settings', { method: 'PUT', body: { settings } });
    },
    async publishLessons(lessons) {
      if (ipc) return ipc.invoke('publishLessons', { lessons });
      return api('/publish', { method: 'POST', body: { lessons } });
    },
    async exportData() {
      if (ipc) return ipc.invoke('exportData');
      return api('/export');
    },
    async importData(data) {
      if (ipc) return ipc.invoke('importData', data);
      return api('/import', { method: 'POST', body: data });
    },
    async wipe() {
      if (ipc) return ipc.invoke('wipe');
      return api('/wipe', { method: 'POST' });
    },
    /* ---- screen capture (or the camera, on phones) ---- */
    async capture(opts) {
      if (captureSource() === 'camera') return CameraCapture.frame(opts || {});
      if (ipc) return ipc.invoke('capture', opts || {});
      return BrowserCapture.frame(opts || {});
    },
    async pickWindow() {
      if (ipc) return ipc.invoke('pickWindow');
      return { ok: false, error: 'Window picking needs the desktop app.' };
    },
    /* ---- window controls ---- */
    async bubble(on) { if (ipc) return ipc.invoke('bubble', { on }); return null; },
    async window(opts) { if (ipc) return ipc.invoke('window', opts || {}); return null; },
    async close() { if (ipc) return ipc.invoke('close'); },
    onFrame(cb) { if (ipc && ipc.onFrame) ipc.onFrame(cb); },
    onCommand(cb) { if (ipc && ipc.onCommand) ipc.onCommand(cb); },
    async openFileDialog() { if (ipc) return ipc.invoke('openFileDialog'); return null; }
  };
})();

/* ══════════════════════════════ app state ══════════════════════════════ */

const S = {
  shell: Backend.shell,
  state: null,          // last state payload from the backend
  sources: [], cards: [], journal: [], skills: {}, settings: {},
  watching: false,
  frames: 0,
  busy: false,
  timer: null,
  lastFrame: null,      // {dataUrl, signature, at}
  lastCard: null,
  cardCount: 0,
  demoMode: false,
  coach: null,
  doneModules: [],
  captureStream: null,  // browser getDisplayMedia
  cameraStream: null,   // phone/webcam capture (point it at your monitor)
  cameraVideo: null,
  captureVideo: null
};

/* Where a phone (PWA or APK) finds its companion server. Deliberately NOT part
 * of the shared settings object: it is per-device, and the token must never be
 * uploaded to the server it authenticates against. Kept in localStorage only. */
const Conn = {
  url: '',
  token: '',
  load() {
    try {
      const j = JSON.parse(localStorage.getItem('companionConn') || 'null');
      if (j) { this.url = String(j.url || ''); this.token = String(j.token || ''); }
    } catch (e) {}
    return this;
  },
  save() {
    try { localStorage.setItem('companionConn', JSON.stringify({ url: this.url, token: this.token })); } catch (e) {}
  }
};

const DEFAULT_SETTINGS = {
  intervalMs: 8000,
  sensitivity: 'normal',
  capture: 'screen',
  quality: 0.72,
  maxW: 1100,
  pauseHidden: true,
  riskPercent: 1,
  account: 0,
  dailyCap: 2,
  demoMode: false,
  onTop: true,
  dock: 'right',
  opacity: 100,
  width: 400,
  excludeSelf: true,
  language: 'English',
  serverUrl: '',
  serverToken: ''
};

/* ══════════════════════════════ screen capture ══════════════════════════════ */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the captured image.'));
    img.src = src;
  });
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function b64FromBytes(u8) {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + step));
  }
  return btoa(s);
}

const SIG_COLS = 64, SIG_ROWS = 40;

/**
 * Build the compact colour signature the offline reader uses.
 * Every pixel of the (moderately downscaled) frame is classified as green ink,
 * red ink or bright ink and counted into a 64x40 grid — far more accurate than
 * averaging colours, because thin candle wicks survive the count.
 */
function signatureFromCanvas(canvas) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, w, h).data;

  const g = new Uint8Array(SIG_COLS * SIG_ROWS);
  const r = new Uint8Array(SIG_COLS * SIG_ROWS);
  const b = new Uint8Array(SIG_COLS * SIG_ROWS);

  const cellW = w / SIG_COLS, cellH = h / SIG_ROWS;
  const cellArea = Math.max(1, cellW * cellH);
  const norm = 255 / (cellArea * 0.3); // a cell 30% full of ink reads as maximum

  for (let y = 0; y < h; y++) {
    const cy = Math.min(SIG_ROWS - 1, Math.floor(y / cellH));
    const rowBase = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = rowBase + x * 4;
      const a = data[i + 3];
      if (a < 40) continue;
      const R = data[i], G = data[i + 1], B = data[i + 2];
      const idx = cy * SIG_COLS + Math.min(SIG_COLS - 1, Math.floor(x / cellW));
      if (G > R + 22 && G > B + 6) { g[idx]++; }
      else if (R > G + 22 && R > B + 6) { r[idx]++; }
      else if (R > 190 && G > 190 && B > 190) { b[idx]++; }
    }
  }

  for (let i = 0; i < g.length; i++) {
    g[i] = Math.min(255, Math.round(g[i] * norm));
    r[i] = Math.min(255, Math.round(r[i] * norm));
    b[i] = Math.min(255, Math.round(b[i] * norm));
  }

  return { cols: SIG_COLS, rows: SIG_ROWS, g: b64FromBytes(g), r: b64FromBytes(r), b: b64FromBytes(b) };
}

/**
 * Downscale a raw frame to the configured max width, JPEG it, and compute the
 * colour signature. `mask` is the rectangle where our own panel appears in the
 * capture (the desktop shell supplies it) — we paint it out so the coach never
 * reads its own advice back off the screen.
 */
async function processFrame(rawDataUrl, mask) {
  const maxW = Number(S.settings.maxW) || 1100;
  const q = Number(S.settings.quality) || 0.72;
  const img = await loadImage(rawDataUrl);
  const scale = img.width > maxW ? maxW / img.width : 1;
  const c = canvasOf(img.width * scale, img.height * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);

  let masked = false;
  if (mask && mask.w > 0 && mask.h > 0) {
    // Mask coordinates arrive in original frame pixels; the canvas is scaled.
    const kx = c.width / (mask.width || img.width);
    const ky = c.height / (mask.height || img.height);
    const mx = Math.max(0, Math.round(mask.x * kx));
    const my = Math.max(0, Math.round(mask.y * ky));
    const mw = Math.min(c.width - mx, Math.round(mask.w * kx));
    const mh = Math.min(c.height - my, Math.round(mask.h * ky));
    if (mw > 4 && mh > 4) {
      ctx.fillStyle = '#0b0f16';
      ctx.fillRect(mx, my, mw, mh);
      masked = true;
    }
  }

  const signature = signatureFromCanvas(c);
  const dataUrl = c.toDataURL('image/jpeg', q);
  return { dataUrl, signature, w: c.width, h: c.height, masked, scale: scale };
}

/* Browser-only capture via getDisplayMedia (Electron uses desktopCapturer in main). */
const BrowserCapture = {
  async ensure() {
    if (S.captureStream && S.captureStream.active) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error('This browser cannot share the screen. Use the desktop app, or Chrome/Edge.');
    }
    const want = S.settings.capture === 'window' ? { displaySurface: 'window' } : {};
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: Object.assign({ frameRate: 3 }, want),
      audio: false,
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude'
    });
    S.captureStream = stream;
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    await v.play();
    S.captureVideo = v;
    stream.getVideoTracks()[0].addEventListener('ended', () => { stopWatching('Screen share ended.'); });
    return true;
  },
  async frame() {
    await this.ensure();
    const v = S.captureVideo;
    if (!v || !v.videoWidth) throw new Error('Screen share is not producing frames yet.');
    const c = canvasOf(v.videoWidth, v.videoHeight);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return { ok: true, dataUrl: c.toDataURL('image/png') };
  },
  stop() {
    if (S.captureStream) { S.captureStream.getTracks().forEach((t) => t.stop()); }
    S.captureStream = null; S.captureVideo = null;
  }
};

/* Camera capture: point the phone (or a webcam) AT your monitor. This is what
 * makes the companion usable on Android, where an overlay over other apps is
 * impossible — the rear camera becomes the "screen share". Same signature,
 * same offline reader, same coach: nothing downstream changes. */
const CameraCapture = {
  async ensure() {
    if (S.cameraStream && S.cameraStream.active) return true;
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) {
      throw new Error('This device has no camera API the browser can use.');
    }
    const stream = await md.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    S.cameraStream = stream;
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    await v.play();
    S.cameraVideo = v;
    stream.getVideoTracks()[0].addEventListener('ended', () => { stopWatching('Camera was disconnected.'); });
    return true;
  },
  async frame() {
    await this.ensure();
    const v = S.cameraVideo;
    if (!v || !v.videoWidth) throw new Error('The camera is not producing frames yet.');
    const c = canvasOf(v.videoWidth, v.videoHeight);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return { ok: true, dataUrl: c.toDataURL('image/jpeg', 0.85), source: 'camera' };
  },
  stop() {
    if (S.cameraStream) { S.cameraStream.getTracks().forEach((t) => t.stop()); }
    S.cameraStream = null; S.cameraVideo = null;
  },
  available() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
};

function captureSource() {
  return (S.settings && S.settings.capture) || 'screen';
}

/* ══════════════════════════════ coach wiring ══════════════════════════════ */

function coachAI() {
  if (S.settings.demoMode) return null;
  if (!window.AI || !AI.online) return null;
  return {
    ask: (system, user) => AI.ask(system, user),
    vision: (system, user, images) => AI.vision(system, user, images)
  };
}

function makeCoach() {
  const C = (window.TCEngine && TCEngine.coach) ? TCEngine.coach.Coach : null;
  if (!C) return null;
  S.coach = new C({
    ai: coachAI(),
    skills: S.skills,
    settings: {
      sensitivity: S.settings.sensitivity,
      intervalMs: S.settings.intervalMs,
      riskPercent: S.settings.riskPercent,
      maxCitations: 3,
      language: S.settings.language
    }
  });
  return S.coach;
}

/** One analysis pass: capture → read → ground → card. */
async function analyseOnce(opts) {
  const o = opts || {};
  if (S.busy) return null;
  S.busy = true;
  setLight('#lightWatch', 'busy', 'Looking at your screen…');
  setStatus(o.question ? 'thinking about your question…' : 'looking at your screen…');

  try {
    if (!S.coach) makeCoach();
    else S.coach.setAI(coachAI());
    S.coach.configure({
      sensitivity: S.settings.sensitivity,
      riskPercent: S.settings.riskPercent,
      language: S.settings.language
    });
    S.coach.skills = S.skills;

    let frame = S.lastFrame;
    if (!o.reuseFrame || !frame) {
      const raw = await Backend.capture({ quality: S.settings.quality, maxW: S.settings.maxW });
      if (!raw || !raw.ok) throw new Error((raw && raw.error) || 'Screen capture failed.');
      frame = await processFrame(raw.dataUrl, raw.mask);
      frame.at = Date.now();
      S.lastFrame = frame;
      S.frames++;
      $('#watchFrames').textContent = S.frames + ' frames';
    }

    const VIS = TCEngine.vision;
    const read = VIS.localRead(frame.signature);
    const query = TCEngine.coach.kbQuery(read, o.question || '');
    const pack = await Backend.pack(query, o.question || '');

    const card = await S.coach.coach({
      signature: frame.signature,
      imageDataUrl: frame.dataUrl,
      question: o.question || '',
      pack: pack && pack.ok === false ? null : pack,
      force: !!o.force,
      localRead: read
    });

    S.skills = S.coach.skills;
    if (card) {
      renderCard(card, true);
      S.lastCard = card;
      updateBubble(card);
      setStatus('coach: ' + card.title);
      Backend.saveSkills(S.skills).catch(() => {});
    } else {
      setStatus('nothing meaningful changed — staying quiet (' + fmtClock() + ')');
    }
    setLight('#lightWatch', S.watching ? 'on' : 'off', S.watching ? 'Watching your screen' : 'Not watching');
    return card;
  } catch (e) {
    const msg = (e && e.message) || String(e);
    setLight('#lightWatch', 'err', msg);
    setStatus('capture error: ' + msg);
    if (/permission|denied|not allowed|Permission/i.test(msg)) {
      toast(captureSource() === 'camera'
        ? 'Camera access was blocked. Allow the camera for this site, then press Start again.'
        : 'Screen capture was blocked. Allow it and press Start again.', 'err');
      stopWatching('Permission denied.');
    } else if (!o.silent) {
      toast(msg, 'err');
    }
    if (S.watching && /BrowserCapture|share|capture/i.test(msg) === false) { /* keep going */ }
    else if (S.watching) stopWatching('Capture failed.');
    return null;
  } finally {
    S.busy = false;
  }
}

function startWatching() {
  if (S.watching) return;
  S.watching = true;
  $('#btnWatch').textContent = '⏸ Stop watching';
  $('#btnWatch').classList.remove('primary');
  $('#watchState').textContent = 'watching';
  $('#watchState').className = 'chip live';
  $('#btnAvatar').classList.add('pulse');
  setLight('#lightWatch', 'on', 'Watching your screen');

  const tick = () => {
    if (!S.watching) return;
    if (S.settings.pauseHidden && Backend.isElectron && window.__hidden) return;
    analyseOnce({ silent: true }).then(schedule);
  };
  const schedule = () => {
    clearTimeout(S.timer);
    if (!S.watching) return;
    S.timer = setTimeout(tick, Number(S.settings.intervalMs) || 8000);
  };
  tick();
  toast('Watching your screen every ' + Math.round((S.settings.intervalMs || 8000) / 1000) + 's.', 'ok');
}

function stopWatching(why) {
  S.watching = false;
  clearTimeout(S.timer);
  BrowserCapture.stop();
  CameraCapture.stop();
  $('#btnWatch').textContent = '▶ Start watching';
  $('#btnWatch').classList.add('primary');
  $('#watchState').textContent = 'not watching';
  $('#watchState').className = 'chip chip-off';
  $('#btnAvatar').classList.remove('pulse');
  setLight('#lightWatch', 'off', 'Not watching');
  setStatus(why ? 'stopped: ' + why : 'watching stopped');
}

/* ══════════════════════════════ card rendering ══════════════════════════════ */

function sect(icon, label, bodyHtml, cls) {
  if (!bodyHtml) return '';
  return '<div class="sect ' + (cls || '') + '">' +
    '<div class="sect-ico">' + icon + '</div>' +
    '<div class="sect-main"><div class="sect-label">' + esc(label) + '</div>' +
    '<div class="sect-text">' + bodyHtml + '</div></div></div>';
}

function linkifyWithCites(text, citations) {
  let out = esc(text);
  out = out.replace(/\[(\d{1,2})\]/g, function (m, n) {
    const c = (citations || []).find((x) => String(x.n) === n);
    if (!c) return m;
    return '<span class="cite-inline" data-cite="' + n + '" title="' + esc(c.title || '') + '">[' + n + ']</span>';
  });
  return out;
}

function renderCard(card, fresh) {
  const stream = $('#cardStream');
  const empty = $('#coachEmpty');
  if (empty) empty.classList.add('hidden');

  const el = document.createElement('article');
  el.className = 'card ' + (card.mode === 'offline' ? 'offline' : '') + (fresh ? ' fresh' : '');
  el.dataset.id = card.id;

  const badge = card.mode === 'offline'
    ? '<span class="badge off">offline</span>'
    : (card.mode === 'ai-text' ? '<span class="badge ai">ai · text</span>' : '<span class="badge ai">ai vision</span>');

  const see = (card.see && card.see.length)
    ? '<ul>' + card.see.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '';

  const cites = (card.citations && card.citations.length)
    ? '<div class="cites">' + card.citations.map((c) =>
      '<button class="cite" data-sid="' + esc(c.sid) + '" data-chunk="' + esc(c.chunkId) + '" title="' + esc(c.snippet || '') + '">' +
      '[' + c.n + '] ' + esc(c.title || 'source') + '</button>').join('') + '</div>'
    : '';

  el.innerHTML =
    '<div class="card-head">' +
      '<div class="card-title">' + esc(card.title) +
        '<div class="card-sub">' +
          '<span>' + fmtClock(card.ts) + '</span>' + badge +
          (card.symbol ? '<span>' + esc(card.symbol) + (card.timeframe ? ' · ' + esc(card.timeframe) : '') + '</span>' : '') +
          '<span>' + Math.round((card.confidence || 0) * 100) + '% confident</span>' +
          (card.lessonTag ? '<span>🎓 ' + esc(card.lessonTag) + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="card-body">' +
      (card.question ? sect('💬', 'you asked', esc(card.question), 'ask') : '') +
      sect('👀', 'what I see', see, 'see') +
      sect('📏', 'the rule', linkifyWithCites(card.rule, card.citations), 'rule') +
      sect('✅', 'what to do', esc(card.action), 'action') +
      sect('⚠️', 'risk', esc(card.risk), 'risk') +
      sect('🎓', 'learn this', linkifyWithCites(card.learn, card.citations), 'learn') +
      (card.askThem ? sect('❓', 'think about it', esc(card.askThem), 'ask') : '') +
      cites +
      (card.degraded ? '<div class="warning">Fell back to offline coaching: ' + esc(card.degraded.reason) + '</div>' : '') +
      '<div class="meter"><div style="width:' + Math.round((card.confidence || 0.4) * 100) + '%"></div></div>' +
    '</div>' +
    '<div class="card-actions">' +
      '<button class="btn small" data-act="explain">💬 Explain more</button>' +
      '<button class="btn small" data-act="journal">📓 Save to journal</button>' +
      '<button class="btn small" data-act="quiz">🎯 Quiz me</button>' +
      '<button class="btn small ghost" data-act="module">📖 Open lesson</button>' +
    '</div>';

  stream.prepend(el);
  S.cardCount++;
  while (stream.children.length > 30) stream.lastChild.remove();
  $$('.card.fresh', stream).forEach((c) => { if (c !== el) c.classList.remove('fresh'); });

  $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => cardAction(b.dataset.act, card)));
  $$('.cite', el).forEach((b) => b.addEventListener('click', () => openCitation(b.dataset.sid, b.dataset.chunk)));
  return el;
}

async function cardAction(act, card) {
  if (act === 'journal') {
    try {
      await Backend.addJournal({
        kind: 'coach',
        text: card.title + ' | see: ' + (card.see || []).slice(0, 2).join(' ') + ' | rule: ' + (card.rule || '') + ' | risk: ' + (card.risk || ''),
        tags: (card.tags || []).concat(card.lessonTag ? [card.lessonTag] : [])
      });
      toast('Saved to your journal.', 'ok');
      loadState();
    } catch (e) { toast(e.message, 'err'); }
    return;
  }
  if (act === 'quiz') { openQuiz(card.lessonTag || (card.tags || [])[0]); return; }
  if (act === 'module') {
    const id = card.moduleId || guessModuleForTag(card.lessonTag);
    if (id) openModule(id); else toast('No module linked to this card yet.', 'warn');
    return;
  }
  if (act === 'explain') {
    const q = 'Explain in more detail, step by step, for a complete beginner: "' + (card.rule || card.title) + '". ' +
      'Use the screen you just saw as the example, and end with one drill I can do in 5 minutes.';
    $('#askInput').value = q;
    await askCoach(q);
  }
}

function guessModuleForTag(tag) {
  if (!tag || !window.TCEngine) return null;
  const m = TCEngine.curriculum.LIBRARY.find((x) => x.tags.indexOf(tag) >= 0);
  return m ? m.id : null;
}

async function askCoach(question) {
  const q = String(question || '').trim();
  if (!q) return;
  $('#askInput').value = '';
  setStatus('asking…');
  const card = await analyseOnce({ question: q, force: true, reuseFrame: !!(S.lastFrame && Date.now() - (S.lastFrame.at || 0) < 20000) });
  if (card) card.question = q;
  return card;
}

function updateBubble(card) {
  const t = $('#bubbleText');
  const d = $('#bubbleDot');
  if (!t) return;
  const label = (card.title || '').replace(/^[^\w]*/, '').slice(0, 26);
  t.textContent = label || '🦊';
  if (d) d.className = 'bubble-dot' + ((card.risk || '').length ? ' live' : '');
}

/* ══════════════════════════════ citation drill-down ══════════════════════════════ */

async function openCitation(sid, chunkId) {
  try {
    const r = await Backend.sourceText(sid);
    if (!r || !r.ok) throw new Error((r && r.error) || 'Source not available.');
    const src = r.source || {};
    let body = '';
    if (chunkId) {
      const res = await Backend.search(r.chunkText || '', 3).catch(() => null);
      body += '<h4>The exact passage I quoted</h4><p>' + esc(r.chunkText || '') + '</p>';
      if (res && res.ok === undefined && res.hits) { /* not used */ }
    }
    body += '<h4>Full text (' + fmtNum(src.words || 0) + ' words)</h4>' +
      '<p style="max-height:40vh;overflow:auto;white-space:pre-wrap;font-size:11.5px">' + esc((src.text || '').slice(0, 60000)) + '</p>' +
      (src.url ? '<p><a href="' + esc(src.url) + '" target="_blank" rel="noopener">Open the original ↗</a></p>' : '');
    openModal(src.title || 'Source', body, [{ label: 'Close', cls: 'btn' }]);
  } catch (e) { toast(e.message, 'err'); }
}

/* ══════════════════════════════ modal ══════════════════════════════ */

function openModal(title, bodyHtml, buttons) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  const foot = $('#modalFoot');
  foot.innerHTML = '';
  (buttons || [{ label: 'Close', cls: 'btn' }]).forEach((b) => {
    const el = document.createElement('button');
    el.className = b.cls || 'btn';
    el.textContent = b.label;
    el.addEventListener('click', () => { if (b.onClick) b.onClick(); else closeModal(); });
    foot.appendChild(el);
  });
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }

/* ══════════════════════════════ module + quiz ══════════════════════════════ */

function openModule(id) {
  const m = TCEngine.curriculum.byId(id);
  if (!m) return;
  const body =
    '<p style="color:var(--txt)">' + esc(m.summary) + '</p>' +
    '<h4>Rules</h4><ol>' + m.rules.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ol>' +
    '<div class="grid2">' +
      '<div class="kv entry"><b>Entry</b><span>' + esc(m.entry) + '</span></div>' +
      '<div class="kv invalid"><b>Invalidation</b><span>' + esc(m.invalidation) + '</span></div>' +
      '<div class="kv target"><b>Target</b><span>' + esc(m.target) + '</span></div>' +
      '<div class="kv risk"><b>Risk</b><span>' + esc(m.risk) + '</span></div>' +
    '</div>' +
    '<h4>Practice drill</h4><p>' + esc(m.drill) + '</p>' +
    '<h4>Watch for on your screen</h4><ul>' + m.screenHooks.map((h) => '<li>' + esc(h) + '</li>').join('') + '</ul>' +
    '<h4>How beginners mess this up</h4><ul>' + m.mistakes.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
    '<div class="taglist">' + m.tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>';

  openModal(m.emoji + ' ' + m.name + '  ·  ' + m.minutes + ' min', body, [
    { label: '🎯 Quiz me on this', cls: 'btn primary', onClick: () => { closeModal(); openQuiz(m.tags[0], m.id); } },
    { label: '📓 I studied this', cls: 'btn', onClick: () => { markDone(m); closeModal(); } },
    { label: 'Close', cls: 'btn ghost' }
  ]);
}

async function markDone(m) {
  if (S.doneModules.indexOf(m.id) < 0) S.doneModules.push(m.id);
  S.skills.__done = S.doneModules;
  m.tags.forEach((t) => {
    S.skills[t] = S.skills[t] || { exposure: 0, correct: 0, wrong: 0, taught: 0, lastTaught: 0, lastWrong: 0 };
    S.skills[t].exposure += 2;
    S.skills[t].taught += 1;
    S.skills[t].lastTaught = Date.now();
  });
  try {
    await Backend.saveSkills(S.skills);
    await Backend.addJournal({ kind: 'win', text: 'Studied module: ' + m.name, tags: m.tags });
  } catch {}
  toast('Nice — "' + m.name + '" marked as studied.', 'ok');
  renderLearn();
}

function openQuiz(tag, moduleId) {
  const q = moduleId
    ? (function () {
        const m = TCEngine.curriculum.byId(moduleId);
        const raw = m && m.quiz && m.quiz.length ? m.quiz[Math.floor(Math.random() * m.quiz.length)] : null;
        return raw ? Object.assign({}, raw, { moduleId: m.id, moduleName: m.name, tag: m.tags[0], emoji: m.emoji }) : null;
      })()
    : TCEngine.curriculum.quizQuestion(tag ? [tag] : null);

  if (!q) { toast('No questions available for that topic yet.', 'warn'); return; }

  const body = '<div class="quiz-q">' + esc(q.q) + '</div>' +
    q.options.map((o, i) => '<button class="quiz-opt" data-i="' + i + '">' + esc(o) + '</button>').join('') +
    '<div id="quizWhy"></div>' +
    '<p class="hint" style="margin-top:10px">From: ' + esc(q.emoji || '') + ' ' + esc(q.moduleName || 'your curriculum') + ' · topic: ' + esc(q.tag || '') + '</p>';

  openModal('🎯 Quick check', body, [{ label: 'Close', cls: 'btn ghost' }]);

  $$('#modalBody .quiz-opt').forEach((b) => {
    b.addEventListener('click', async () => {
      const i = Number(b.dataset.i);
      const correct = i === q.answer;
      $$('#modalBody .quiz-opt').forEach((x, xi) => {
        x.disabled = true;
        if (xi === q.answer) x.classList.add('correct');
        else if (xi === i) x.classList.add('wrong');
      });
      $('#quizWhy').innerHTML = '<div class="quiz-why">' + (correct ? '✅ Correct. ' : '❌ Not quite. ') + esc(q.why) + '</div>';
      if (!S.coach) makeCoach();
      S.coach.skills = S.skills;
      S.coach.answer(q, i);
      S.skills = S.coach.skills;
      await Backend.saveSkills(S.skills).catch(() => {});
      renderLearn();
    });
  });
}

/* ══════════════════════════════ view: feed ══════════════════════════════ */

async function learnUrls() {
  const raw = $('#inUrls').value.trim();
  if (!raw) { toast('Paste at least one link.', 'warn'); return; }
  const urls = raw.split(/[\n,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 12);
  if (!urls.length) { toast('Those do not look like links (they must start with http).', 'warn'); return; }

  $('#btnLearnUrls').disabled = true;
  setLight('#lightKb', 'busy', 'Learning…');
  for (const url of urls) {
    logLine('fetching ' + url, 'busy');
    setStatus('learning ' + url.slice(0, 60));
    try {
      const r = await Backend.ingestUrl(url, $('#selLang').value);
      if (r && r.ok) {
        logLine('✓ learned "' + (r.source.title || url) + '" — ' + fmtNum(r.source.words) + ' words, ' + r.chunks + ' searchable pieces' +
          (r.ingested && r.ingested.transcript === false ? ' (title/chapters/description only)' : ''), 'ok');
        if (r.ingested && r.ingested.note) logLine('  note: ' + r.ingested.note, 'busy');
      } else {
        logLine('✗ ' + url + ' — ' + ((r && r.error) || 'failed'), 'err');
      }
    } catch (e) {
      logLine('✗ ' + url + ' — ' + e.message, 'err');
    }
  }
  $('#btnLearnUrls').disabled = false;
  $('#inUrls').value = '';
  await loadState();
  toast('Feed updated. Press Distil on a source to turn it into a playbook card.', 'ok');
}

async function learnText() {
  const text = $('#inText').value;
  const title = $('#inTextTitle').value.trim();
  if (!text || text.trim().length < 40) { toast('Paste a bit more text first (40+ characters).', 'warn'); return; }
  $('#btnLearnText').disabled = true;
  setStatus('learning your pasted text…');
  try {
    const r = await Backend.ingestText(text, title);
    if (r && r.ok) {
      logLine('✓ learned "' + r.source.title + '" — ' + fmtNum(r.source.words) + ' words, ' + r.chunks + ' pieces', 'ok');
      $('#inText').value = ''; $('#inTextTitle').value = '';
      toast('Learned it.', 'ok');
    } else throw new Error((r && r.error) || 'Could not learn that text.');
  } catch (e) { logLine('✗ ' + e.message, 'err'); toast(e.message, 'err'); }
  $('#btnLearnText').disabled = false;
  await loadState();
}

async function learnFile(file) {
  if (!file) return;
  setStatus('reading ' + file.name + '…');
  logLine('reading ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB)', 'busy');
  try {
    const isPdf = /\.pdf$/i.test(file.name);
    const payload = isPdf
      ? { name: file.name, base64: await fileToBase64(file) }
      : { name: file.name, text: await file.text() };
    const r = await Backend.ingestFile(payload);
    if (r && r.ok) {
      logLine('✓ learned "' + r.source.title + '" — ' + fmtNum(r.source.words) + ' words', 'ok');
      toast('Learned ' + file.name, 'ok');
    } else throw new Error((r && r.error) || 'Could not read that file.');
  } catch (e) { logLine('✗ ' + e.message, 'err'); toast(e.message, 'err'); }
  await loadState();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(new Error('Could not read that file.'));
    fr.readAsDataURL(file);
  });
}

const KIND_ICON = { video: '🎬', article: '📰', text: '📝', file: '📄', pdf: '📕', social: '💬' };

function renderSources() {
  const box = $('#sourceList');
  if (!box) return;
  if (!S.sources.length) {
    box.innerHTML = '<p class="hint">Nothing learned yet. Paste a YouTube link above — I will pull the captions, ' +
      'chapters and description, chop them into searchable pieces and index them.</p>';
    return;
  }
  box.innerHTML = S.sources.map((s) => {
    const icon = KIND_ICON[s.kind] || '📄';
    const tags = (s.tags || []).slice(0, 5).map((t) => '<span class="tag">' + esc(t) + '</span>').join('');
    return '<div class="item" data-id="' + esc(s.id) + '">' +
      '<div class="item-ico">' + icon + '</div>' +
      '<div class="item-main">' +
        '<div class="item-title">' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>' : esc(s.title)) + '</div>' +
        '<div class="item-meta">' +
          '<span>' + fmtNum(s.words) + ' words</span><span>' + (s.chunks || 0) + ' pieces</span>' +
          '<span>~' + (s.minutes || 1) + ' min</span>' +
          (s.author ? '<span>' + esc(s.author) + '</span>' : '') +
          '<span>' + fmtAgo(s.addedAt) + '</span>' +
          (s.distilled ? '<span style="color:var(--up)">✓ distilled</span>' : '') +
        '</div>' +
        (tags ? '<div class="taglist">' + tags + '</div>' : '') +
        (s.note ? '<div class="item-note">⚠ ' + esc(s.note) + '</div>' : '') +
        '<div class="item-actions">' +
          '<button class="btn small primary" data-act="distill">✨ Distil into playbook</button>' +
          '<button class="btn small" data-act="view">👁 View text</button>' +
          '<button class="btn small" data-act="quizsrc">🎯 Quiz me on it</button>' +
          '<button class="btn small" data-act="publish">📤 Publish as lesson</button>' +
          '<button class="btn small danger" data-act="del">🗑</button>' +
        '</div>' +
      '</div></div>';
  }).join('');

  $$('.item', box).forEach((el) => {
    const s = S.sources.find((x) => x.id === el.dataset.id);
    $$('[data-act]', el).forEach((b) => b.addEventListener('click', () => sourceAction(b.dataset.act, s)));
  });
}

async function sourceAction(act, s) {
  if (!s) return;
  if (act === 'del') {
    if (!confirm('Forget "' + s.title + '" and everything I learned from it?')) return;
    try { await Backend.removeSource(s.id); toast('Removed.', 'ok'); await loadState(); }
    catch (e) { toast(e.message, 'err'); }
    return;
  }
  if (act === 'view') { openCitation(s.id, null); return; }
  if (act === 'quizsrc') { await quizFromSource(s); return; }
  if (act === 'publish') { await publishSource(s); return; }
  if (act === 'distill') { await distillSource(s); }
}

/* ══════════════════════════════ distillation ══════════════════════════════ */

function requireBrain(needVision) {
  if (S.settings.demoMode) {
    toast('Offline demo mode is on — turn it off in Settings to use the AI brain.', 'warn');
    return false;
  }
  if (!window.AI || !AI.online) {
    toast('No AI brain connected yet. Open Settings → Brain, pick a provider (Gemini has a free key) and press Test & save.', 'warn');
    switchView('settings');
    return false;
  }
  if (needVision && !AI.canVision()) {
    toast('That provider cannot look at images. Pick Gemini, OpenAI, Anthropic, OpenRouter, Groq, or Ollama with a vision model.', 'warn');
    return false;
  }
  return true;
}

async function distillSource(s) {
  if (!requireBrain(false)) return;
  setStatus('distilling "' + s.title + '"…');
  toast('Reading and distilling — this can take 20-60s for a long video.', 'warn');
  setLight('#lightKb', 'busy', 'Distilling…');
  try {
    const r = await Backend.sourceText(s.id);
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not load that source.');
    const source = r.source;
    const prompt = TCEngine.distill.buildDistillPrompt(source, { chars: 12000 });
    const res = await AI.json(TCEngine.distill.DISTILL_SYSTEM, prompt, TCEngine.distill.parseDistill);
    if (!res.ok) throw new Error(res.error || 'Distillation failed.');
    const d = res.data;

    const saved = await Backend.saveDistill({ sourceId: s.id, result: d });
    if (!saved || saved.ok === false) throw new Error((saved && saved.error) || 'Could not save the distilled cards.');

    logLine('✨ distilled "' + s.title + '" → ' + d.cards.length + ' playbook card(s), ' + (d.terms || []).length + ' terms', 'ok');
    toast('Distilled into ' + d.cards.length + ' playbook card(s).', 'ok');
    await loadState();
    switchView('library');

    openModal('✨ Distilled: ' + s.title,
      '<h4>Summary</h4><p>' + esc(d.summary || '—') + '</p>' +
      '<h4>Key takeaways</h4><ul>' + (d.takeaways || []).map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>' +
      '<h4>Playbook cards</h4>' +
      (d.cards.length ? d.cards.map((c) => '<div class="kv"><b>' + esc(c.title) + '</b><span>' + esc(c.setup) + '</span></div>').join('') : '<p>Nothing tradeable in this one — it is still searchable in your library.</p>') +
      ((d.warnings || []).length ? '<div class="warning">⚠ ' + d.warnings.map(esc).join('<br>') + '</div>' : ''),
      [{ label: '📤 Publish cards as lessons', cls: 'btn primary', onClick: () => { closeModal(); publishSource(s); } },
       { label: 'Close', cls: 'btn ghost' }]);
  } catch (e) {
    logLine('✗ distil failed: ' + e.message, 'err');
    toast(e.message, 'err');
  }
  setLight('#lightKb', S.sources.length ? 'on' : 'off', S.sources.length + ' sources');
  setStatus('ready');
}

async function quizFromSource(s) {
  if (!requireBrain(false)) return;
  setStatus('writing questions from "' + s.title + '"…');
  try {
    const r = await Backend.sourceText(s.id);
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not load that source.');
    const prompt = TCEngine.distill.buildQuizPrompt(r.source, 3);
    const res = await AI.json(TCEngine.distill.QUIZ_SYSTEM, prompt, TCEngine.distill.parseQuiz);
    if (!res.ok) throw new Error(res.error || 'Could not build questions.');
    runQuizSession(res.data.questions, s.title, (s.tags || [])[0]);
  } catch (e) { toast(e.message, 'err'); }
}

async function publishSource(s) {
  try {
    const cards = S.cards.filter((c) => c.sid === s.id);
    if (!cards.length) { toast('Distil this source first — publishing needs at least one playbook card.', 'warn'); return; }
    const lessons = cards.map((c) => TCEngine.distill.cardToLesson(c, s, c.id.slice(-8)));
    const r = await Backend.publishLessons(lessons);
    if (!r || r.ok === false) throw new Error((r && r.error) || 'Publish failed.');
    toast('Published ' + lessons.length + ' lesson(s) to Professor Fox. Reload the main app to see them.', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

/* quiz session over a list of questions */
function runQuizSession(questions, title, tag) {
  let idx = 0, right = 0;
  const show = () => {
    if (idx >= questions.length) {
      const pct = Math.round((right / questions.length) * 100);
      openModal('🎉 Quiz finished — ' + title,
        '<p style="font-size:22px;font-family:var(--mono);color:' + (pct >= 70 ? 'var(--up)' : 'var(--warn)') + '">' + right + '/' + questions.length + ' (' + pct + '%)</p>' +
        '<p>' + (pct >= 90 ? 'Excellent — you can explain this back to someone else now.' :
          pct >= 70 ? 'Solid. Re-read the cards you missed and try again tomorrow.' :
          'Worth another pass. Open the source in Library and read the quoted passages again.') + '</p>',
        [{ label: 'Close', cls: 'btn primary' }]);
      return;
    }
    const q = questions[idx];
    openModal('🎯 Question ' + (idx + 1) + '/' + questions.length + ' — ' + title,
      '<div class="quiz-q">' + esc(q.q) + '</div>' +
      q.options.map((o, i) => '<button class="quiz-opt" data-i="' + i + '">' + esc(o) + '</button>').join('') +
      '<div id="quizWhy"></div>',
      [{ label: 'Skip', cls: 'btn ghost', onClick: () => { idx++; show(); } }]);

    $$('#modalBody .quiz-opt').forEach((b) => {
      b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        const ok = i === q.answer;
        if (ok) right++;
        $$('#modalBody .quiz-opt').forEach((x, xi) => {
          x.disabled = true;
          if (xi === q.answer) x.classList.add('correct');
          else if (xi === i) x.classList.add('wrong');
        });
        $('#quizWhy').innerHTML = '<div class="quiz-why">' + (ok ? '✅ ' : '❌ ') + esc(q.why || '') + '</div>';
        if (tag && S.coach) {
          S.coach.skills = S.skills;
          S.coach.answer({ tag: tag, answer: q.answer }, i);
          S.skills = S.coach.skills;
          Backend.saveSkills(S.skills).catch(() => {});
        }
        setTimeout(() => { idx++; show(); }, 2200);
      });
    });
  };
  show();
}

/* ══════════════════════════════ view: library ══════════════════════════════ */

async function doSearch() {
  const q = $('#inSearch').value.trim();
  const box = $('#searchResults');
  if (!q) { box.innerHTML = ''; return; }
  box.innerHTML = '<p class="hint">searching…</p>';
  try {
    const r = await Backend.search(q, 8);
    const hits = (r && (r.hits || r.results)) || [];
    if (!hits.length) {
      box.innerHTML = '<p class="hint">Nothing in your library matches that yet. Feed me a link or paste some text about it.</p>';
      return;
    }
    box.innerHTML = hits.map((h) =>
      '<div class="result">' +
        '<div class="result-top"><span>' + esc((h.source && h.source.title) || 'source') +
          (h.heading ? ' › ' + esc(h.heading) : '') + '</span>' +
          '<span class="score">' + (h.score != null ? h.score.toFixed(3) : '') + '</span></div>' +
        '<div class="result-snippet">' + esc(h.snippet || h.text || '').replace(/⟦/g, '<b>').replace(/⟧/g, '</b>') + '</div>' +
        '<div class="item-actions">' +
          (h.source && h.source.url ? '<a class="btn small ghost" href="' + esc(h.source.url) + '" target="_blank" rel="noopener">Open source ↗</a>' : '') +
          '<button class="btn small" data-sid="' + esc(h.sid) + '" data-cid="' + esc(h.id) + '">👁 Full passage</button>' +
        '</div>' +
      '</div>').join('');
    $$('.result [data-sid]', box).forEach((b) => b.addEventListener('click', () => openCitation(b.dataset.sid, b.dataset.cid)));
  } catch (e) { box.innerHTML = '<p class="hint" style="color:var(--down)">' + esc(e.message) + '</p>'; }
}

function renderCards() {
  const box = $('#cardList');
  $('#cardCount').textContent = S.cards.length ? S.cards.length + ' cards' : '';
  if (!S.cards.length) {
    box.innerHTML = '<p class="hint">No playbook cards yet. Go to <b>Feed</b>, learn a video or article, then press ' +
      '<b>✨ Distil into playbook</b>. Each card becomes setup / entry / invalidation / target / risk / checklist — ' +
      'and the live coach will prefer your own cards over generic advice.</p>';
    return;
  }
  box.innerHTML = S.cards.map((c) =>
    '<div class="pcard" data-id="' + esc(c.id) + '">' +
      '<div class="pcard-head">' +
        '<span class="item-ico">🎯</span>' +
        '<span class="pcard-title">' + esc(c.title) + '</span>' +
        '<span class="pcard-caret">▶</span>' +
      '</div>' +
      '<div class="pcard-body">' +
        '<div class="taglist">' + (c.tags || []).map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' +
        '<div class="kv"><b>Setup</b><span>' + esc(c.setup) + '</span></div>' +
        '<div class="kv entry"><b>Entry</b><span>' + esc(c.entry) + '</span></div>' +
        '<div class="kv invalid"><b>Invalidation</b><span>' + esc(c.invalidation) + '</span></div>' +
        '<div class="kv target"><b>Target</b><span>' + esc(c.target) + '</span></div>' +
        '<div class="kv risk"><b>Risk</b><span>' + esc(c.risk) + '</span></div>' +
        ((c.checklist || []).length ? '<div class="kv"><b>Pre-trade checklist</b><ol class="checklist">' +
          c.checklist.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ol></div>' : '') +
        ((c.mistakes || []).length ? '<div class="kv"><b>Common mistakes</b><ul class="checklist">' +
          c.mistakes.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>' : '') +
        (c.quote ? '<div class="quote">“' + esc(c.quote) + '”</div>' : '') +
        '<div class="item-actions">' +
          '<button class="btn small" data-act="quiz">🎯 Quiz me</button>' +
          '<button class="btn small" data-act="publish">📤 Publish as lesson</button>' +
          (c.sourceUrl ? '<a class="btn small ghost" href="' + esc(c.sourceUrl) + '" target="_blank" rel="noopener">Source ↗</a>' : '') +
          '<button class="btn small danger" data-act="del">🗑</button>' +
        '</div>' +
      '</div>' +
    '</div>').join('');

  $$('.pcard', box).forEach((el) => {
    const c = S.cards.find((x) => x.id === el.dataset.id);
    $('.pcard-head', el).addEventListener('click', () => el.classList.toggle('open'));
    $$('[data-act]', el).forEach((b) => b.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (b.dataset.act === 'del') {
        if (!confirm('Delete the card "' + c.title + '"?')) return;
        try { await Backend.removeCard(c.id); await loadState(); } catch (e) { toast(e.message, 'err'); }
      } else if (b.dataset.act === 'quiz') {
        if (!c.questions || !c.questions.length) { toast('No questions on this card yet — use "Quiz me on it" in Feed.', 'warn'); return; }
        runQuizSession(c.questions, c.title, (c.tags || [])[0]);
      } else if (b.dataset.act === 'publish') {
        try {
          const lesson = TCEngine.distill.cardToLesson(c, { title: c.sourceTitle, url: c.sourceUrl }, c.id.slice(-8));
          const r = await Backend.publishLessons([lesson]);
          if (!r || r.ok === false) throw new Error((r && r.error) || 'Publish failed.');
          toast('Published to Professor Fox.', 'ok');
        } catch (e) { toast(e.message, 'err'); }
      }
    }));
  });
}

function renderTerms() {
  const box = $('#termList');
  const terms = [];
  for (const s of S.sources) for (const t of (s.terms || [])) terms.push(t);
  const seen = new Set();
  const uniq = terms.filter((t) => { const k = t.term.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  if (!uniq.length) { box.innerHTML = '<p class="hint">Terms appear here after you distil a source.</p>'; return; }
  box.innerHTML = uniq.slice(0, 60).map((t) =>
    '<div class="term"><b>' + esc(t.term) + '</b><span>' + esc(t.meaning) + '</span></div>').join('');
}

/* ══════════════════════════════ view: learn ══════════════════════════════ */

function renderLearn() {
  renderPlan();
  renderSkills();
  renderModules();
}

function renderPlan() {
  const box = $('#planList');
  if (!S.coach) makeCoach();
  S.coach.skills = S.skills;
  const kbTags = ((S.state && S.state.stats && S.state.stats.tags) || []).map((t) => t.tag);
  const plan = S.coach.plan(5, kbTags, S.doneModules);
  $('#planHint').textContent = plan.length
    ? 'Ranked by your weakest topics and by what your own library does not cover yet.'
    : 'Curriculum unavailable.';
  box.innerHTML = plan.map((p, i) =>
    '<div class="item" data-id="' + esc(p.id) + '">' +
      '<div class="item-ico">' + (i === 0 ? '👉' : p.emoji) + '</div>' +
      '<div class="item-main">' +
        '<div class="item-title">' + esc(p.name) + '</div>' +
        '<div class="item-meta"><span>L' + p.level + ' · ' + p.minutes + ' min</span><span>' + esc(p.reason) + '</span></div>' +
        '<div class="item-actions"><button class="btn small primary" data-act="open">📖 Learn this</button>' +
        '<button class="btn small" data-act="quiz">🎯 Quiz</button></div>' +
      '</div></div>').join('');
  $$('#planList .item').forEach((el) => {
    const p = plan.find((x) => x.id === el.dataset.id);
    $('[data-act="open"]', el).addEventListener('click', () => openModule(p.id));
    $('[data-act="quiz"]', el).addEventListener('click', () => openQuiz(null, p.id));
  });
}

function renderSkills() {
  const box = $('#skillBars');
  const CUR = TCEngine.curriculum;
  box.innerHTML = CUR.SKILL_TAGS.map((tag) => {
    const s = S.skills[tag] || {};
    const pct = CUR.mastery(s);
    const answered = (s.correct || 0) + (s.wrong || 0);
    return '<div class="skill">' +
      '<span class="skill-name">' + esc(tag) + '</span>' +
      '<span class="skill-pct">' + pct + '%' + (answered ? ' · ' + (s.correct || 0) + '✓/' + (s.wrong || 0) + '✗' : '') + '</span>' +
      '<span class="skill-bar"><span style="display:block;width:' + pct + '%;height:100%"></span></span>' +
      '</div>';
  }).join('');
}

function renderModules() {
  const box = $('#moduleList');
  const CUR = TCEngine.curriculum;
  const byLevel = {};
  CUR.LIBRARY.forEach((m) => { (byLevel[m.level] = byLevel[m.level] || []).push(m); });
  let html = '';
  [1, 2, 3, 4].forEach((lv) => {
    html += '<h4 style="margin:10px 0 5px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--txt3)">' +
      esc(CUR.LEVEL_NAMES[lv]) + '</h4>';
    html += (byLevel[lv] || []).map((m) =>
      '<div class="mod' + (S.doneModules.indexOf(m.id) >= 0 ? ' done' : '') + '" data-id="' + m.id + '">' +
        '<span class="mod-ico">' + m.emoji + '</span>' +
        '<span class="mod-name">' + esc(m.name) + '</span>' +
        '<span class="mod-lvl">' + m.minutes + 'm</span>' +
      '</div>').join('');
  });
  box.innerHTML = html;
  $$('#moduleList .mod').forEach((el) => el.addEventListener('click', () => openModule(el.dataset.id)));
}

/* ══════════════════════════════ view: journal ══════════════════════════════ */

function renderJournal() {
  const box = $('#journalList');
  if (!S.journal.length) {
    box.innerHTML = '<p class="hint">Empty. The journal is how the coach stops repeating itself and how you find your ' +
      'three most expensive habits. Save a coaching card, or write one line after every trade.</p>';
  } else {
    box.innerHTML = S.journal.slice(0, 80).map((j) =>
      '<div class="jentry" data-id="' + esc(j.id) + '">' +
        '<div class="jentry-top"><span class="kind-' + esc(j.kind) + '">' + esc(j.kind) + '</span>' +
          '<span>' + fmtClock(j.ts) + ' · ' + fmtAgo(j.ts) + '</span>' +
          (j.outcome ? '<span style="color:var(--txt2)">' + esc(j.outcome) + '</span>' : '') +
          '<span style="flex:1"></span><button class="btn small ghost" data-act="del">✕</button></div>' +
        '<div class="jentry-text">' + esc(j.text) + '</div>' +
        ((j.tags || []).length ? '<div class="taglist">' + j.tags.slice(0, 6).map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
      '</div>').join('');
    $$('#journalList [data-act="del"]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('.jentry').dataset.id;
      try { await Backend.removeJournal(id); await loadState(); } catch (e) { toast(e.message, 'err'); }
    }));
  }
  renderInsights();
}

function renderInsights() {
  const box = $('#journalInsights');
  const j = S.journal;
  const out = [];
  if (!j.length) {
    box.innerHTML = '<p class="hint">Insights appear after a few entries.</p>';
    return;
  }
  const breaks = j.filter((x) => x.kind === 'rule-break');
  const wins = j.filter((x) => x.kind === 'win');
  const days = new Set(j.map((x) => new Date(x.ts).toDateString()));
  const tagCount = new Map();
  j.forEach((x) => (x.tags || []).forEach((t) => tagCount.set(t, (tagCount.get(t) || 0) + 1)));
  const topTag = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1])[0];

  out.push({ cls: 'good', html: '<b>' + j.length + '</b> entries over <b>' + days.size + '</b> day(s). ' +
    (days.size >= 3 ? 'Consistency is the part most beginners never get to — keep going.' : 'Log something every session you trade.') });
  if (breaks.length) {
    out.push({ cls: 'bad', html: '<b>' + breaks.length + '</b> rule break(s) logged. That is your real edge leak — ' +
      'not your strategy. Latest: ' + esc(String(breaks[0].text).slice(0, 110)) });
  }
  if (wins.length) out.push({ cls: 'good', html: '<b>' + wins.length + '</b> good-process entries. Process wins are the ones to celebrate, not money wins.' });
  if (topTag) out.push({ cls: '', html: 'Most-logged topic: <b>' + esc(topTag[0]) + '</b> (' + topTag[1] + '×). ' });

  const weak = Object.keys(S.skills).filter((t) => t !== '__done')
    .map((t) => ({ t, w: TCEngine.curriculum.weaknessScore(S.skills[t]) }))
    .filter((x) => x.w > 0.45).sort((a, b) => b.w - a.w).slice(0, 2);
  if (weak.length) out.push({ cls: 'warn', html: 'Quiz accuracy says you are weakest on <b>' + weak.map((x) => esc(x.t)).join('</b> and <b>') + '</b>. The Learn tab is already prioritising them.' });

  box.innerHTML = out.map((o) => '<div class="insight ' + o.cls + '">' + o.html + '</div>').join('');
}

async function addJournal() {
  const text = $('#inJournal').value.trim();
  if (!text) { toast('Write something first.', 'warn'); return; }
  try {
    await Backend.addJournal({
      kind: $('#selJournalKind').value,
      text: text,
      outcome: $('#inJournalOutcome').value.trim() || null,
      tags: []
    });
    $('#inJournal').value = '';
    $('#inJournalOutcome').value = '';
    toast('Logged.', 'ok');
    await loadState();
  } catch (e) { toast(e.message, 'err'); }
}

async function weeklyReview() {
  if (!S.journal.length) { toast('Nothing to review yet.', 'warn'); return; }
  const lines = S.journal.slice(0, 40).map((j) => '[' + new Date(j.ts).toISOString().slice(0, 10) + '] ' + j.kind + ': ' + j.text + (j.outcome ? ' (' + j.outcome + ')' : '')).join('\n');
  const body = '<h4>Your week in data</h4><p style="white-space:pre-wrap;max-height:24vh;overflow:auto;font-size:11px;color:var(--txt3)">' + esc(lines) + '</p><div id="revOut"><p class="hint">…</p></div>';
  openModal('✨ Weekly review', body, [{ label: 'Close', cls: 'btn ghost' }]);

  if (!requireBrain(false)) { $('#revOut').innerHTML = '<p class="hint">Connect a brain in Settings for an AI review. Offline, use the pattern insights above.</p>'; return; }
  const sys = 'You are a trading psychology and process coach reviewing a beginner\'s journal. Be specific, kind and blunt about repeated mistakes. ' +
    'Return ONLY JSON: {"summary":"2-3 sentences","patterns":["3-5 specific repeated behaviours with evidence"],"fixes":["3 concrete actions for next week"],"praise":"one genuine thing they did well"}';
  const res = await AI.json(sys, 'Review this trading journal:\n\n' + lines, function (raw) {
    const j = TCEngine.distill.extractJson(raw);
    if (!j || typeof j !== 'object') return { ok: false };
    return { ok: true, summary: String(j.summary || ''), patterns: (j.patterns || []).slice(0, 6), fixes: (j.fixes || []).slice(0, 5), praise: String(j.praise || '') };
  });
  if (!res.ok) { $('#revOut').innerHTML = '<p class="hint" style="color:var(--down)">' + esc(res.error || 'Review failed.') + '</p>'; return; }
  const d = res.data;
  $('#revOut').innerHTML = '<p>' + esc(d.summary) + '</p>' +
    '<h4>Patterns</h4><ul>' + d.patterns.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>' +
    '<h4>Next week</h4><ol>' + d.fixes.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ol>' +
    (d.praise ? '<div class="insight good">' + esc(d.praise) + '</div>' : '');
}

/* ══════════════════════════════ settings ══════════════════════════════ */

function renderBrainSettings() {
  const sel = $('#setProvider');
  sel.innerHTML = Object.keys(AI.PROVIDERS).map((k) =>
    '<option value="' + k + '"' + (AI.cfg.provider === k ? ' selected' : '') + '>' + esc(AI.PROVIDERS[k].name) + '</option>').join('');
  syncProviderFields();
}

function syncProviderFields() {
  const p = AI.getProvider();
  $('#wrapKey').style.display = p.needsKey ? '' : 'none';
  $('#wrapBase').style.display = p.editableBase ? '' : 'none';
  $('#setKey').value = (AI.cfg.keys[p.id] || '');
  $('#setBase').value = (AI.cfg.bases[p.id] || '') || p.defaultBase || '';
  $('#setBase').placeholder = p.defaultBase || '';
  const models = (AI.discovered && AI.discovered.length) ? AI.discovered : (p.catalog || []);
  const cur = AI.cfg.models[p.id] || AI.model || '';
  $('#setModel').innerHTML = (models.length ? models : [cur]).filter(Boolean)
    .map((m) => '<option value="' + esc(m) + '"' + (m === cur ? ' selected' : '') + '>' + esc(m) + '</option>').join('') ||
    '<option value="">(none discovered)</option>';
  $('#setModelOther').value = '';
  const vcur = (AI.cfg.vmodels || {})[p.id] || AI.visionModel() || '';
  const vpool = models.length ? models : (p.catalog || []);
  $('#setVisionModel').innerHTML = [''].concat(vpool).filter((m, i) => i === 0 || m)
    .map((m) => '<option value="' + esc(m) + '"' + (m === vcur ? ' selected' : '') + '>' + (m ? esc(m) : '(auto-pick a vision model)') + '</option>').join('');
  $('#visionHint').textContent = AI.canVision()
    ? 'This provider can look at screenshots. Vision model: ' + (AI.visionModel() || 'auto') + '.'
    : '⚠ This provider cannot look at images — screen watching will stay in offline mode.';
}

async function testBrain() {
  const btn = $('#btnBrainTest');
  const msg = $('#brainMsg');
  btn.disabled = true; msg.className = 'msg busy'; msg.textContent = 'Waking the brain up…';
  const p = AI.getProvider();
  AI.cfg.provider = p.id;
  AI.cfg.keys[p.id] = $('#setKey').value.trim();
  if (p.editableBase) AI.cfg.bases[p.id] = $('#setBase').value.trim();
  const chosen = $('#setModelOther').value.trim() || $('#setModel').value;
  if (chosen) AI.cfg.models[p.id] = chosen;
  const vchosen = $('#setVisionModel').value;
  if (vchosen) AI.setVisionModel(vchosen);
  AI.persist();

  const st = await AI.status();
  if (st.ok) {
    msg.className = 'msg ok';
    msg.textContent = '✓ Connected to ' + (st.providerName || st.provider) + ' using ' + st.model + '. Vision model: ' + (AI.visionModel() || 'n/a') + '.';
    setLight('#lightBrain', 'on', 'Brain online: ' + st.model);
    $('#tbSub').textContent = 'live coach · ' + (st.provider || '') + ' · ' + (st.model || '');
    $('#watchModel').textContent = st.model || 'brain on';
    $('#watchModel').className = 'chip info';
    $('#watchHint').textContent = AI.canVision() ? 'vision ready — press ▶ Start watching' : 'no vision on this provider — offline reader only';
    syncProviderFields();
    if (S.coach) S.coach.setAI(coachAI());
    toast('Brain connected: ' + st.model, 'ok');
  } else {
    msg.className = 'msg err';
    msg.textContent = '✗ ' + (st.error || 'Could not connect.');
    setLight('#lightBrain', 'err', st.error || 'Brain offline');
    toast(st.error || 'Brain offline', 'err');
  }
  btn.disabled = false;
  return st;
}

function applySettingsToUI() {
  $('#selInterval').value = String(S.settings.intervalMs);
  $('#selSensitivity').value = S.settings.sensitivity;
  $('#setCapture').value = S.settings.capture;
  $('#setQuality').value = String(S.settings.quality);
  $('#setMaxW').value = String(S.settings.maxW);
  $('#setPauseHidden').checked = !!S.settings.pauseHidden;
  $('#setRisk').value = String(S.settings.riskPercent);
  $('#setAccount').value = S.settings.account || '';
  $('#setDailyCap').value = String(S.settings.dailyCap);
  $('#setDemoMode').checked = !!S.settings.demoMode;
  const onTop = $('#setOnTop'), dock = $('#setDock'), op = $('#setOpacity'), wd = $('#setWidth');
  if (onTop) onTop.checked = S.settings.onTop !== false;
  if (dock) dock.value = S.settings.dock || 'right';
  if (op) op.value = S.settings.opacity == null ? 100 : S.settings.opacity;
  if (wd) wd.value = S.settings.width || 400;
}

function bindSettings() {
  const save = debounce(async (patch) => {
    S.settings = Object.assign({}, S.settings, patch);
    if (S.coach) S.coach.configure(S.settings);
    // Connection info is device-local; never upload it with the settings.
    const wire = Object.assign({}, S.settings);
    delete wire.serverUrl; delete wire.serverToken;
    try { await Backend.saveSettings(wire); } catch {}
    if (Backend.isElectron) Backend.window({
      onTop: S.settings.onTop !== false, dock: S.settings.dock,
      opacity: S.settings.opacity, width: S.settings.width
    });
  }, 220);

  $('#selInterval').addEventListener('change', (e) => save({ intervalMs: Number(e.target.value) }));
  $('#selSensitivity').addEventListener('change', (e) => save({ sensitivity: e.target.value }));
  $('#setCapture').addEventListener('change', (e) => {
    BrowserCapture.stop(); CameraCapture.stop();
    save({ capture: e.target.value });
    if (e.target.value === 'camera') {
      toast('Point the camera at your chart and press Start watching. Hold the phone steady.', 'ok');
    }
  });
  $('#btnInstallApp').addEventListener('click', installApp);
  $('#setServerUrl').value = Conn.url;
  $('#setServerToken').value = Conn.token;
  $('#setServerUrl').addEventListener('change', (e) => {
    Conn.url = e.target.value.trim();
    Conn.save();
    loadState().catch(() => {});
    toast(Conn.url ? 'Connected to ' + Conn.url : 'Back to the server this page came from.', 'ok');
  });
  $('#setServerToken').addEventListener('change', (e) => {
    Conn.token = e.target.value.trim();
    Conn.save();
    loadState().catch(() => {});
  });
  $('#btnTestServer').addEventListener('click', async () => {
    try {
      const st = await Backend.state();
      toast('Connected: ' + st.sources.length + ' sources, ' + st.stats.chunks + ' pieces.', 'ok');
    } catch (e) {
      toast('Could not reach it: ' + e.message, 'err');
    }
  });
  $('#setQuality').addEventListener('change', (e) => save({ quality: Number(e.target.value) }));
  $('#setMaxW').addEventListener('change', (e) => save({ maxW: Number(e.target.value) }));
  $('#setPauseHidden').addEventListener('change', (e) => save({ pauseHidden: e.target.checked }));
  $('#setRisk').addEventListener('change', (e) => save({ riskPercent: Number(e.target.value) }));
  $('#setAccount').addEventListener('input', (e) => save({ account: Number(e.target.value) || 0 }));
  $('#setDailyCap').addEventListener('change', (e) => save({ dailyCap: Number(e.target.value) }));
  $('#setDemoMode').addEventListener('change', (e) => {
    save({ demoMode: e.target.checked });
    if (S.coach) S.coach.setAI(coachAI());
    toast(e.target.checked ? 'Offline demo mode ON — no AI calls, rule-based coaching only.' : 'Offline demo mode OFF.', 'ok');
    refreshBrainChip();
  });

  $('#setProvider').addEventListener('change', (e) => { AI.cfg.provider = e.target.value; AI.persist(); syncProviderFields(); });
  $('#btnBrainTest').addEventListener('click', testBrain);

  if (Backend.isElectron) {
    $('#btnPickWin').classList.remove('hidden');
    $('#btnPickWin').addEventListener('click', async () => {
      $('#pickedWin').textContent = 'pick a window from the menu…';
      const r = await Backend.pickWindow();
      if (r && r.ok) {
        $('#pickedWin').textContent = 'watching: ' + (r.name || 'the whole screen');
        $('#setCapture').value = r.id ? 'window' : 'screen';
        save({ capture: r.id ? 'window' : 'screen' });
        toast('Now watching ' + (r.name || 'the whole screen') + '.', 'ok');
      } else {
        $('#pickedWin').textContent = (r && r.error) || 'picker cancelled';
      }
    });
    $('#setOnTop').addEventListener('change', (e) => save({ onTop: e.target.checked }));
    $('#setDock').addEventListener('change', (e) => save({ dock: e.target.value }));
    $('#setOpacity').addEventListener('input', (e) => save({ opacity: Number(e.target.value) }));
    $('#setWidth').addEventListener('input', (e) => save({ width: Number(e.target.value) }));
  }

  $('#btnSizeCalc').addEventListener('click', () => {
    const box = $('#sizeCalc');
    box.classList.toggle('hidden');
    if (box.classList.contains('hidden')) return;
    box.innerHTML =
      '<label class="fld">Account equity<input type="number" id="calcAcct" value="' + (S.settings.account || 2000) + '"></label>' +
      '<label class="fld">Risk %<input type="number" id="calcRisk" step="0.1" value="' + (S.settings.riskPercent || 1) + '"></label>' +
      '<label class="fld">Entry price<input type="number" id="calcEntry" step="any" placeholder="e.g. 64250"></label>' +
      '<label class="fld">Stop price<input type="number" id="calcStop" step="any" placeholder="e.g. 63800"></label>' +
      '<button class="btn small primary" id="calcGo" style="margin-top:8px">Calculate</button>' +
      '<div class="calc-out" id="calcOut"></div>';
    $('#calcGo').addEventListener('click', () => {
      const acct = Number($('#calcAcct').value) || 0;
      const riskPct = Number($('#calcRisk').value) || 0;
      const entry = Number($('#calcEntry').value) || 0;
      const stop = Number($('#calcStop').value) || 0;
      const out = $('#calcOut');
      if (!acct || !entry || !stop || entry === stop) { out.innerHTML = '<div class="bad">Fill in account, entry and stop (they must differ).</div>'; return; }
      const dist = Math.abs(entry - stop);
      const riskCash = acct * (riskPct / 100);
      const size = riskCash / dist;
      const notional = size * entry;
      const rr = (Math.abs(entry - stop) ? (dist * 2) / dist : 0);
      const lev = acct ? notional / acct : 0;
      out.innerHTML =
        '<div>Risk amount: ' + riskCash.toFixed(2) + '</div>' +
        '<div>Stop distance: ' + dist + ' (' + ((dist / entry) * 100).toFixed(2) + '% of price)</div>' +
        '<div><b>Position size: ' + size.toFixed(size < 10 ? 4 : 2) + ' units</b></div>' +
        '<div>Notional: ' + notional.toFixed(2) + (lev > 1 ? ' <span class="warn">(' + lev.toFixed(1) + '× leverage on equity)</span>' : '') + '</div>' +
        '<div>Target at 2R: ' + (entry + (entry > stop ? 1 : -1) * dist * 2).toFixed(2) + ' (R:R ' + rr.toFixed(1) + ':1)</div>' +
        '<div class="warn">Stop is ' + (entry > stop ? 'below' : 'above') + ' entry — ' + ((dist / entry) * 100 > 8 ? 'that is a wide stop, so the size is small on purpose.' : 'looks reasonable.') + '</div>';
    });
  });

  $('#btnExport').addEventListener('click', async () => {
    try {
      const data = await Backend.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'trading-companion-knowledge-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Exported.', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });

  $('#btnImport').addEventListener('click', () => $('#inImport').click());
  $('#inImport').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const r = await Backend.importData(data);
      if (!r || r.ok === false) throw new Error((r && r.error) || 'Import failed.');
      toast('Imported ' + (r.sources || 0) + ' sources.', 'ok');
      await loadState();
    } catch (err) { toast(err.message, 'err'); }
    e.target.value = '';
  });

  $('#btnWipe').addEventListener('click', async () => {
    if (!confirm('Erase ALL sources, cards, journal and skill data? This cannot be undone.')) return;
    if (!confirm('Really sure? Export first if you want a backup.')) return;
    try { await Backend.wipe(); toast('Everything erased.', 'ok'); await loadState(); }
    catch (e) { toast(e.message, 'err'); }
  });
}

function refreshBrainChip() {
  const demo = S.settings.demoMode;
  if (demo) {
    setLight('#lightBrain', 'off', 'Offline demo mode (no AI)');
    $('#watchModel').textContent = 'offline demo';
    $('#watchModel').className = 'chip warn';
    $('#tbSub').textContent = 'live coach · offline demo mode';
    $('#watchHint').textContent = 'offline demo: rule-based coaching from the built-in curriculum + your library';
    return;
  }
  const online = !!(window.AI && AI.online);
  setLight('#lightBrain', online ? 'on' : 'err', online ? ('Brain online: ' + AI.model) : 'No brain connected — offline coaching only');
  $('#watchModel').textContent = online ? (AI.model || 'brain on') : 'no brain';
  $('#watchModel').className = 'chip ' + (online ? 'info' : 'warn');
  $('#tbSub').textContent = online ? ('live coach · ' + AI.cfg.provider + ' · ' + (AI.model || '')) : 'live coach · offline demo mode';
  $('#watchHint').textContent = online
    ? (AI.canVision() ? 'vision ready — press ▶ Start watching' : 'no vision on this provider — offline reader only')
    : 'connect a brain in Settings for real screen analysis (free Gemini key works)';
}

/* ══════════════════════════════ views / nav ══════════════════════════════ */

function switchView(v) {
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  if (v === 'learn') renderLearn();
  if (v === 'journal') renderJournal();
  if (v === 'library') { renderCards(); renderTerms(); }
  if (v === 'feed') renderSources();
  if (v === 'coach') $('#main').scrollTop = 0;
}

function setBubble(on) {
  document.body.classList.toggle('bubbled', !!on);
  $('#bubble').classList.toggle('hidden', !on);
  Backend.bubble(!!on);
  if (on && S.settings.pauseHidden) { /* keep watching; the window is still visible as a bubble */ }
}

function renderStats() {
  const st = (S.state && S.state.stats) || {};
  $('#kbStats').innerHTML = [
    ['sources', st.sources || 0], ['pieces', st.chunks || 0], ['words', fmtNum(st.words || 0)],
    ['cards', st.cards || 0], ['journal', st.journalEntries || 0], ['read min', st.readingMinutes || 0]
  ].map(([k, v]) => '<div class="stat"><b>' + v + '</b><span>' + k + '</span></div>').join('') +
    ((st.coverageGaps || []).length
      ? '<div class="insight warn" style="flex:1 1 100%">Your library does not cover: <b>' + st.coverageGaps.map(esc).join('</b>, <b>') + '</b> — the Learn tab will prioritise those.</div>'
      : '');
  setLight('#lightKb', (st.sources || 0) ? 'on' : 'off', (st.sources || 0) + ' sources · ' + (st.chunks || 0) + ' searchable pieces');
}

async function loadState() {
  let st = null;
  try { st = await Backend.state(); } catch (e) { st = { ok: false, error: e.message }; }
  if (!st || st.ok === false) {
    S.state = { stats: {} };
    S.sources = []; S.cards = []; S.journal = [];
    $('#dataPath').textContent = 'Storage unavailable: ' + ((st && st.error) || 'no server') +
      '. Run "node server.js" in the project folder, or use the desktop app. Coach + curriculum still work offline.';
    renderStats(); renderSources(); renderCards(); renderTerms(); renderLearn(); renderJournal();
    return;
  }
  S.state = st;
  S.sources = st.sources || [];
  S.cards = st.cards || [];
  S.journal = st.journal || [];
  S.skills = st.skills || {};
  S.doneModules = (S.skills && S.skills.__done) || [];
  S.settings = Object.assign({}, DEFAULT_SETTINGS, st.settings || {});
  if (S.coach) S.coach.skills = S.skills;
  $('#dataPath').textContent = 'Stored at: ' + (st.dataPath || 'in memory') + '  ·  shell: ' + st.shell +
    '  ·  engine v' + (st.engineVersion || '?');
  applySettingsToUI();
  renderStats(); renderSources(); renderCards(); renderTerms(); renderLearn(); renderJournal();
  refreshBrainChip();
}

/* ══════════════════════════════ boot ══════════════════════════════ */

function bindChrome() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));
  $('#btnSettings').addEventListener('click', () => switchView('settings'));
  $('#btnEmptyFeed').addEventListener('click', () => switchView('feed'));
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('#modal').classList.contains('hidden')) closeModal(); else if (document.body.classList.contains('bubbled')) setBubble(false); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#btnLook').click(); }
  });

  $('#btnWatch').addEventListener('click', () => { S.watching ? stopWatching() : startWatching(); });
  $('#btnLook').addEventListener('click', () => analyseOnce({ force: true }));
  $('#askForm').addEventListener('submit', (e) => { e.preventDefault(); askCoach($('#askInput').value); });
  $('#btnAvatar').addEventListener('click', () => {
    if (S.lastCard) { switchView('coach'); $('#main').scrollTop = 0; } else analyseOnce({ force: true });
  });

  $('#btnBubble').addEventListener('click', () => setBubble(!document.body.classList.contains('bubbled')));
  $('#bubble').addEventListener('click', () => setBubble(false));
  $('#btnClose').addEventListener('click', () => {
    if (Backend.isElectron) Backend.close();
    else { stopWatching(); toast('In the browser the panel just stops watching. Use the desktop app to close the window.', 'warn'); }
  });

  $('#btnLearnUrls').addEventListener('click', learnUrls);
  $('#btnLearnText').addEventListener('click', learnText);
  $('#btnPickFile').addEventListener('click', () => $('#inFile').click());
  $('#inFile').addEventListener('change', (e) => { learnFile(e.target.files && e.target.files[0]); e.target.value = ''; });
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); doSearch(); });
  $('#btnAddJournal').addEventListener('click', addJournal);
  $('#btnReview').addEventListener('click', weeklyReview);
  $('#btnRefreshPlan').addEventListener('click', renderPlan);
  $('#btnQuizMe').addEventListener('click', () => openQuiz(null));

  Backend.onFrame((payload) => {
    // Electron pushes frames when the main process is doing the cadence; we drive
    // our own timer instead, so this is only used for on-demand pushes.
    if (payload && payload.dataUrl) { S.lastFrame = null; }
  });
  Backend.onCommand((cmd) => {
    if (cmd === 'toggle') { document.body.classList.contains('bubbled') ? setBubble(false) : ($('#main').style.display === 'none' ? setBubble(false) : setBubble(true)); }
    else if (cmd === 'watch') { S.watching ? stopWatching() : startWatching(); }
    else if (cmd === 'look') analyseOnce({ force: true });
    else if (cmd === 'hide') setBubble(true);
    else if (cmd === 'shown') { window.__hidden = false; }
    else if (cmd === 'hidden') { window.__hidden = true; }
  });
}

/* ── installable app (Android / iOS / desktop Chrome) ─────────────────────── */
let deferredInstall = null;

function registerServiceWorker() {
  if (Backend.isElectron) return;
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  // Default scope ('/') so the cached shell covers /engine and /ai.js too;
  // sw.js deliberately passes every non-companion request straight through.
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

function installApp() {
  if (deferredInstall) {
    deferredInstall.prompt();
    deferredInstall.userChoice.then((r) => {
      if (r && r.outcome === 'accepted') toast('Installed. Look for the Companion on your home screen.', 'ok');
      deferredInstall = null;
      $('#btnInstallApp').classList.add('hidden');
    });
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  toast(ios
    ? 'On iPhone/iPad: Share → "Add to Home Screen".'
    : 'On Android: browser menu → "Add to Home screen" / "Install app".', 'warn');
}

function bindInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    $('#btnInstallApp').classList.remove('hidden');
    $('#installHint').textContent = 'One tap: adds the Companion to your home screen as a full-screen app.';
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    $('#btnInstallApp').classList.add('hidden');
    toast('Installed as an app. 🎉', 'ok');
  });
}

function applyManifestShortcut() {
  const q = new URLSearchParams(location.search);
  const view = q.get('view');
  if (view && ['coach', 'feed', 'library', 'learn', 'journal', 'settings'].indexOf(view) >= 0) switchView(view);
  if (q.get('act') === 'look') setTimeout(() => { analyseOnce(); }, 600);
}

async function boot() {
  document.body.dataset.shell = Backend.isElectron ? 'electron' : 'browser';
  if (!Backend.isElectron) $('#btnClose').title = 'Stop watching (browser mode)';

  Conn.load();
  registerServiceWorker();
  bindInstallPrompt();

  // Phones cannot share the screen but they do have a camera: default to it.
  if (!Backend.isElectron && !S.settings.capture) {
    const md = navigator.mediaDevices || {};
    if (!md.getDisplayMedia && md.getUserMedia) {
      S.settings.capture = 'camera';
      $('#setCapture').value = 'camera';
    }
  }

  makeCoach();
  bindChrome();
  bindSettings();
  renderBrainSettings();
  await loadState();

  if (window.AI) {
    AI.status().then(() => { refreshBrainChip(); syncProviderFields(); });
  }

  if (Backend.fileOnly) {
    toast('Opened as a plain file — run "node server.js" or the desktop app to save what you feed me.', 'warn');
  } else if (!Backend.isElectron) {
    const md = navigator.mediaDevices || {};
    toast(md.getDisplayMedia
      ? 'Browser mode: screen watching uses the browser share prompt. For a true always-on-top side panel, run the desktop app.'
      : 'Phone mode: use 📷 Camera as the capture source and point it at your chart. For the floating side panel, run the desktop app.', 'warn');
  }

  applyManifestShortcut();
  setStatus('ready · ' + (Backend.isElectron ? 'desktop shell' : 'browser shell'));
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', boot);
  window.CompanionApp = { S, Backend, Conn, analyseOnce, startWatching, stopWatching, switchView, setBubble, openModule, openQuiz, CameraCapture, installApp };
}
