'use strict';
/* server-companion.js — HTTP adapter for the Trading Companion.
 *
 * Thin wrapper: authentication/SSRF gating + routing + JSON encoding. All the
 * real work lives in companion-core.js, which the Electron shell shares.
 *
 * Security notes:
 *   • Ingestion fetches arbitrary URLs, so the whole API is limited to callers
 *     on this machine / local network, or a signed-in creator account.
 *   • Remote callers may never point the fetcher at private or link-local
 *     hosts (SSRF), including hosts that only resolve to private addresses. */

const path = require('path');
const dns = require('dns').promises;
const { createCore, DEFAULT_SETTINGS } = require('./companion-core');

const DATA_DIR = process.env.COMPANION_DATA || path.join(__dirname, '.data');
const COMPANION_OPEN = String(process.env.COMPANION_OPEN || '');
const COMPANION_TOKEN = String(process.env.COMPANION_TOKEN || '');

/**
 * The TCP peer address. X-Forwarded-For is deliberately NOT used for access
 * decisions: a remote attacker can set it to 127.0.0.1 and walk straight in.
 * If you deploy behind a proxy that hides the peer, set COMPANION_OPEN=1 (or
 * COMPANION_TOKEN) instead of trusting a header.
 */
function clientIp(req) {
  return (req.socket && req.socket.remoteAddress) || '';
}

function normaliseIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
}

function isLoopback(ip) {
  const s = normaliseIp(ip);
  return s === '127.0.0.1' || s === '::1' || s === 'localhost' || /^127\./.test(s);
}

function isLocalAddr(ip) {
  const s = normaliseIp(ip);
  if (!s) return false;
  if (isLoopback(s)) return true;
  if (/^10\./.test(s)) return true;
  if (/^192\.168\./.test(s)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(s)) return true;
  if (/^169\.254\./.test(s)) return true;   // link-local (also used by sandbox previews)
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(s)) return true;
  if (/^fe80:/i.test(s)) return true;
  return false;
}

async function ssrfCheck(url, callerIsLocal) {
  let parsed;
  try { parsed = new URL(url); } catch { return { ok: false, error: 'That is not a valid URL.' }; }
  if (!/^https?:$/.test(parsed.protocol)) {
    return { ok: false, error: 'Only http:// and https:// links can be fetched (got ' + parsed.protocol + ').' };
  }
  const lower = String(parsed.hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (callerIsLocal) return { ok: true };
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) {
    return { ok: false, error: 'Refusing to fetch a local address for a remote caller.' };
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(lower) && isLocalAddr(lower)) {
    return { ok: false, error: 'Refusing to fetch a private IP for a remote caller.' };
  }
  try {
    const recs = await dns.lookup(lower, { all: true });
    for (const r of recs || []) if (isLocalAddr(r.address)) return { ok: false, error: 'That domain resolves to a private address.' };
  } catch { /* DNS problems surface later as a fetch error */ }
  return { ok: true };
}

/**
 * @param {{publishLessons?:Function, isCreator?:Function, dataDir?:string}} hooks
 */
