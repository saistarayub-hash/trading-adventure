'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const AUTH = require('./auth');

const PORT = process.env.PORT || 8081;
const ROOT = __dirname;

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

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJSON(res, 200, { ok: true, name: 'professor-fox', users: AUTH.userCount() });
    return;
  }

  if (pathname === '/api/register' && req.method === 'POST') {
    if (rateLimited(req.socket.remoteAddress)) { sendJSON(res, 429, { ok: false, error: 'Too many attempts. Please wait a few minutes.' }); return; }
    let body;
    try { body = await readBody(req); } catch (e) { sendJSON(res, 400, { ok: false, error: e.message }); return; }
    const r = await AUTH.register(body.username, body.password);
    if (!r.ok) { sendJSON(res, 400, { ok: false, error: r.error }); return; }
    const token = AUTH.issueToken(r.user);
    sendJSON(res, 200, { ok: true, token, user: r.user, progress: AUTH.getProgress(r.user) });
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    if (rateLimited(req.socket.remoteAddress)) { sendJSON(res, 429, { ok: false, error: 'Too many attempts. Please wait a few minutes.' }); return; }
    let body;
    try { body = await readBody(req); } catch (e) { sendJSON(res, 400, { ok: false, error: e.message }); return; }
    const r = await AUTH.login(body.username, body.password);
    if (!r.ok) { sendJSON(res, 401, { ok: false, error: r.error }); return; }
    const token = AUTH.issueToken(r.user);
    sendJSON(res, 200, { ok: true, token, user: r.user, progress: r.progress });
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
    sendJSON(res, 200, { ok: true, user: session.user, progress: AUTH.getProgress(session.user) });
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