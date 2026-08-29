'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function ensureSecret() {
  const file = path.join(ROOT, '.secret');
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    if (v) return v;
  } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'users.json');
const SESSION_SECRET = process.env.SESSION_SECRET || ensureSecret();
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

let db = null;

function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    if (fs.existsSync(DB_FILE)) {
      try { fs.renameSync(DB_FILE, DB_FILE + '.bak-' + Date.now()); } catch {}
    }
    db = { users: {} };
  }
  if (!db.users || typeof db.users !== 'object') db.users = {};
}

function saveDb() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

loadDb();

function scryptHash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key.toString('hex')));
  });
}

function cleanUsername(raw) {
  const u = String(raw || '').trim().toLowerCase();
  return /^[a-z0-9_.-]{3,20}$/.test(u) ? u : null;
}

function checkPassword(pw) {
  return typeof pw === 'string' && pw.length >= 6 && pw.length <= 128;
}

function emptyProgress() {
  return { score: 0, streak: 0, bestStreak: 0, done: {}, updated: Date.now() };
}

function cloneProgress(p) {
  p = p || {};
  return {
    score: +p.score || 0,
    streak: +p.streak || 0,
    bestStreak: +p.bestStreak || 0,
    done: p.done && typeof p.done === 'object' ? Object.assign({}, p.done) : {},
    updated: p.updated || Date.now()
  };
}

function sanitizeProgress(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const num = (v) => Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : 0;
  const s = {
    score: num(p.score),
    streak: num(p.streak),
    bestStreak: num(p.bestStreak),
    done: {}
  };
  if (p.done && typeof p.done === 'object') {
    for (const k of Object.keys(p.done)) s.done[k] = !!p.done[k];
  }
  s.updated = Date.now();
  return s;
}

async function register(username, password) {
  const u = cleanUsername(username);
  if (!u) return { ok: false, error: 'Username must be 3–20 characters: letters, numbers, dots, dashes or underscores.' };
  if (!checkPassword(password)) return { ok: false, error: 'Password must be at least 6 characters long.' };
  if (db.users[u]) return { ok: false, error: 'That username is already taken — try another one.' };
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scryptHash(password, salt);
  db.users[u] = { salt, hash, created: Date.now(), progress: emptyProgress() };
  saveDb();
  return { ok: true, user: u };
}

async function login(username, password) {
  const u = String(username || '').trim().toLowerCase();
  const rec = db.users[u];
  if (!rec || !checkPassword(password)) return { ok: false, error: 'Incorrect username or password.' };
  const hash = await scryptHash(password, rec.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(rec.hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'Incorrect username or password.' };
  rec.lastSeen = Date.now();
  saveDb();
  return { ok: true, user: u, progress: cloneProgress(rec.progress) };
}

function issueToken(username, expOverride) {
  const exp = expOverride != null ? expOverride : Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ u: username, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1], 'utf8');
  const b = Buffer.from(expect, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (typeof p.u !== 'string' || !p.exp || p.exp < Date.now()) return null;
    if (!db.users[p.u]) return null;
    return { user: p.u };
  } catch { return null; }
}

function getProgress(username) {
  const rec = db.users[username];
  return rec ? cloneProgress(rec.progress) : null;
}

function userCount() {
  return Object.keys(db.users).length;
}

function setProgress(username, raw) {
  const rec = db.users[username];
  if (!rec) return { ok: false, error: 'Unknown user.' };
  rec.progress = sanitizeProgress(raw);
  saveDb();
  return { ok: true };
}

module.exports = {
  register,
  login,
  issueToken,
  verifyToken,
  getProgress,
  setProgress,
  userCount,
  cleanUsername,
  checkPassword,
  emptyProgress,
  cloneProgress,
  sanitizeProgress,
  DB_FILE,
  SESSION_SECRET_SET: !!process.env.SESSION_SECRET
};