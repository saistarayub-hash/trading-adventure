'use strict';
/* distill.js — the "learning" step. Turns a raw source (video transcript,
 * article, pasted notes) into structured, reusable knowledge:
 *   • strategy cards  (setup / entry / invalidation / target / risk / checklist)
 *   • a plain-English summary + key takeaways
 *   • quiz questions so the companion can test you on what you fed it
 *   • a lesson in the existing Professor Fox format (publishable to lessons.json)
 *
 * Pure functions only: prompt builders + strict parsers. The AI call itself is
 * made by whoever has the key (renderer/Electron/server), so keys stay local. */

const DISTILL_SYSTEM =
  'You are the learning engine of a trading companion app. You read material the trader fed you ' +
  '(video transcripts, articles, notes) and convert it into a strict, reusable playbook.\n' +
  'Rules:\n' +
  '- Extract ONLY what the material actually teaches. Never invent rules the source does not contain.\n' +
  '- Ignore self-promotion, affiliate links, course pitches, sponsor reads, greetings and filler.\n' +
  '- Be concrete: real conditions, real invalidation, real risk. Vague cards ("buy the dip") are useless.\n' +
  '- If the material contradicts sound risk management, still record what it says but flag it in "warnings".\n' +
  '- Write for a BEGINNER: plain words, short sentences, no unexplained jargon.\n' +
  '- If the source teaches nothing tradeable, return an empty "cards" array.\n' +
  '- This is education, not financial advice.\n' +
  'Return ONLY one JSON object, no markdown fences:\n' +
  '{\n' +
  '  "title": "short title for this material",\n' +
  '  "author": "who teaches it, or null",\n' +
  '  "summary": "3-4 sentence plain-English summary of what this material teaches",\n' +
  '  "takeaways": ["5-8 single-sentence lessons"],\n' +
  '  "terms": [{"term":"...","meaning":"one beginner sentence"}],\n' +
  '  "cards": [{\n' +
  '     "title": "name of the setup/strategy",\n' +
  '     "tags": ["from: price action|support & resistance|trend trading|breakouts|chart patterns|indicators|volume|smart money / ICT|risk management|psychology|trading plan"],\n' +
  '     "level": 1,\n' +
  '     "setup": "the exact conditions that must be true, step by step",\n' +
  '     "entry": "precise trigger",\n' +
  '     "invalidation": "where the idea is wrong / stop logic",\n' +
  '     "target": "where profit is taken and why",\n' +
  '     "risk": "position sizing and the specific danger of this setup",\n' +
  '     "checklist": ["4-6 yes/no checks before entering"],\n' +
  '     "mistakes": ["2-4 ways beginners mess this up"],\n' +
  '     "markets": ["crypto|stocks|forex|any"],\n' +
  '     "quote": "one short supporting quote from the source, or null"\n' +
  '  }],\n' +
  '  "warnings": ["anything risky, over-hyped or contradictory in the source"],\n' +
  '  "quality": 0.0\n' +
  '}';

const QUIZ_SYSTEM =
  'You write short multiple-choice questions that test whether a beginner trader truly understood some material. ' +
  'Questions must be scenario-based where possible (describe a small chart or situation), not vocabulary recall. ' +
  'Exactly one option is correct and the distractors must be plausible beginner mistakes. ' +
  'Return ONLY JSON, no markdown fences: {"questions":[{"q":"...","options":["a","b","c","d"],"answer":0,"why":"one sentence"}]}';

/* -------------------------------- excerpts -------------------------------- */

/**
 * Choose the most informative slice of a long source to send to the model.
 * Prefers paragraphs dense in trading vocabulary, keeps order, and always keeps
 * the head of the document (where the topic is introduced).
 * @param {string} text
 * @param {number} [budget] characters
 */
