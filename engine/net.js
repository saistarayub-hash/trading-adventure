'use strict';
/* net.js — tiny dependency-free HTTP helper used by the ingestion pipeline.
 * Works in Node 18+ (global fetch). Handles redirects, timeouts, text/binary,
 * and sets a real browser User-Agent so sites don't reject us. */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36 TradingCompanion/1.0';

const MAX_BYTES = Number(process.env.COMPANION_MAX_FETCH || 12e6); // 12 MB
const MAX_REDIRECTS = 6;

function isAbsolute(u) { return /^https?:\/\//i.test(u); }

function absolutize(base, href) {
  try { return new URL(href, base).toString(); } catch { return href; }
}

/**
 * Fetch a URL and return { ok, status, url, contentType, text, buffer, error }.
 * @param {string} url
 * @param {{timeout?:number, headers?:object, asText?:boolean, cookie?:string}} [opts]
 */
async function get(url, opts) {
  const o = opts || {};
  const timeout = o.timeout || 25000;
  let current = String(url || '').trim();
  if (!isAbsolute(current)) return { ok: false, error: 'That is not a web address (must start with http:// or https://).' };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const headers = Object.assign({
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }, o.headers || {});
    if (o.cookie) headers.Cookie = o.cookie;

    try {
      const res = await fetch(current, { signal: ctl.signal, headers, redirect: 'manual' });
      const status = res.status;

      if (status >= 300 && status < 400) {
        const loc = res.headers.get('location');
        try { await res.arrayBuffer(); } catch {}
        if (!loc) return { ok: false, status, error: 'Redirect with no destination.' };
        current = absolutize(current, loc);
        continue;
      }

      if (status >= 400) {
        try { await res.arrayBuffer(); } catch {}
        return { ok: false, status, url: current, error: 'The site said "' + status + '". It may block bots, need a login, or the link is dead.' };
      }

      const contentType = (res.headers.get('content-type') || '').toLowerCase();

      // Stream with a hard byte cap so a huge file can't eat all the RAM.
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      let buffer;
      if (reader) {
        const parts = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BYTES) { try { await reader.cancel(); } catch {} break; }
          parts.push(value);
        }
        buffer = Buffer.concat(parts.map((p) => Buffer.from(p)));
      } else {
        buffer = Buffer.from(await res.arrayBuffer());
      }

      const wantsText = o.asText !== false && /text\/|json|xml|javascript|html/.test(contentType);
      return {
        ok: true,
        status,
        url: current,
        contentType,
        truncated: buffer.length >= MAX_BYTES,
        buffer,
        text: wantsText ? stripNulls(buffer.toString('utf8')) : null
      };
    } catch (e) {
      const msg = e && e.name === 'AbortError' ? 'Timed out after ' + Math.round(timeout / 1000) + 's.' : (e && e.message) || String(e);
      return { ok: false, url: current, error: 'Could not reach it: ' + msg };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: 'Too many redirects.' };
}

function stripNulls(s) { return String(s).replace(/\u0000/g, ''); }

module.exports = { get, absolutize, isAbsolute, UA, MAX_BYTES };
