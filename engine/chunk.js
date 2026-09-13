'use strict';
/* chunk.js — splits long text into overlapping, meaning-preserving pieces so the
 * engine can search and quote them precisely. Sentence-aware, heading-aware. */

const TARGET = 700;      // chars per chunk
const OVERLAP = 140;     // chars of overlap so nothing gets cut in half
const HARD_MAX = 1100;

function splitSentences(text) {
  const s = String(text || '');
  // Protect common abbreviations so we don't split inside them.
  const guarded = s.replace(/\b(Mr|Mrs|Ms|Dr|Prof|vs|etc|e\.g|i\.e|Inc|Ltd|Jr|Sr|Fig|No)\./g, '$1<DOT>');
  const parts = guarded.split(/(?<=[.!?])\s+(?=[A-Z0-9"'“(\u2022#])/);
  return parts.map((p) => p.replace(/<DOT>/g, '.').trim()).filter(Boolean);
}

function splitParagraphs(text) {
  return String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

function isHeadingLine(line) {
  return /^#{1,6}\s+/.test(line) || /^[A-Z0-9][A-Z0-9 ,&'’\-:()/]{3,70}$/.test(line.trim());
}

/**
 * @param {string} text
 * @param {{target?:number, overlap?:number, prefix?:string}} [opts]
 * @returns {Array<{i:number, text:string, heading:string|null, start:number}>}
 */
function chunk(text, opts) {
  const o = opts || {};
  const target = o.target || TARGET;
  const overlap = Math.min(o.overlap == null ? OVERLAP : o.overlap, Math.floor(target / 2));
  const src = String(text || '').replace(/\r/g, '').trim();
  if (!src) return [];

  // Build units: paragraphs first, then sentences for long paragraphs.
  const units = [];
  let cursor = 0;
  let heading = null;
  for (const para of splitParagraphs(src)) {
    const at = src.indexOf(para, cursor);
    if (at >= 0) cursor = at;
    if (isHeadingLine(para) && para.length <= 90) { heading = para.replace(/^#{1,6}\s+/, ''); cursor += para.length; continue; }
    if (para.length <= target) {
      units.push({ text: para, start: cursor, heading });
      cursor += para.length;
    } else {
      for (const sent of splitSentences(para)) {
        const sat = src.indexOf(sent, cursor);
        if (sat >= 0) cursor = sat;
        units.push({ text: sent, start: cursor, heading });
        cursor += sent.length;
      }
    }
  }
  if (!units.length) units.push({ text: src, start: 0, heading: null });

  // Pack units into chunks, with character overlap between neighbours.
  const out = [];
  let buf = [];
  let bufLen = 0;
  let bufStart = units[0].start;
  let bufHeading = units[0].heading;

  const flush = () => {
    if (!buf.length) return;
    let body = buf.join('\n').trim();
    if (body.length > HARD_MAX * 1.6) body = body.slice(0, HARD_MAX * 1.6);
    out.push({ i: out.length, text: body, heading: bufHeading, start: bufStart });
    // Keep a tail of the chunk as overlap for the next one.
    let tailLen = 0;
    const tail = [];
    for (let k = buf.length - 1; k >= 0 && tailLen < overlap; k--) {
      tail.unshift(buf[k]);
      tailLen += buf[k].length + 1;
    }
    buf = tail;
    bufLen = tailLen;
    bufStart = out[out.length - 1].start + Math.max(0, body.length - tailLen);
  };

  for (const u of units) {
    if (bufLen && bufLen + u.text.length + 1 > target) flush();
    if (!buf.length) { bufStart = u.start; bufHeading = u.heading; }
    buf.push(u.text);
    bufLen += u.text.length + 1;
    if (bufLen > HARD_MAX) flush();
  }
  flush();

  if (o.prefix) {
    for (const c of out) c.text = (c.heading ? c.heading + ' — ' : '') + c.text;
  } else {
    for (const c of out) if (c.heading) c.text = c.heading + ' — ' + c.text;
  }

  return out.filter((c) => c.text.replace(/\s/g, '').length > 20);
}

/** Rough "what is this source about" summary without an AI: top frequent phrases. */
function keyphrases(text, limit) {
  const words = String(text || '').toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
  // General English only. Trading vocabulary (risk, stop, trend, level, entry…)
  // is exactly what we want to surface, so it must NOT be filtered out.
  const STOP = new Set(('a an the and or but if then else for with without from into onto over under above below about against ' +
    'that this these those there here where when while which who whom whose what why how all any both each few many much more most ' +
    'other others some such no nor not only own same so than too very can could should would will shall may might must ' +
    'i you he she it we they me him her us them my your his its our their mine yours ours theirs ' +
    'am is are was were be been being have has had having do does did doing ' +
    'as at by of to in on up out off down again once now also just even still already always never often sometimes usually ' +
    'because since until unless although though however therefore thus hence moreover furthermore ' +
    'one two three four five six seven eight nine ten first second third new old ' +
    'thing things way ways lot lots bit bits make made making take takes taking get gets got give gives given put puts use uses used using ' +
    'see sees saw say says said know knows known think thinks thought want wants need needs go goes going come comes coming ' +
    'let lets keep keeps kept try tries tried look looks looked find finds found tell tells told ask asks asked ' +
    'dont doesnot isnot arenot wasnot cannot wont youre theyre its').split(/\s+/));
  const freq = new Map();
  for (const w of words) {
    if (STOP.has(w) || w.length < 3) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  // Bigrams catch "risk management", "support level", "moving average".
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i], b = words[i + 1];
    if (STOP.has(a) || STOP.has(b) || a.length < 3 || b.length < 3) continue;
    if (STOP.has(a + ' ' + b)) continue;
    const key = a + ' ' + b;
    freq.set(key, (freq.get(key) || 0) + 2);
  }
  return Array.from(freq.entries())
    .sort((x, y) => y[1] - x[1])
    .slice(0, limit || 12)
    .map(([k]) => k);
}

const __exports = { chunk, splitSentences, keyphrases, TARGET, OVERLAP };
// Works in Node (require) and in the browser/Electron renderer (<script> tag).
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
if (typeof globalThis !== 'undefined') { globalThis.TCEngine = globalThis.TCEngine || {}; globalThis.TCEngine.chunk = __exports; }