function excerpt(text, budget) {
  const max = budget || 9000;
  const src = String(text || '');
  if (src.length <= max) return src;

  const paras = src.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 40);
  if (!paras.length) return src.slice(0, max);

  const scored = paras.map((p, idx) => ({ p, idx, s: density(p) + (idx < 3 ? 3 : 0) }));

  // Select by usefulness until the budget is full, THEN restore document order so
  // the model reads a coherent narrative instead of shuffled fragments.
  const ranked = scored.slice().sort((a, b) => (b.s - a.s) || (a.idx - b.idx));
  const chosen = [];
  let len = 0;
  for (const item of ranked) {
    if (chosen.length && len + item.p.length > max) continue;
    chosen.push(item);
    len += item.p.length + 2;
    if (len >= max) break;
  }
  chosen.sort((a, b) => a.idx - b.idx);
  const out = chosen.map((c) => c.p);
  if (!out.length) out.push(src.slice(0, max));
  return out.join('\n\n') + '\n\n[excerpt — the full source is stored in the knowledge base]';
}

const DENSE_WORDS = ['entry', 'stop', 'target', 'risk', 'setup', 'trend', 'breakout', 'pullback', 'support',
  'resistance', 'volume', 'candle', 'timeframe', 'position', 'size', 'leverage', 'order', 'liquidity',
  'supply', 'demand', 'pattern', 'indicator', 'moving average', 'rsi', 'drawdown', 'win rate', 'reward',
  'buy', 'sell', 'long', 'short', 'retest', 'level', 'structure', 'invalid', 'take profit', 'trailing'];

function density(p) {
  const lower = ' ' + String(p).toLowerCase() + ' ';
  let n = 0;
  for (const w of DENSE_WORDS) {
    let at = lower.indexOf(w);
    let hits = 0;
    while (at >= 0 && hits < 8) { hits++; at = lower.indexOf(w, at + w.length); }
    // Multi-word terms carry more signal than single words.
    n += hits * (w.includes(' ') ? 3 : 1);
  }
  return n;
}

/* --------------------------------- prompts -------------------------------- */

function buildDistillPrompt(source, opts) {
  const o = opts || {};
  const head = [
    'SOURCE TYPE: ' + (source.kind || 'text'),
    source.title ? 'TITLE: ' + source.title : '',
    source.author ? 'AUTHOR/CHANNEL: ' + source.author : '',
    source.url ? 'LINK: ' + source.url : '',
    source.meta && source.meta.durationSeconds ? 'LENGTH: ' + Math.round(source.meta.durationSeconds / 60) + ' minutes of video' : '',
    source.meta && source.meta.chapters && source.meta.chapters.length ? 'CHAPTERS: ' + source.meta.chapters.slice(0, 20).join(' | ') : ''
  ].filter(Boolean).join('\n');

  const body = excerpt(source.text || '', o.chars || 9000);
  const extra = o.focus ? '\n\nTHE TRADER SPECIFICALLY WANTS TO LEARN: ' + o.focus : '';

  return head + '\n\nCONTENT:\n' + body + extra +
    '\n\nNow distil this into the JSON object described in your instructions.';
}

function buildQuizPrompt(cardOrSource, n) {
  const want = Math.max(2, Math.min(6, n || 3));
  let material = '';
  if (cardOrSource && cardOrSource.setup) {
    material = 'STRATEGY CARD: ' + cardOrSource.title +
      '\nSetup: ' + cardOrSource.setup +
      '\nEntry: ' + cardOrSource.entry +
      '\nInvalidation: ' + cardOrSource.invalidation +
      '\nTarget: ' + cardOrSource.target +
      '\nRisk: ' + cardOrSource.risk +
      (cardOrSource.checklist ? '\nChecklist: ' + cardOrSource.checklist.join('; ') : '');
  } else {
    material = 'MATERIAL:\n' + excerpt((cardOrSource && cardOrSource.text) || String(cardOrSource || ''), 6000);
  }
  return 'Write exactly ' + want + ' questions about this material.\n\n' + material +
    '\n\nReturn the JSON object only.';
}

