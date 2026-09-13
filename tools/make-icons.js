'use strict';
/* tools/make-icons.js — regenerate every app icon from one vector description.
 *
 *   node tools/make-icons.js            # rebuild all icons + installer formats
 *   node tools/make-icons.js --check    # parse everything back and verify
 *
 * Pure Node, zero dependencies. Emits:
 *   companion/icon{16,32,64,128,256}.png   — runtime icons used by the Electron shell
 *   companion/icon.png                     — 256 (same as icon256.png)
 *   companion/packaging/icon.png           — 512, for Linux packages
 *   companion/packaging/icon.ico           — Windows installer icon (PNG-compressed entries)
 *   companion/packaging/icon.icns          — macOS installer icon (all Apple sizes)
 *
 * Why regenerate instead of hand-drawing? electron-builder refuses to build a
 * Windows or macOS installer without a proper .ico / .icns, and a committed
 * binary blob can drift out of sync with the design. This file is the design.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const COMPANION = path.join(__dirname, '..', 'companion');
// NOTE: deliberately NOT named "build" or "dist" — tooling and backup layers
// tend to treat those as disposable, but these icons are committed source art.
const BUILD = path.join(COMPANION, 'packaging');

/* ── the artwork ───────────────────────────────────────────────────────────
 * A rounded orange tile with a white bull candle: wick above and below a
 * thick body. Everything is expressed in fractions of the icon size so any
 * resolution renders identically. */
const ART = {
  radius: 0.20,                 // corner radius / size
  topColor: [255, 158, 84],     // gradient, top
  bottomColor: [227, 95, 23],   // gradient, bottom
  candle: [255, 255, 255],
  wick: { cx: 0.5, y0: 0.203, y1: 0.797, w: 0.070 },
  body: { cx: 0.5, y0: 0.344, y1: 0.656, w: 0.176 }
};

