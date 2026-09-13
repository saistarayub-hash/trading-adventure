'use strict';
/* youtube.js — pull captions/transcripts + metadata from a YouTube link with no
 * dependencies and no API key. Tries several routes and degrades gracefully. */

const { get, absolutize } = require('./net');
const { decodeEntities, cleanText, collapse } = require('./text');

const YT_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

function parseId(url) {
  const s = String(url || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = YT_ID_RE.exec(s);
  return m ? m[1] : null;
}

function isYouTube(url) {
  return /(?:youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(String(url || ''));
}

function canonicalUrl(id) { return 'https://www.youtube.com/watch?v=' + id; }

/**
 * Extract a JSON object that starts at `from` by walking braces with depth
 * counting (string- and escape-aware). Far more robust than a regex terminator,
 * because YouTube changes what follows the object between releases.
 */
function scanJsonObject(html, from) {
  const s = String(html || '');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(from, i + 1);
    }
  }
  return null;
}

/** Pull `varName = {...}` out of a page. */
function extractJsonVar(html, varName) {
  const s = String(html || '');
  const re = new RegExp('(?:var|let|const|window\\.)\\s*' + varName + '\\s*=\\s*', 'g');
  let m;
  let tries = 0;
  while ((m = re.exec(s)) !== null && tries++ < 4) {
    const at = m.index + m[0].length;
    if (s[at] !== '{') continue;
    const raw = scanJsonObject(s, at);
    if (!raw) continue;
    try { return JSON.parse(raw); } catch { /* keep looking for another assignment */ }
  }
  return null;
}

/** Parse a watch page's embedded player + data objects. */
function parseWatchPage(html) {
  return {
    player: extractJsonVar(html, 'ytInitialPlayerResponse'),
    data: extractJsonVar(html, 'ytInitialData')
  };
}

/** Scrape the watch page for ytInitialPlayerResponse / ytInitialData. */
async function watchPage(id) {
  const url = canonicalUrl(id);
  const res = await get(url, {
    timeout: 25000,
    cookie: 'CONSENT=YES+cb.20240101-00-p0.en+FX+000; SOCS=CAI',
    headers: { 'Accept-Language': 'en-US,en;q=0.9' }
  });
  if (!res.ok || !res.text) return { ok: false, error: res.error || 'Could not open the video page.' };
  const html = res.text;
  const parsed = parseWatchPage(html);
  return { ok: true, html, player: parsed.player, data: parsed.data };
}

function metaFromPlayer(player) {
  if (!player) return {};
  const vd = player.videoDetails || {};
  const mf = ((player.microformat || {}).playerMicroformatRenderer) || {};
  return {
    title: vd.title || mf.title && mf.title.simpleText || '',
    author: vd.author || '',
    channel: vd.author || '',
    seconds: Number(vd.lengthSeconds) || 0,
    views: Number(vd.viewCount) || 0,
    published: mf.publishDate || '',
    description: vd.shortDescription || ''
  };
}

function captionTracks(player) {
  const tracks = ((((player || {}).captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks) || [];
  return tracks.filter((t) => t && t.baseUrl);
}

function pickTrack(tracks, prefer) {
  if (!tracks.length) return null;
  const lang = String(prefer || 'en').slice(0, 2).toLowerCase();
  const score = (t) => {
    const code = String(t.languageCode || '').toLowerCase();
    const kind = String(t.kind || '');
    let s = 0;
    if (code === lang) s += 10; else if (code.startsWith(lang)) s += 6;
    if (kind === 'asr') s -= 3; // prefer human captions over auto-generated
    if (!t.vssId || /^a\./.test(t.vssId)) s -= 1;
    return s;
  };
  return tracks.slice().sort((a, b) => score(b) - score(a))[0];
}

/** Fetch and clean one caption track into readable paragraphs. */
async function fetchTrack(track) {
  let url = track.baseUrl;
  // Ask for JSON3 when possible: it is the cleanest format.
  if (!/[&?]fmt=/.test(url)) url += (url.includes('?') ? '&' : '?') + 'fmt=json3';
  url = url.replace(/&/g, '&');

  const res = await get(url, { timeout: 30000, headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!res.ok || !res.text) {
    // Retry plain XML form.
    const plain = track.baseUrl.replace(/([?&])fmt=[^&]*/, '$1').replace(/[?&]$/, '');
    const r2 = await get(plain, { timeout: 30000 });
    if (!r2.ok || !r2.text) return { ok: false, error: res.error || 'Could not download the captions.' };
    return { ok: true, text: xmlCaptionsToText(r2.text), language: track.languageCode || '' };
  }

  const body = res.text;
  if (body.trim()[0] === '{') {
    let j = null;
    try { j = JSON.parse(body); } catch { j = null; }
    if (j && Array.isArray(j.events)) return { ok: true, text: json3ToText(j), language: track.languageCode || '' };
  }
  return { ok: true, text: xmlCaptionsToText(body), language: track.languageCode || '' };
}

function json3ToText(j) {
  const out = [];
  for (const ev of j.events || []) {
    const segs = ev.segs;
    if (!Array.isArray(segs)) continue;
    const line = segs.map((s) => s.utf8 || '').join('');
    if (line.trim()) out.push(line.replace(/\s+/g, ' ').trim());
  }
  return paragraphise(out);
}

function xmlCaptionsToText(xml) {
  const out = [];
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    const t = collapse(decodeEntities(m[1]));
    if (t) out.push(t);
  }
  return paragraphise(out);
}

/** Caption lines are short; glue them into paragraphs so chunking works well. */
function paragraphise(lines) {
  const clean = [];
  for (const l of lines) {
    const t = String(l || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (t === '[Music]' || t === '[Applause]' || /^\[[^\]]{1,20}\]$/.test(t)) continue;
    if (clean.length && clean[clean.length - 1] === t) continue;
    clean.push(t);
  }
  const paras = [];
  let buf = [];
  let len = 0;
  for (const t of clean) {
    buf.push(t);
    len += t.length + 1;
    if (len > 700) { paras.push(buf.join(' ')); buf = []; len = 0; }
  }
  if (buf.length) paras.push(buf.join(' '));
  return cleanText(paras.join('\n\n'));
}

/** Legacy timedtext endpoint — works for some videos without scraping. */
async function timedtextFallback(id, langs) {
  for (const lang of langs || ['en', 'en-US', 'en-GB']) {
    const url = 'https://video.google.com/timedtext?type=list&v=' + id;
    const list = await get(url, { timeout: 15000 });
    if (list.ok && list.text) {
      const re = /<track\b[^>]*langCode\s*=\s*["']([^"']+)["'][^>]*>/gi;
      let m;
      const found = [];
      while ((m = re.exec(list.text)) !== null) found.push(m[1]);
      const use = found.includes(lang) ? lang : found[0];
      if (use) {
        const cap = await get('https://video.google.com/timedtext?lang=' + encodeURIComponent(use) + '&v=' + id, { timeout: 20000 });
        if (cap.ok && cap.text && cap.text.includes('<text')) {
          return { ok: true, text: xmlCaptionsToText(cap.text), language: use };
        }
      }
    }
    const direct = await get('https://video.google.com/timedtext?lang=' + encodeURIComponent(lang) + '&v=' + id, { timeout: 20000 });
    if (direct.ok && direct.text && direct.text.includes('<text')) {
      return { ok: true, text: xmlCaptionsToText(direct.text), language: lang };
    }
  }
  return { ok: false, error: 'No captions available through the fallback route.' };
}

/** Chapter titles from ytInitialData — useful structure even without captions. */
function chaptersFromData(data) {
  if (!data) return [];
  const found = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) { for (const n of node) walk(n, depth + 1); return; }
    const mr = node.macroMarkersListItemRenderer;
    if (mr && mr.title) {
      const title = typeof mr.title === 'string' ? mr.title : (mr.title.simpleText || (mr.title.runs || []).map((r) => r.text).join(''));
      if (title) found.push(collapse(title));
    }
    for (const k of Object.keys(node)) walk(node[k], depth + 1);
  };
  walk(data, 0);
  return found.slice(0, 80);
}

