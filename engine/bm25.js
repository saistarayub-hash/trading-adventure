'use strict';
/* bm25.js — classic Okapi BM25 lexical scoring, dependency-free.
 * Lexical search catches exact trading jargon ("order block", "funding rate")
 * that vector similarity alone can blur; kb.js blends the two. */

const { tokenize } = (typeof require === 'function' && typeof module !== 'undefined')
  ? require('./embed')
  : ((globalThis.TCEngine && globalThis.TCEngine.embed) || {});

const K1 = 1.35;
const B = 0.72;

function build(chunks) {
  const docs = [];
  const df = new Map();
  let totalLen = 0;

  for (const c of chunks || []) {
    const toks = tokenize(c.text);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    totalLen += toks.length;
    docs.push({ ref: c, tf, len: toks.length });
  }

  return {
    docs,
    df,
    N: docs.length,
    avgdl: docs.length ? totalLen / docs.length : 0
  };
}

function idf(index, term) {
  const n = index.df.get(term) || 0;
  return Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
}

/**
 * @param {object} index from build()
 * @param {string} query
 * @returns {Map<string, number>} ref.id -> score
 */
function score(index, query) {
  const qTerms = Array.from(new Set(tokenize(query)));
  const scores = new Map();
  if (!qTerms.length || !index.docs.length) return scores;

  for (const doc of index.docs) {
    let s = 0;
    for (const t of qTerms) {
      const f = doc.tf.get(t);
      if (!f) continue;
      const num = f * (K1 + 1);
      const den = f + K1 * (1 - B + B * (doc.len / (index.avgdl || 1)));
      s += idf(index, t) * (num / den);
    }
    if (s > 0) scores.set(doc.ref.id, s);
  }
  return scores;
}

/** Highlight the matched query words inside a snippet. */
function highlight(text, query) {
  const terms = Array.from(new Set(tokenize(query))).filter((t) => t.length > 2);
  if (!terms.length) return text;
  const re = new RegExp('\\b(' + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return String(text).replace(re, '⟦$1⟧');
}

const __exports = { build, score, idf, highlight, K1, B };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
if (typeof globalThis !== 'undefined') { globalThis.TCEngine = globalThis.TCEngine || {}; globalThis.TCEngine.bm25 = __exports; }
