'use strict';
/* ingest.js — one entry point for everything the trader feeds the companion:
 *   • YouTube link  → captions/transcript + title + chapters + description
 *   • article / blog / docs link → main-body text extraction
 *   • pasted text or transcript → straight in
 *   • uploaded file (.txt .md .csv .json .html .pdf) → parsed
 * Returns clean text ready for kb.addSource(). */

const path = require('path');
const { get } = require('./net');
const { htmlToText, pdfToText, normalise, collapse } = require('./text');
const yt = require('./youtube');

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.srt', '.vtt', '.html', '.htm', '.pdf']);
const MAX_PASTE = 400000;

function guessKind(url) {
  if (yt.isYouTube(url)) return 'video';
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return 'video-file';
  if (/vimeo\.com|twitch\.tv|kick\.com|dailymotion/i.test(url)) return 'video-other';
  if (/\.(mp3|wav|m4a|ogg)(\?|$)/i.test(url)) return 'audio';
  if (/twitter\.com|x\.com/i.test(url)) return 'social';
  if (/t\.me|discord\.com|reddit\.com/i.test(url)) return 'social';
  return 'article';
}

/** Subtitle files → plain text. */
function subtitleToText(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      if (/^\d+$/.test(t)) return false;                       // srt index
      if (/^\d{1,2}:\d{2}(:\d{1,2})?([.,]\d{1,3})?\s*-->/.test(t)) return false; // cue timestamps
      if (/^(WEBVTT|Kind:|Language:|NOTE)/i.test(t)) return false;
      if (/^\[[^\]]{1,30}\]$/.test(t)) return false;            // [Music]
      return true;
    })
    .join('\n');
}

/**
 * Ingest a URL.
 * @param {string} url
 * @param {{language?:string}} [opts]
 */
async function ingestUrl(url, opts) {
  const target = String(url || '').trim();
  if (!target) return { ok: false, error: 'Paste a link first.' };
  const kind = guessKind(target);

  if (kind === 'video') {
    const r = await yt.ingestYouTube(target, opts || {});
    if (!r.ok) return { ok: false, kind, url: target, error: r.error };
    return {
      ok: true,
      kind: 'video',
      url: r.url,
      title: r.meta.title || 'YouTube video ' + r.id,
      text: r.text,
      note: r.note || '',
      meta: {
        author: r.meta.channel || r.meta.author || '',
        channel: r.meta.channel || '',
        durationSeconds: r.meta.durationSeconds || 0,
        transcript: r.transcript,
        transcriptChars: r.transcriptChars || 0,
        published: r.meta.published || '',
        views: r.meta.views || 0,
        chapters: r.meta.chapters || []
      },
      tags: ['video']
    };
  }

  if (kind === 'video-other' || kind === 'video-file' || kind === 'audio') {
    return {
      ok: false,
      kind,
      url: target,
      error: 'I can auto-read YouTube links only. For ' + kind.replace('-', ' ') +
        ': open the transcript/captions, copy it, and paste it into the "Paste text" box — I will learn all of it.'
    };
  }

  const res = await get(target, { timeout: 30000 });
  if (!res.ok) return { ok: false, kind, url: target, error: res.error };

  const ctype = res.contentType || '';
  let text = '';
  let title = '';
  let note = '';

  if (ctype.includes('pdf') || /\.pdf(\?|$)/i.test(res.url)) {
    const p = pdfToText(res.buffer);
    if (!p.text) return { ok: false, kind: 'pdf', url: res.url, error: p.error || 'Could not read that PDF.' };
    text = p.text;
    title = path.basename(new URL(res.url).pathname).replace(/\.pdf$/i, '');
    note = p.text.length < 2000 ? 'Short PDF — I may have missed scanned pages.' : '';
  } else if (ctype.includes('json')) {
    text = prettyJson(res.text);
    title = 'JSON: ' + res.url;
  } else if (/<\s*html/i.test(res.text || '') || ctype.includes('html')) {
    const parsed = htmlToText(res.text);
    text = parsed.text;
    title = parsed.title || res.url;
  } else {
    text = normalise(res.text || '');
    title = path.basename(new URL(res.url).pathname) || res.url;
    if (/^\d{2}:\d{2}/.test(text) || text.includes('-->')) text = subtitleToText(text);
  }

  text = normalise(text, { maxChars: MAX_PASTE });
  if (text.length < 120) {
    return {
      ok: false,
      kind,
      url: res.url,
      error: 'That page has almost no readable text (it may be a video player, an app that needs JavaScript, or a paywall). ' +
        'Paste the important text manually and I will learn it.'
    };
  }

  return {
    ok: true,
    kind: ctype.includes('pdf') ? 'pdf' : 'article',
    url: res.url,
    title: collapse(title).slice(0, 200),
    text,
    note: note || (res.truncated ? 'Very large page — I kept the first part only.' : ''),
    meta: { contentType: ctype, truncated: !!res.truncated },
    tags: [kind]
  };
}

