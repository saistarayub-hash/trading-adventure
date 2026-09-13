'use strict';
/* text.js — turns messy sources (web pages, PDFs, pasted transcripts) into clean
 * readable text. Dependency-free: a small regex/scan based extractor, good enough
 * for articles, blogs, docs and course pages. */

const zlib = require('zlib');

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', deg: '°', times: '×', divide: '÷', laquo: '«', raquo: '»',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß'
};

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const k = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m;
    });
}

function safeChar(code) {
  if (!isFinite(code) || code <= 0 || code > 0x10ffff) return '';
  try { return String.fromCodePoint(code); } catch { return ''; }
}

const DROP_TAGS = ['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'head', 'form', 'button', 'select'];
// Page furniture that never carries reading text. Removing it keeps cookie
// banners, nav menus, "related posts" and comment forms out of the knowledge base.
const BOILER_TAGS = ['nav', 'footer', 'aside'];
const BOILER_CLASS = 'cookie|consent|newsletter|subscribe|related|comment|sidebar|social|share|promo|advert|banner|menu|breadcrumb|pagination|footer|nav|signup|paywall|modal|popup';
const BLOCK_TAGS = ['p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'li', 'ul', 'ol',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'tr', 'table', 'blockquote', 'pre', 'figcaption', 'dd', 'dt'];

/**
 * Convert raw HTML into clean plain text, trying to keep the main article body.
 * @param {string} html
 * @returns {{text:string, title:string, byline:string}}
 */
function htmlToText(html) {
  let src = String(html || '');
  const title = extractTitle(src);

  // Grab meta description / author before we start cutting.
  const byline = metaContent(src, 'author') || metaContent(src, 'article:author') || '';
  const description = metaContent(src, 'description') || metaContent(src, 'og:description') || '';

  // Remove comments + the tags that never carry reading text.
  src = src.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of DROP_TAGS.concat(BOILER_TAGS)) {
    src = src.replace(new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?<\\/' + tag + '\\s*>', 'gi'), ' ');
    src = src.replace(new RegExp('<' + tag + '\\b[^>]*\\/>', 'gi'), ' ');
  }
  // Shallow boilerplate containers (cookie bars, related-post rails, share widgets).
  for (let pass = 0; pass < 3; pass++) {
    const before = src.length;
    src = src.replace(new RegExp('<(div|section|ul|form)\\b[^>]*(?:id|class)\\s*=\\s*["\'][^"\']*(?:' + BOILER_CLASS + ')[^"\']*["\'][^>]*>[\\s\\S]*?<\\/\\1\\s*>', 'gi'), ' ');
    if (src.length === before) break;
  }

  // Remember headings as markers so the structure survives.
  src = src.replace(/<h([1-6])\b[^>]*>/gi, (_, n) => '\n\n' + '#'.repeat(Number(n)) + ' ')
    .replace(/<\/h[1-6]\s*>/gi, '\n');
  src = src.replace(/<li\b[^>]*>/gi, '\n• ');
  for (const tag of BLOCK_TAGS) {
    src = src.replace(new RegExp('<\\/?' + tag + '\\b[^>]*>', 'gi'), '\n');
  }

  let text = decodeEntities(stripTags(src));
  text = cleanText(text);

  // Prefer the densest region: article extractors usually beat full-page noise.
  const main = pickMainRegion(String(html || ''), title);
  if (main && main.length > 400 && main.length < text.length * 0.95) text = main;

  const head = [title && 'Title: ' + title, byline && 'Author: ' + byline, description && 'Summary: ' + description]
    .filter(Boolean).join('\n');

  return { text: (head ? head + '\n\n' : '') + text, title, byline, description };
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ');
}

function extractTitle(html) {
  const og = metaContent(html, 'og:title');
  if (og) return collapse(og).slice(0, 200);
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return '';
  return collapse(decodeEntities(stripTags(m[1]))).replace(/\s*[|\-–—:]\s*[^|\-–—:]{2,40}$/i, '').slice(0, 200);
}

function metaContent(html, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('<meta[^>]+(?:name|property)\\s*=\\s*["\']' + esc + '["\'][^>]*>', 'i');
  const m = re.exec(html);
  if (!m) return '';
  const c = /content\s*=\s*["']([\s\S]*?)["']/i.exec(m[0]);
  return c ? collapse(decodeEntities(c[1])) : '';
}

function collapse(s) { return decodeEntities(stripTags(String(s || ''))).replace(/\s+/g, ' ').trim(); }

function cleanText(s) {
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0\u2007\u202f]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]+/gm, '')
    .trim();
}

