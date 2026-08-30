'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const AUTH = require('./auth');

const PORT = process.env.PORT || 8081;
const ROOT = __dirname;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CREATOR = AUTH.CREATOR;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new Error('Payload too large')); req.destroy(); return; }
      data += c;
    });
    req.on('end', () => {
      if (!data) { resolve({}); return; }
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Bad JSON')); }
    });
    req.on('error', reject);
  });
}

const RATE = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (RATE.get(ip) || []).filter((t) => now - t < 600000);
  if (list.length >= 40) return true;
  list.push(now);
  RATE.set(ip, list);
  return false;
}

function bearer(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1] : null;
}

function b64uToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function verifyGoogle(credential) {
  if (!GOOGLE_CLIENT_ID) throw new Error('Google sign-in is not set up yet on this site.');
  const parts = String(credential || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid Google token.');
  const header = JSON.parse(b64uToBuf(parts[0]).toString('utf8'));
  const payload = JSON.parse(b64uToBuf(parts[1]).toString('utf8'));
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const j = await r.json();
  const key = (j.keys || []).find((k) => k.kid === header.kid);
  if (!key) throw new Error('Google signing key not found.');
  const pub = crypto.createPublicKey({ key: { kty: 'RSA', n: key.n, e: key.e }, format: 'jwk' });
  const ver = crypto.createVerify('RSA-SHA256');
  ver.update(parts[0] + '.' + parts[1]);
  if (!ver.verify(pub, parts[2], 'base64')) throw new Error('Google signature check failed.');
  if (payload.exp * 1000 < Date.now()) throw new Error('Google login has expired.');
  if (payload.aud !== GOOGLE_CLIENT_ID) throw new Error('Google login is for a different app.');
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com' && payload.iss !== 'https://accounts.google.com/') throw new Error('Google login issuer mismatch.');
  if (!payload.sub) throw new Error('Google login missing user id.');
  return payload;
}

const LS_FILE = process.env.LESSONS_FILE || path.join(ROOT, 'lessons.json');
let lessonsDb = loadLessons();

function loadLessons() {
  try {
    const d = JSON.parse(fs.readFileSync(LS_FILE, 'utf8'));
    if (d && Array.isArray(d.lessons)) return d;
  } catch {}
  return { lessons: [] };
}

function saveLessons() {
  fs.mkdirSync(path.dirname(LS_FILE), { recursive: true });
  const tmp = LS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(lessonsDb, null, 2));
  fs.renameSync(tmp, LS_FILE);
}