function buildSummaryPrompt(source) {
  return 'Summarise this trading material for a beginner in 6 bullet points, then list the 5 most important terms it uses with one-line meanings.\n\n' +
    excerpt(source.text || '', 5000) +
    '\n\nReturn ONLY JSON: {"summary":"...","takeaways":["..."],"terms":[{"term":"...","meaning":"..."}]}';
}

/* --------------------------------- parsers -------------------------------- */

const VALID_TAGS = ['price action', 'support & resistance', 'trend trading', 'breakouts', 'chart patterns',
  'indicators', 'volume', 'smart money / ICT', 'risk management', 'psychology', 'trading plan'];

function extractJson(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(t); } catch {}
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = t.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch {}
    try {
      return JSON.parse(candidate
        .replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/\n{2,}/g, '\n'));
    } catch {}
  }
  return null;
}

function str(x, max) {
  if (x == null) return '';
  return String(x).replace(/\s+/g, ' ').trim().slice(0, max || 600);
}

function arr(x, max, itemMax) {
  if (!x) return [];
  const list = Array.isArray(x) ? x : String(x).split(/\n(?=[•\-*\d])|;/);
  return list.map((s) => str(s, itemMax || 300)).filter(Boolean).slice(0, max || 8);
}

function cleanTags(tags) {
  const out = [];
  for (const t of arr(tags, 6, 40)) {
    const low = t.toLowerCase();
    const hit = VALID_TAGS.find((v) => v === low || v.startsWith(low) || low.startsWith(v));
    out.push(hit || low);
  }
  return Array.from(new Set(out)).slice(0, 6);
}

/** Parse the distillation result into validated cards + summary. */
function parseDistill(raw) {
  const j = extractJson(raw);
  if (!j || typeof j !== 'object') {
    return { ok: false, error: 'The brain returned something I could not read as JSON. Try again or use a stronger model.' };
  }

  const cards = (Array.isArray(j.cards) ? j.cards : []).map((c) => ({
    title: str(c && c.title, 90) || 'Untitled setup',
    tags: cleanTags(c && c.tags),
    level: [1, 2, 3, 4].includes(Number(c && c.level)) ? Number(c.level) : 2,
    setup: str(c && c.setup, 900),
    entry: str(c && c.entry, 400),
    invalidation: str(c && c.invalidation, 400),
    target: str(c && c.target, 400),
    risk: str(c && c.risk, 500),
    checklist: arr(c && c.checklist, 8, 160),
    mistakes: arr(c && c.mistakes, 6, 200),
    markets: arr(c && c.markets, 5, 24).map((m) => m.toLowerCase()),
    quote: str(c && c.quote && c.quote !== 'null' ? c.quote : '', 300) || null
  })).filter((c) => c.setup || c.entry || c.risk).slice(0, 8);

  const terms = (Array.isArray(j.terms) ? j.terms : [])
    .map((t) => ({ term: str(t && t.term, 40), meaning: str(t && t.meaning, 220) }))
    .filter((t) => t.term && t.meaning).slice(0, 20);

  return {
    ok: true,
    title: str(j.title, 140),
    author: str(j.author && j.author !== 'null' ? j.author : '', 80) || null,
    summary: str(j.summary, 900),
    takeaways: arr(j.takeaways, 10, 260),
    terms,
    cards,
    warnings: arr(j.warnings, 6, 260),
    quality: clamp01(j.quality)
  };
}

function parseQuiz(raw) {
  const j = extractJson(raw);
  const list = j && Array.isArray(j.questions) ? j.questions : (Array.isArray(j) ? j : null);
  if (!list) return { ok: false, error: 'Could not read the questions. Try again.' };
  const questions = list.map((q) => {
    const options = Array.isArray(q && q.options) ? q.options.map((o) => str(o, 160)).filter(Boolean) : [];
    const answer = Number(q && q.answer);
    if (!str(q && q.q) || options.length !== 4 || !(answer >= 0 && answer <= 3)) return null;
    return { q: str(q.q, 300), options, answer, why: str(q.why, 300) || 'Re-read the rule in your playbook card.' };
  }).filter(Boolean).slice(0, 8);
  if (!questions.length) return { ok: false, error: 'The questions did not match the required 4-option format.' };
  return { ok: true, questions };
}