/* ── signed distance helpers (give free anti-aliasing) ─────────────────── */

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdRect(px, py, cx, cy, hw, hh) {
  // Same shape as sdRoundRect with radius 0: negative inside, positive outside.
  const qx = Math.abs(px - cx) - hw;
  const qy = Math.abs(py - cy) - hh;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* Render one icon at N×N, returning raw RGBA.
 * opts.maskable: full-bleed square (Android adaptive icons crop a circle or a
 * squircle out of the middle ~80%), so no rounded corners, no transparency,
 * and the candle pulled into the safe zone. */
function render(N, opts) {
  const maskable = !!(opts && opts.maskable);
  const px = new Float64Array(N * N * 4);
  const a = ART;
  const r = maskable ? 0 : a.radius * N;
  const SAFE = 0.62;   // maskable safe zone: art occupies the middle 62%
  for (let y = 0; y < N; y++) {
    const t = N === 1 ? 0 : y / (N - 1);
    const bgR = a.topColor[0] + (a.bottomColor[0] - a.topColor[0]) * t;
    const bgG = a.topColor[1] + (a.bottomColor[1] - a.topColor[1]) * t;
    const bgB = a.topColor[2] + (a.bottomColor[2] - a.topColor[2]) * t;
    for (let x = 0; x < N; x++) {
      // Tile: pixel centre in icon space.
      const dTile = sdRoundRect(x + 0.5, y + 0.5, N / 2, N / 2, N / 2, N / 2, r);
      const tile = clamp01(0.5 - dTile);
      if (tile <= 0) continue;

      // Candle: wick then body, unioned (scaled into the safe zone if maskable).
      const fit = (v) => 0.5 + (v - 0.5) * SAFE;
      const wk = maskable
        ? { cx: fit(a.wick.cx), y0: fit(a.wick.y0), y1: fit(a.wick.y1), w: a.wick.w * SAFE }
        : a.wick;
      const bd = maskable
        ? { cx: fit(a.body.cx), y0: fit(a.body.y0), y1: fit(a.body.y1), w: a.body.w * SAFE }
        : a.body;
      const dWick = sdRect(x + 0.5, y + 0.5, wk.cx * N, (wk.y0 + wk.y1) / 2 * N, (wk.w * N) / 2, ((wk.y1 - wk.y0) * N) / 2);
      const dBody = sdRect(x + 0.5, y + 0.5, bd.cx * N, (bd.y0 + bd.y1) / 2 * N, (bd.w * N) / 2, ((bd.y1 - bd.y0) * N) / 2);
      const candle = clamp01(0.5 - Math.min(dWick, dBody));

      const o = (y * N + x) * 4;
      px[o] = bgR + (a.candle[0] - bgR) * candle;
      px[o + 1] = bgG + (a.candle[1] - bgG) * candle;
      px[o + 2] = bgB + (a.candle[2] - bgB) * candle;
      px[o + 3] = tile * 255;
    }
  }
  return px;
}

/* ── PNG writer ──────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(N, rgba) {
  const raw = Buffer.alloc(N * (N * 4 + 1));
  let o = 0;
  for (let y = 0; y < N; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      raw[o++] = Math.round(rgba[i]);
      raw[o++] = Math.round(rgba[i + 1]);
      raw[o++] = Math.round(rgba[i + 2]);
      raw[o++] = Math.round(rgba[i + 3]);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* ── ICO writer (Vista+ PNG-compressed entries) ──────────────────────────── */

function encodeIco(entries) {
  // entries: [{size, png}]
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size;       // width  (0 means 256)
    dir[o + 1] = e.size >= 256 ? 0 : e.size;   // height
    dir[o + 2] = 0;                            // palette colours
    dir[o + 3] = 0;                            // reserved
    dir.writeUInt16LE(1, o + 4);               // planes
    dir.writeUInt16LE(32, o + 6);              // bits per pixel
    dir.writeUInt32LE(e.png.length, o + 8);    // bytes in resource
    dir.writeUInt32LE(offset, o + 12);         // offset
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

/* ── ICNS writer ─────────────────────────────────────────────────────────── */

const ICNS_TYPES = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128],
  ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512] // @2x slots
];

function encodeIcns(entries) {
  // entries: Map size -> png buffer
  const chunks = [];
  let total = 8;
  for (const [type, size] of ICNS_TYPES) {
    const png = entries.get(size);
    if (!png) continue;
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    chunks.push(head, png);
    total += png.length + 8;
  }
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...chunks]);
}

/* ── build ───────────────────────────────────────────────────────────────── */

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

function buildAll() {
  fs.mkdirSync(BUILD, { recursive: true });
  const pngs = new Map();
  for (const n of SIZES) {
    pngs.set(n, encodePng(n, render(n)));
  }

  const written = [];
  // Runtime icons the Electron shell loads from disk.
  for (const n of [16, 32, 64, 128, 256]) {
    const p = path.join(COMPANION, 'icon' + n + '.png');
    fs.writeFileSync(p, pngs.get(n));
    written.push(p);
  }
  fs.writeFileSync(path.join(COMPANION, 'icon.png'), pngs.get(256));
  written.push(path.join(COMPANION, 'icon.png'));

  // Linux package icon (electron-builder wants >= 512).
  fs.writeFileSync(path.join(BUILD, 'icon.png'), pngs.get(512));
  written.push(path.join(BUILD, 'icon.png'));


  // Windows installer icon.
  const ico = encodeIco([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, png: pngs.get(s) })));
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico);
  written.push(path.join(BUILD, 'icon.ico'));

  // macOS installer icon.
  const icns = encodeIcns(pngs);
  fs.writeFileSync(path.join(BUILD, 'icon.icns'), icns);
  written.push(path.join(BUILD, 'icon.icns'));

  // PWA / Android home-screen icons: normal + maskable (adaptive icon).
  for (const n of [192, 512]) {
    const p = path.join(BUILD, 'pwa-' + n + '.png');
    fs.writeFileSync(p, pngs.get(n) || encodePng(n, render(n)));
    written.push(p);
    const m = path.join(BUILD, 'pwa-maskable-' + n + '.png');
    fs.writeFileSync(m, encodePng(n, render(n, { maskable: true })));
    written.push(m);
  }

  return written;
}