/** Try to isolate the biggest block of real prose on the page. */
function pickMainRegion(html, title) {
  const candidates = [];
  const patterns = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<div[^>]*(?:id|class)\s*=\s*["'][^"']*(?:post-content|entry-content|article-body|content-body|markdown-body|prose)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<footer|<div[^>]*(?:related|comments|sidebar))/gi
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const t = cleanText(decodeEntities(collapseKeepBreaks(m[1])));
      if (t.length > 300) candidates.push(t);
      if (candidates.length > 6) break;
    }
    if (candidates.length) break;
  }
  if (!candidates.length) return '';
  candidates.sort((a, b) => b.length - a.length);
  const best = candidates[0];
  const head = title ? 'Title: ' + title + '\n\n' : '';
  return head + best;
}

function collapseKeepBreaks(s) {
  return String(s || '')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
}

/* ---------------------------------- PDF ---------------------------------- */

/**
 * Best-effort text extraction from a PDF buffer, with no dependencies.
 * Handles FlateDecode streams and the common Tj / TJ / ' / " text operators.
 * Scanned image-only PDFs will yield nothing (we report that honestly).
 * @param {Buffer} buf
 */
function pdfToText(buf) {
  const raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (raw.slice(0, 5).toString('latin1') !== '%PDF-') return { text: '', error: 'That file does not look like a PDF.' };

  const latin = raw.toString('latin1');
  const out = [];
  const streamRe = /stream\r?\n?/g;
  let m;
  let guard = 0;

  while ((m = streamRe.exec(latin)) !== null && guard++ < 4000) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    const dictStart = Math.max(0, latin.lastIndexOf('<<', m.index));
    const dict = latin.slice(dictStart, m.index);
    let data = raw.slice(start, end);

    let inflated = null;
    if (/FlateDecode/i.test(dict)) {
      try { inflated = zlib.inflateSync(data); }
      catch { try { inflated = zlib.inflateRawSync(data); } catch { inflated = null; } }
    } else {
      inflated = data; // uncompressed content stream
    }
    if (!inflated || !inflated.length) continue;

    const body = inflated.toString('latin1');
    if (!/(Tj|TJ|Td|BT)\b/.test(body)) continue; // not a content stream
    const text = pdfContentToText(body);
    if (text.trim().length > 2) out.push(text);
  }

  let text = cleanText(out.join('\n'));
  if (!text) return { text: '', error: 'No selectable text found — this PDF is probably scanned images. Paste the text instead.' };
  if (/^\s*[\u0001-\u001f\uf000-\uf0ff\s]{0,40}$/.test(text.slice(0, 80))) {
    return { text: '', error: 'That PDF uses embedded font encoding I cannot decode offline. Paste the text instead.' };
  }
  return { text };
}

function pdfContentToText(body) {
  let out = '';
  const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|TJ|Tj|T\*|Td|TD|ET|BT/g;
  let m;
  let line = '';
  while ((m = re.exec(body)) !== null) {
    const tok = m[0];
    if (tok === 'Tj' || tok === 'TJ') { out += line; line = ''; continue; }
    if (tok === 'T*' || tok === 'Td' || tok === 'TD' || tok === 'ET') { if (line) { out += line; line = ''; } out += '\n'; continue; }
    if (tok === 'BT') { line = ''; continue; }
    if (tok[0] === '(') { line += pdfString(tok.slice(1, -1)); continue; }
    if (tok[0] === '<') { line += pdfHexString(tok.slice(1, -1)); continue; }
  }
  if (line) out += line;
  return out;
}

function pdfString(s) {
  return String(s).replace(/\\(\d{1,3}|.)/g, (_, esc) => {
    if (/^\d+$/.test(esc)) return safeChar(parseInt(esc, 8));
    if (esc === 'n') return '\n';
    if (esc === 'r') return '';
    if (esc === 't') return '\t';
    return esc;
  });
}

function pdfHexString(s) {
  const hex = String(s).replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const code = parseInt(hex.substr(i, 2), 16);
    if (code >= 32 && code < 127) out += String.fromCharCode(code);
    else if (code === 10 || code === 13) out += '\n';
  }
  return out;
}

/* --------------------------------- generic -------------------------------- */

/**
 * Normalise anything the user pastes or uploads into clean text.
 * @param {string} text
 * @param {{maxChars?:number}} [opts]
 */
function normalise(text, opts) {
  const max = (opts && opts.maxChars) || 400000;
  let t = cleanText(String(text || ''));
  t = t.replace(/\uFEFF/g, '');
  // Auto-generated video captions repeat lines; drop immediate duplicates.
  const lines = t.split('\n');
  const dedup = [];
  for (const l of lines) {
    const key = l.trim().toLowerCase();
    if (key && dedup.length && dedup[dedup.length - 1].trim().toLowerCase() === key) continue;
    dedup.push(l);
  }
  t = cleanText(dedup.join('\n'));
  if (t.length > max) t = t.slice(0, max) + '\n…[truncated]';
  return t;
}

function wordCount(text) {
  const m = String(text || '').match(/[\p{L}\p{N}'’-]+/gu);
  return m ? m.length : 0;
}

module.exports = { htmlToText, pdfToText, normalise, cleanText, decodeEntities, collapse, wordCount, extractTitle, metaContent };