function createCompanionApi(hooks) {
  const H = hooks || {};
  const core = createCore({
    dataDir: H.dataDir || DATA_DIR,
    publishLessons: H.publishLessons
  });

  async function handle(req, res, pathname, session) {
    const send = (code, obj) => sendJSON(res, code, obj);
    const ip = clientIp(req);
    const local = isLocalAddr(ip);
    const loopback = isLoopback(ip);
    const creator = !!(session && H.isCreator && H.isCreator(session));
    const bearer = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    const tokenOk = !!(COMPANION_TOKEN &&
      (String(req.headers['x-companion-token'] || '') === COMPANION_TOKEN || bearer === COMPANION_TOKEN));

    // CORS preflight. Announcing the capability leaks nothing: the real
    // request still has to carry the token (or come from this machine).
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Companion-Token',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Max-Age': '600',
        'Content-Length': 0
      });
      res.end();
      return true;
    }
    const openMode = COMPANION_OPEN === '1';

    if (!local && !creator && !tokenOk && !openMode) {
      return send(403, { ok: false, error: 'The companion API is only open to this machine (or the signed-in creator). ' +
        'Behind a proxy? Set COMPANION_OPEN=1 or COMPANION_TOKEN.' });
    }

    // Only a truly local caller (or an explicit token/creator) may ask this server
    // to fetch internal addresses. LAN guests and proxied callers cannot.
    const trustedFetcher = loopback || tokenOk || creator || openMode;

    const tail = pathname.split('/').filter(Boolean).slice(2);
    const route = tail.join('/');
    const query = req._query || new URLSearchParams('');

    try {
      if (req.method === 'GET' && route === 'state') return send(200, core.state('server'));
      if (req.method === 'GET' && route === 'export') return send(200, core.exportData());

      if (req.method === 'POST' && route === 'ingest/url') {
        const body = await readBodySafe(req);
        if (!body) return send(400, { ok: false, error: 'Bad JSON body.' });
        const url = String(body.url || '').trim();
        if (!url) return send(400, { ok: false, error: 'No link given.' });
        const guard = await ssrfCheck(url, trustedFetcher);
        if (!guard.ok) return send(403, { ok: false, error: guard.error });
        const r = await core.ingestUrl(url, body.language);
        return send(200, r);
      }

      if (req.method === 'POST' && route === 'ingest/text') {
        const body = await readBodySafe(req);
        if (!body) return send(400, { ok: false, error: 'Bad JSON body.' });
        return send(200, await core.ingestText(body.text, body.title));
      }

      if (req.method === 'POST' && route === 'ingest/file') {
        const body = await readBodySafe(req);
        if (!body) return send(400, { ok: false, error: 'Bad JSON body.' });
        return send(200, await core.ingestFile(body));
      }

      if (req.method === 'GET' && /^sources\/[^/]+\/text$/.test(route)) {
        const r = core.sourceText(decodeURIComponent(tail[1]), query.get('chunk'));
        return send(r.ok ? 200 : 404, r);
      }

      if (req.method === 'DELETE' && /^sources\/[^/]+$/.test(route)) {
        const r = core.removeSource(decodeURIComponent(tail[1]));
        return send(r.ok ? 200 : 404, r);
      }

      if (req.method === 'POST' && route === 'search') {
        const body = await readBodySafe(req);
        if (!body) return send(400, { ok: false, error: 'Bad JSON body.' });
        return send(200, core.search(body.q, body.k));
      }

      if (req.method === 'POST' && route === 'pack') {
        const body = await readBodySafe(req);
        if (!body) return send(400, { ok: false, error: 'Bad JSON body.' });
        return send(200, core.pack(body.query, body.question));
      }

      if (req.method === 'POST' && route === 'distill') {
        const body = await readBodySafe(req);
        if (!body) return send(400, { ok: false, error: 'Bad JSON body.' });
        const r = core.saveDistill(body.sourceId, body.result);
        return send(r.ok ? 200 : 404, r);
      }

      if (req.method === 'POST' && route === 'cards') {
        const body = await readBodySafe(req);
        if (!body) return send(400, { ok: false, error: 'Bad JSON body.' });
        return send(200, core.saveCard(body));
      }

      if (req.method === 'DELETE' && /^cards\/[^/]+$/.test(route)) {
        const r = core.removeCard(decodeURIComponent(tail[1]));
        return send(r.ok ? 200 : 404, r);
      }

      if (req.method === 'POST' && route === 'journal') {
        const body = await readBodySafe(req);
        if (!body) return send(400, { ok: false, error: 'Bad JSON body.' });
        return send(200, core.addJournal(body));
      }

      if (req.method === 'DELETE' && /^journal\/[^/]+$/.test(route)) {
        const r = core.removeJournal(decodeURIComponent(tail[1]));
        return send(r.ok ? 200 : 404, r);
      }

      if (req.method === 'PUT' && route === 'skills') {
        const body = await readBodySafe(req);
        if (!body) return send(400, { ok: false, error: 'Bad JSON body.' });
        return send(200, core.saveSkills(body.skills));
      }

      if (req.method === 'PUT' && route === 'settings') {
        const body = await readBodySafe(req);
        if (!body) return send(400, { ok: false, error: 'Bad JSON body.' });
        return send(200, core.saveSettings(body.settings || body));
      }

      if (req.method === 'POST' && route === 'publish') {
        const body = await readBodySafe(req);
        if (!body) return send(400, { ok: false, error: 'Bad JSON body.' });
        const r = core.publishLessons(body.lessons);
        return send(r.ok ? 200 : 400, r);
      }

      if (req.method === 'POST' && route === 'import') {
        const body = await readBodySafe(req);
        const data = body && body.data ? body.data : body;
        return send(200, core.importData(data));
      }

      if (req.method === 'POST' && route === 'wipe') return send(200, core.wipe());

      return send(404, { ok: false, error: 'Unknown companion route: ' + route });
    } catch (e) {
      return send(500, { ok: false, error: 'Companion error: ' + (e && e.message ? e.message : e) });
    }
  }

  return { handle, core, DATA_DIR, isLocalAddr, isLoopback, ssrfCheck };
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Companion-Token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(body);
}

async function readBodySafe(req, limit) {
  const max = limit || 16e6; // transcripts and PDFs can be big
  return new Promise((resolve) => {
    let data = '';
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { done = true; resolve(null); try { req.destroy(); } catch {} return; }
      data += c;
    });
    req.on('end', () => {
      if (done) return;
      if (!data) { resolve({}); return; }
      try { resolve(JSON.parse(data)); } catch { resolve(null); }
    });
    req.on('error', () => { if (!done) resolve(null); });
  });
}

module.exports = { createCompanionApi, createCore, isLocalAddr, isLoopback, ssrfCheck, DATA_DIR, DEFAULT_SETTINGS };