/* ── verify: parse every artefact back and check it against the design ───── */

function readPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let pos = 8;
  let w = 0; let h = 0; let bd = 0; let ct = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let i = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[i++];
    if (f !== 0) throw new Error('unexpected filter ' + f);
    raw.copy(out, y * stride, i, i + stride);
    i += stride;
  }
  return { w, h, bd, ct, px: (x, y) => { const o = y * stride + x * ch; return [out[o], out[o + 1], out[o + 2], ch > 3 ? out[o + 3] : 255]; } };
}

function verify() {
  const out = [];
  const check = (name, ok, detail) => out.push({ name, ok: !!ok, detail: detail || '' });

  for (const n of [16, 32, 64, 128, 256]) {
    const p = path.join(COMPANION, 'icon' + n + '.png');
    const img = readPng(fs.readFileSync(p));
    check('icon' + n + '.png is ' + n + '² RGBA8', img.w === n && img.h === n && img.bd === 8 && img.ct === 6,
      img.w + 'x' + img.h + ' ct' + img.ct);
  }

  // Design fidelity at 256: gradient endpoints, candle box, transparency.
  const big = readPng(fs.readFileSync(path.join(COMPANION, 'icon256.png')));
  const top = big.px(128, 2); const bot = big.px(128, 253);
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  check('gradient top matches design', near(top[0], ART.topColor[0], 6) && near(top[1], ART.topColor[1], 6) && near(top[2], ART.topColor[2], 6), top.join(','));
  check('gradient bottom matches design', near(bot[0], ART.bottomColor[0], 6) && near(bot[1], ART.bottomColor[1], 6) && near(bot[2], ART.bottomColor[2], 6), bot.join(','));
  check('corners are transparent', big.px(1, 1)[3] === 0 && big.px(254, 254)[3] === 0);
  const isWhite = (p) => p[0] > 240 && p[1] > 240 && p[2] > 240 && p[3] > 200;
  const bodyRow = Array.from({ length: 256 }, (_, x) => x).filter((x) => isWhite(big.px(x, 128)));
  check('candle body width ≈ design', bodyRow.length > 0 && Math.abs(bodyRow.length - ART.body.w * 256) <= 3, String(bodyRow.length));
  const wickRow = Array.from({ length: 256 }, (_, x) => x).filter((x) => isWhite(big.px(x, 60)));
  check('wick width ≈ design', wickRow.length > 0 && Math.abs(wickRow.length - ART.wick.w * 256) <= 3, String(wickRow.length));
  check('wick is centred', Math.abs((wickRow[0] + wickRow[wickRow.length - 1]) / 2 - 127.5) <= 1.5, String((wickRow[0] + wickRow[wickRow.length - 1]) / 2));

  // ICO: header + directory + each entry parses as a PNG of the declared size.
  const ico = fs.readFileSync(path.join(BUILD, 'icon.ico'));
  check('ico magic', ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1);
  const nEntries = ico.readUInt16LE(4);
  check('ico has 7 entries', nEntries === 7, String(nEntries));
  let icoOk = true; let icoDetail = [];
  for (let i = 0; i < nEntries; i++) {
    const o = 6 + i * 16;
    const w = ico[o] || 256; const h = ico[o + 1] || 256;
    const len = ico.readUInt32LE(o + 8); const off = ico.readUInt32LE(o + 12);
    const img = readPng(ico.slice(off, off + len));
    if (img.w !== w || img.h !== h) { icoOk = false; icoDetail.push(w + '≠' + img.w); } else icoDetail.push(String(w));
  }
  check('ico entries are valid pngs at declared sizes', icoOk, icoDetail.join(','));

  // ICNS: magic, self-consistent length, every Apple size present.
  const icns = fs.readFileSync(path.join(BUILD, 'icon.icns'));
  check('icns magic', icns.toString('ascii', 0, 4) === 'icns');
  check('icns length field matches file', icns.readUInt32BE(4) === icns.length, icns.readUInt32BE(4) + ' vs ' + icns.length);
  const seen = [];
  let p = 8; let icnsOk = true;
  while (p < icns.length) {
    const type = icns.toString('ascii', p, p + 4);
    const len = icns.readUInt32BE(p + 4);
    const img = readPng(icns.slice(p + 8, p + len));
    const want = ICNS_TYPES.find((t) => t[0] === type);
    if (!want || img.w !== want[1]) { icnsOk = false; }
    seen.push(type);
    p += len;
  }
  check('icns entries are valid pngs at declared sizes', icnsOk, seen.join(','));
  check('icns includes the 512 and 1024 sizes electron-builder requires',
    seen.includes('ic09') && seen.includes('ic10'), seen.join(','));

  const linux = readPng(fs.readFileSync(path.join(BUILD, 'icon.png')));
  check('linux icon.png is 512²', linux.w === 512 && linux.h === 512, linux.w + 'x' + linux.h);

  // PWA icons: right sizes, and the maskable one must be fully opaque
  // everywhere (Android crops it — transparent edges show as holes).
  for (const n of [192, 512]) {
    const any = readPng(fs.readFileSync(path.join(BUILD, 'pwa-' + n + '.png')));
    check('pwa-' + n + '.png is ' + n + '²', any.w === n && any.h === n, any.w + 'x' + any.h);
    check('pwa-' + n + '.png keeps transparent corners', any.px(0, 0)[3] === 0);
    const mk = readPng(fs.readFileSync(path.join(BUILD, 'pwa-maskable-' + n + '.png')));
    const corners = [mk.px(0, 0), mk.px(n - 1, 0), mk.px(0, n - 1), mk.px(n - 1, n - 1)];
    check('pwa-maskable-' + n + '.png is fully opaque (adaptive-icon safe)',
      mk.w === n && corners.every((c) => c[3] === 255), corners.map((c) => c[3]).join(','));
    // …and still shows the candle in the safe zone.
    const mid = mk.px(Math.floor(n / 2), Math.floor(n / 2));
    check('pwa-maskable-' + n + '.png has the candle centred', mid[0] > 240 && mid[1] > 240 && mid[2] > 240, mid.join(','));
    const edge = mk.px(Math.floor(n * 0.06), Math.floor(n / 2));
    check('pwa-maskable-' + n + '.png leaves the edge as brand colour', edge[0] > 200 && edge[2] < 120, edge.join(','));
  }

  return out;
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const res = verify();
    let bad = 0;
    for (const r of res) {
      console.log((r.ok ? '  PASS  ' : '  FAIL  ') + r.name + (r.detail ? '  (' + r.detail + ')' : ''));
      if (!r.ok) bad++;
    }
    console.log('\nICON RESULT: ' + (res.length - bad) + ' passed, ' + bad + ' failed');
    process.exit(bad ? 1 : 0);
  }
  const written = buildAll();
  console.log('Regenerated ' + written.length + ' icon files:');
  for (const w of written) {
    const st = fs.statSync(w);
    console.log('  ' + path.relative(process.cwd(), w).padEnd(30) + String(st.size).padStart(7) + ' b');
  }
  const res = verify();
  const bad = res.filter((r) => !r.ok);
  console.log('\nSelf-check: ' + (res.length - bad.length) + '/' + res.length + ' passed');
  if (bad.length) { for (const b of bad) console.log('  FAIL ' + b.name + ' (' + b.detail + ')'); process.exit(1); }
}

module.exports = { render, encodePng, encodeIco, encodeIcns, readPng, verify, ART, SIZES };