function prettyJson(text) {
  try {
    const j = JSON.parse(text);
    return collapse(JSON.stringify(j, null, 1)).slice(0, MAX_PASTE);
  } catch { return normalise(text); }
}

/**
 * Ingest an uploaded file.
 * @param {{name:string, ext?:string, buffer?:Buffer, text?:string}} file
 */
function ingestFile(file) {
  const name = String((file && file.name) || 'file');
  const ext = (file.ext || path.extname(name)).toLowerCase();
  if (!TEXT_EXT.has(ext)) {
    return {
      ok: false,
      error: 'I can read ' + Array.from(TEXT_EXT).join(', ') + '. For images or Word docs, copy the text out and paste it.'
    };
  }
  let text = '';
  if (ext === '.pdf') {
    const p = pdfToText(file.buffer || Buffer.from(''));
    if (!p.text) return { ok: false, error: p.error || 'Could not read that PDF.' };
    text = p.text;
  } else if (ext === '.html' || ext === '.htm') {
    text = htmlToText(file.buffer ? file.buffer.toString('utf8') : (file.text || '')).text;
  } else {
    const raw = file.buffer ? file.buffer.toString('utf8') : (file.text || '');
    text = (ext === '.srt' || ext === '.vtt') ? subtitleToText(raw) : raw;
  }
  text = normalise(text, { maxChars: MAX_PASTE });
  if (text.length < 40) return { ok: false, error: 'That file had no readable text in it.' };
  return {
    ok: true,
    kind: 'file',
    title: name.replace(/\.[a-z0-9]+$/i, ''),
    text,
    meta: { filename: name, ext },
    tags: ['file', ext.slice(1)]
  };
}

/** Ingest raw pasted text (transcript, notes, a strategy write-up…). */
function ingestText(text, title) {
  const clean = normalise(text, { maxChars: MAX_PASTE });
  if (clean.length < 40) return { ok: false, error: 'Paste a bit more text (at least a few sentences).' };
  const firstLine = clean.split('\n').find((l) => l.trim().length > 3) || '';
  return {
    ok: true,
    kind: 'text',
    title: (title || '').trim().slice(0, 200) || ('Note: ' + collapse(firstLine).slice(0, 90)),
    text: clean,
    meta: {},
    tags: ['pasted']
  };
}

/** Ingest several links in one go (newline/comma separated). */
async function ingestMany(urls, opts) {
  const list = String(urls || '').split(/[\n,]+|\s{2,}/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 12);
  const results = [];
  for (const u of list) {
    try { results.push(Object.assign({ url: u }, await ingestUrl(u, opts))); }
    catch (e) { results.push({ ok: false, url: u, error: e.message }); }
  }
  return results;
}

module.exports = { ingestUrl, ingestFile, ingestText, ingestMany, subtitleToText, guessKind, TEXT_EXT, MAX_PASTE };