/**
 * Full ingest for one YouTube link.
 * @returns {Promise<{ok:boolean, id:string, url:string, meta:object, text:string, transcript:boolean, note:string, error?:string}>}
 */
async function ingestYouTube(url, opts) {
  const id = parseId(url);
  if (!id) return { ok: false, error: 'That does not look like a YouTube link.' };
  const o = opts || {};
  const page = await watchPage(id);
  const meta = metaFromPlayer(page.ok ? page.player : null);
  const canonical = canonicalUrl(id);

  if (!page.ok && !meta.title) {
    return {
      ok: false,
      id,
      url: canonical,
      error: page.error || 'YouTube blocked the request. Paste the transcript manually and I will still learn it.'
    };
  }

  let transcriptText = '';
  let transcriptLang = '';
  let note = '';

  const tracks = captionTracks(page.player);
  const track = pickTrack(tracks, o.language || 'en');
  if (track) {
    const r = await fetchTrack(track);
    if (r.ok && r.text && r.text.length > 60) { transcriptText = r.text; transcriptLang = r.language || track.languageCode || ''; }
    else note = r.error || '';
  }

  if (!transcriptText) {
    const fb = await timedtextFallback(id, [o.language || 'en']);
    if (fb.ok && fb.text && fb.text.length > 60) { transcriptText = fb.text; transcriptLang = fb.language || ''; }
  }

  const chapters = chaptersFromData(page.data);
  const parts = [];
  if (meta.title) parts.push('Video title: ' + meta.title);
  if (meta.channel) parts.push('Channel: ' + meta.channel);
  if (meta.published) parts.push('Published: ' + meta.published);
  parts.push('Link: ' + canonical);
  if (chapters.length) parts.push('Chapters:\n' + chapters.map((c) => '• ' + c).join('\n'));
  if (meta.description) parts.push('Description:\n' + meta.description);
  if (transcriptText) parts.push((transcriptLang ? 'Transcript (' + transcriptLang + ')' : 'Transcript') + ':\n' + transcriptText);

  const text = cleanText(parts.join('\n\n'));

  if (!transcriptText) {
    note = note || 'This video has no downloadable captions, so I learned the title, chapters and description only. ' +
      'Open the video → "…" → Show transcript → copy → paste it into the Feed tab and I will learn the whole thing.';
  }

  return {
    ok: true,
    id,
    url: canonical,
    kind: 'video',
    meta: Object.assign({ durationSeconds: meta.seconds, chapters }, meta),
    transcript: !!transcriptText,
    transcriptLanguage: transcriptLang,
    transcriptChars: transcriptText.length,
    note,
    text
  };
}

module.exports = {
  isYouTube, parseId, canonicalUrl, ingestYouTube, xmlCaptionsToText, json3ToText, paragraphise,
  parseWatchPage, extractJsonVar, scanJsonObject, metaFromPlayer, captionTracks, pickTrack,
  chaptersFromData, watchPage, fetchTrack, timedtextFallback
};
