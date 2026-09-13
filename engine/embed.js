'use strict';
/* embed.js — dependency-free text embeddings.
 *
 * A deterministic feature-hashing ("hashing trick") vectoriser: tokens plus
 * bigrams are hashed into a fixed-width vector with sublinear term weighting,
 * then L2-normalised. No API key, no model download, works fully offline, and
 * it is genuinely useful for terminology-heavy domains like trading because
 * similar vocabulary lands in similar directions. Pair it with BM25 (bm25.js)
 * in kb.js and retrieval quality is solid for a personal knowledge base.
 *
 * If you later want semantic embeddings from a provider, implement
 * `remoteEmbedder` and pass it to kb.js — the interface is the same.
 */

const DIM = Number(process.env.COMPANION_EMBED_DIM || 256);
const MIN_TAG_SCORE = 5;

function tokenize(text) {
  const raw = String(text || '').toLowerCase();
  const words = raw.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
  const tokens = [];
  for (const w of words) {
    if (w.length === 1) continue;
    tokens.push(w);
  }
  return tokens;
}

/** FNV-1a 32-bit — fast, stable across runs and platforms. */
function hash32(str, seed) {
  let h = (seed === undefined ? 0x811c9dc5 : seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * @param {string} text
 * @returns {number[]} dense, L2-normalised vector of length DIM
 */
function embed(text) {
  const tokens = tokenize(text);
  const counts = new Map();

  for (const t of tokens) {
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const bi = tokens[i] + '_' + tokens[i + 1];
    counts.set(bi, (counts.get(bi) || 0) + 1);
  }
  // Character trigrams of rare-ish words add morphological signal (trend/trending).
  for (const t of tokens) {
    if (t.length >= 6) {
      counts.set('~' + t.slice(0, 5), (counts.get('~' + t.slice(0, 5)) || 0) + 1);
      counts.set('~' + t.slice(-5), (counts.get('~' + t.slice(-5)) || 0) + 1);
    }
  }

  const vec = new Float64Array(DIM);
  for (const [term, n] of counts) {
    if (n < 1) continue;
    const h = hash32(term);
    const idx = h % DIM;
    const sign = ((h >>> 16) & 1) ? 1 : -1; // signed hashing reduces collision bias
    const w = 1 + Math.log(n);
    vec[idx] += sign * w;
  }

  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  const out = new Array(DIM);
  if (!norm) { for (let i = 0; i < DIM; i++) out[i] = 0; return out; }
  for (let i = 0; i < DIM; i++) out[i] = Math.round((vec[i] / norm) * 10000) / 10000;
  return out;
}

function embedMany(texts) { return (texts || []).map(embed); }

/** Cosine similarity of two L2-normalised vectors. */
function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/**
 * Cheap, honest topic tagger used when no AI brain is connected.
 * @returns {Array<{tag:string, score:number}>}
 */
function topicTags(text) {
  const lower = String(text || '').toLowerCase();
  const TAGS = {
    'risk management': ['risk', 'stop loss', 'stop-loss', 'position size', 'sizing', 'risk of ruin', 'drawdown', '1% rule', 'capital preservation'],
    'price action': ['price action', 'candle', 'candlestick', 'wick', 'pin bar', 'engulfing', 'inside bar', 'doji', 'hammer'],
    'support & resistance': ['support', 'resistance', 'supply zone', 'demand zone', 'level', 'range', 'consolidation'],
    'trend trading': ['trend', 'higher high', 'higher low', 'lower low', 'lower high', 'uptrend', 'downtrend', 'trendline', 'pullback'],
    'breakouts': ['breakout', 'break out', 'breakdown', 'expansion', 'squeeze', 'volatility contraction'],
    'indicators': ['rsi', 'macd', 'moving average', 'ema', 'sma', 'bollinger', 'vwap', 'stochastic', 'atr', 'fibonacci', 'fib'],
    'chart patterns': ['head and shoulders', 'double top', 'double bottom', 'triangle', 'wedge', 'flag', 'pennant', 'cup and handle', 'ascending', 'descending'],
    'smart money / ICT': ['order block', 'liquidity', 'fair value gap', 'fvg', 'imbalance', 'sweep', 'mitigation', 'bos', 'choch', 'smart money', 'institutional'],
    'volume': ['volume', 'obv', 'volume profile', 'delta', 'cumulative', 'climax'],
    'psychology': ['psychology', 'emotion', 'fear', 'greed', 'discipline', 'fomo', 'revenge', 'patience', 'mindset', 'tilt'],
    'trading plan': ['trading plan', 'journal', 'checklist', 'rules', 'routine', 'process', 'backtest', 'backtesting', ' expectancy'],
    'options & derivatives': ['option', 'call', 'put', 'futures', 'perpetual', 'funding rate', 'leverage', 'margin', 'swap'],
    'fundamentals / macro': ['earnings', 'inflation', 'interest rate', 'fed', 'cpi', 'gdp', 'nfp', 'news', 'economic', 'valuation', 'p/e'],
    'crypto specifics': ['bitcoin', 'btc', 'ethereum', 'eth', 'altcoin', 'on-chain', 'exchange', 'wallet', 'defi', 'token'],
    'forex specifics': ['forex', 'pip', 'pips', 'currency pair', 'eur/usd', 'gbp', 'session', 'london open', 'new york', 'carry trade'],
    'stocks specifics': ['stock', 'shares', 'equity', 'dividend', 'sector', 'earnings report', 'float', 'market cap'],
    'scalping': ['scalp', 'scalping', '1 minute', '5 minute', 'order flow', 'level 2'],
    'swing trading': ['swing', 'multi-day', 'daily chart', '4 hour', 'position trading', 'overnight']
  };
  const out = [];
  for (const tag of Object.keys(TAGS)) {
    let score = 0;
    let distinct = 0;
    for (const kw of TAGS[tag]) {
      let idx = lower.indexOf(kw);
      let hits = 0;
      while (idx >= 0 && hits < 20) { hits++; idx = lower.indexOf(kw, idx + kw.length); }
      if (hits) { score += hits * (kw.includes(' ') ? 3 : 1); distinct++; }
    }
    // Require real evidence: one stray word ("margin", "exchange") must not tag a
    // whole document. Two distinct keywords, or one used repeatedly, is the bar.
    if (score >= MIN_TAG_SCORE || (distinct >= 2 && score >= 4)) out.push({ tag, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

const __exports = { embed, embedMany, cosine, tokenize, hash32, topicTags, DIM, MIN_TAG_SCORE };
// Works in Node (require) and in the browser/Electron renderer (<script> tag).
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
if (typeof globalThis !== 'undefined') { globalThis.TCEngine = globalThis.TCEngine || {}; globalThis.TCEngine.embed = __exports; }