function parseSummary(raw) {
  const j = extractJson(raw);
  if (!j) return { ok: false, error: 'Could not read the summary.' };
  return {
    ok: true,
    summary: str(j.summary, 900),
    takeaways: arr(j.takeaways, 10, 260),
    terms: (Array.isArray(j.terms) ? j.terms : []).map((t) => ({ term: str(t && t.term, 40), meaning: str(t && t.meaning, 220) })).filter((t) => t.term)
  };
}

function clamp01(x) {
  const n = Number(x);
  if (!isFinite(n)) return 0.5;
  return Math.round(Math.max(0, Math.min(1, n > 1 ? n / 100 : n)) * 100) / 100;
}

/** Turn a distilled card into a lesson the main Professor Fox app understands. */
function cardToLesson(card, source, idHint) {
  const slug = String(card.title || 'setup').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 34) || 'setup';
  const questions = Array.isArray(card.questions) && card.questions.length >= 3 ? card.questions : defaultQuestions(card);
  const sections = [
    { h: 'The setup', b: card.setup || '-', ex: card.quote || null },
    { h: 'Entry trigger', b: card.entry || '-', ex: null },
    { h: 'When you are wrong', b: card.invalidation || '-', ex: null },
    { h: 'Where you take profit', b: card.target || '-', ex: null },
    { h: 'Risk — read this twice', b: card.risk || '-', ex: null },
    card.checklist && card.checklist.length ? { h: 'Pre-trade checklist', b: card.checklist.map((c, i) => (i + 1) + '. ' + c).join('\n'), ex: null } : null,
    card.mistakes && card.mistakes.length ? { h: 'How beginners mess this up', b: card.mistakes.map((m) => '• ' + m).join('\n'), ex: null } : null
  ].filter(Boolean);

  return {
    id: 'fed_' + (idHint || slug),
    title: '🎯 ' + String(card.title || 'Strategy').slice(0, 70),
    emoji: '🎯',
    minutes: '4 min read',
    easy: str(card.setup, 190) || 'A setup from material you fed the companion.',
    tip: str(card.risk, 290) || 'Never risk more than 1% of your account on one trade.',
    sections,
    questions,
    source: source ? (source.title || source.url || 'Your library') : 'Your library'
  };
}

/** Guaranteed-valid questions even when the model produced none. */
function defaultQuestions(card) {
  const title = card.title || 'this setup';
  return [
    {
      q: 'Where does the "' + title + '" idea become wrong?',
      options: [card.invalidation || 'At your invalidation level', 'Wherever you feel like', 'Never', 'After 10 minutes'],
      answer: 0,
      why: 'Every setup has a point where the reason for entering no longer exists. That is where the stop goes.'
    },
    {
      q: 'Before entering "' + title + '", what should you decide first?',
      options: ['Your risk and stop location', 'Your profit target in dollars', 'Which colour candle you like', 'How much leverage to use'],
      answer: 0,
      why: 'Size follows from the stop distance and your 1% risk rule — never the other way around.'
    },
    {
      q: 'You take this setup and it goes against you immediately. What do you do?',
      options: ['Exit at the pre-defined invalidation', 'Move the stop further away', 'Add to the position', 'Wait until it comes back'],
      answer: 0,
      why: 'The invalidation was decided while you were calm. That version of you is smarter than the current one.'
    }
  ];
}

const __exports = {
  DISTILL_SYSTEM, QUIZ_SYSTEM, buildDistillPrompt, buildQuizPrompt, buildSummaryPrompt,
  parseDistill, parseQuiz, parseSummary, cardToLesson, defaultQuestions, excerpt, extractJson, VALID_TAGS, clamp01
};
// Works in Node (require) and in the browser/Electron renderer (<script> tag).
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
if (typeof globalThis !== 'undefined') { globalThis.TCEngine = globalThis.TCEngine || {}; globalThis.TCEngine.distill = __exports; }