function validateLesson(x) {
  if (!x || typeof x !== 'object') return null;
  const id = String(x.id || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(id)) return null;
  const title = String(x.title || '').trim();
  const easy = String(x.easy || '').trim();
  const tip = String(x.tip || '').trim();
  if (!title || !easy || !tip || title.length > 80 || easy.length > 200 || tip.length > 300) return null;
  const sections = Array.isArray(x.sections)
    ? x.sections.slice(0, 12).map((s) => {
        const h = String(s && s.h || '').trim();
        const b = String(s && s.b || '').trim();
        const ex = s && s.ex ? String(s.ex).trim() : '';
        if (!h && !b) return null;
        return { h: h || b.slice(0, 60), b: b || h, ex: ex || null };
      }).filter(Boolean)
    : [];
  const questions = Array.isArray(x.questions)
    ? x.questions.slice(0, 20).map((q) => {
        const qq = String(q && q.q || '').trim();
        const options = Array.isArray(q.options) && q.options.length === 4 ? q.options.map((o) => String(o).trim()) : null;
        const answer = Number(q.answer);
        if (!qq || !options || !options.every(Boolean) || !(answer >= 0 && answer <= 3)) return null;
        return { q: qq, options, answer, why: String(q.why || '').trim() || '' };
      }).filter(Boolean)
    : [];
  if (sections.length === 0 || questions.length < 3) return null;
  return {
    id, title,
    emoji: String(x.emoji || '📘').trim().slice(0, 8) || '📘',
    minutes: String(x.minutes || '2 min read').trim().slice(0, 40) || '2 min read',
    easy, tip,
    sections,
    questions,
    createdBy: CREATOR,
    updated: Date.now()
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, name: 'professor-fox', users: AUTH.userCount() });
    return;
  }

  if (pathname === '/api/config' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, googleClientId: GOOGLE_CLIENT_ID, creator: CREATOR });
    return;
  }

  if (pathname === '/api/lessons' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, lessons: lessonsDb.lessons.slice() });
    return;
  }

  if (pathname === '/api/google' && req.method === 'POST') {
    if (rateLimited(req.socket.remoteAddress)) { sendJSON(res, 429, { ok: false, error: 'Too many attempts. Please wait a few minutes.' }); return; }
    let body;
    try { body = await readBody(req); } catch (e) { sendJSON(res, 400, { ok: false, error: e.message }); return; }
    let profile;
    try { profile = await verifyGoogle(body.credential); }
    catch (e) { sendJSON(res, 401, { ok: false, error: 'Google sign-in failed: ' + e.message }); return; }
    const r = AUTH.findOrCreateGoogle(profile);
    if (!r.ok) { sendJSON(res, 400, { ok: false, error: r.error }); return; }
    const token = AUTH.issueToken(r.user);
    sendJSON(res, 200, { ok: true, token, user: r.user, role: r.role, progress: r.progress });
    return;
  }

  if (pathname === '/api/register' && req.method === 'POST') {
    if (rateLimited(req.socket.remoteAddress)) { sendJSON(res, 429, { ok: false, error: 'Too many attempts. Please wait a few minutes.' }); return; }
    let body;
    try { body = await readBody(req); } catch (e) { sendJSON(res, 400, { ok: false, error: e.message }); return; }
    const r = await AUTH.register(body.username, body.password);
    if (!r.ok) { sendJSON(res, 400, { ok: false, error: r.error }); return; }
    const token = AUTH.issueToken(r.user);
    sendJSON(res, 200, { ok: true, token, user: r.user, role: AUTH.getRole(r.user), progress: AUTH.getProgress(r.user) });
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    if (rateLimited(req.socket.remoteAddress)) { sendJSON(res, 429, { ok: false, error: 'Too many attempts. Please wait a few minutes.' }); return; }
    let body;
    try { body = await readBody(req); } catch (e) { sendJSON(res, 400, { ok: false, error: e.message }); return; }
    const r = await AUTH.login(body.username, body.password);
    if (!r.ok) { sendJSON(res, 401, { ok: false, error: r.error }); return; }
    const token = AUTH.issueToken(r.user);
    sendJSON(res, 200, { ok: true, token, user: r.user, role: AUTH.getRole(r.user), progress: r.progress });
    return;
  }

  const token = bearer(req);
  const session = token ? AUTH.verifyToken(token) : null;
  if (!session) {
    if (pathname === '/api/me' || pathname === '/api/progress') { sendJSON(res, 401, { ok: false, error: 'Not signed in.' }); return; }
    sendJSON(res, 401, { ok: false, error: 'Not signed in.' });
    return;
  }

  if (pathname === '/api/me' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, user: session.user, role: AUTH.getRole(session.user), progress: AUTH.getProgress(session.user) });
    return;
  }

  if (pathname === '/api/lessons' && req.method === 'PUT') {
    if (AUTH.getRole(session.user) !== 'creator') { sendJSON(res, 403, { ok: false, error: 'Only the creator can add or edit lessons.' }); return; }
    let body;
    try { body = await readBody(req); } catch (e) { sendJSON(res, 400, { ok: false, error: e.message }); return; }
    const lesson = validateLesson(body.lesson);
    if (!lesson) { sendJSON(res, 400, { ok: false, error: 'Lesson did not pass validation. Check every field and the question format.' }); return; }
    const i = lessonsDb.lessons.findIndex((l) => l.id === lesson.id);
    if (i >= 0) lessonsDb.lessons[i] = lesson; else lessonsDb.lessons.push(lesson);
    saveLessons();
    sendJSON(res, 200, { ok: true, lessons: lessonsDb.lessons.slice() });
    return;
  }

  if (pathname === '/api/progress' && req.method === 'PUT') {
    let body;
    try { body = await readBody(req); } catch (e) { sendJSON(res, 400, { ok: false, error: e.message }); return; }
    const r = AUTH.setProgress(session.user, body.progress);
    sendJSON(res, r.ok ? 200 : 400, r);
    return;
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    sendJSON(res, 200, { ok: true });
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Unknown API route.' });
}

function serveStatic(pathname, req, res) {
  let urlPath = decodeURIComponent(pathname);
  if (urlPath === '/') urlPath = '/index.html';
  let filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 Not Found: ' + urlPath); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function lanIPs() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets || {})) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const pathname = u.pathname.replace(/\/+$/, '') || '/';
    if (pathname.startsWith('/api/')) { await handleApi(req, res, pathname); return; }
    serveStatic(pathname, req, res);
  } catch (e) {
    sendJSON(res, 500, { ok: false, error: 'Server error: ' + e.message });
  }
});

server.listen(PORT, () => {
  console.log('Professor Fox Trading Adventure is running.');
  console.log('  Local:      http://localhost:' + PORT);
  const ips = lanIPs();
  for (const ip of ips) console.log('  On your Wi-Fi/network: http://' + ip + ':' + PORT);
  console.log('  Share on the internet: run a tunnel (see README) or deploy to Render/Railway.');
  console.log('  Accounts file: ' + AUTH.DB_FILE);
});