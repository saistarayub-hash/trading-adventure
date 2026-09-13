'use strict';
/* kb.js — the companion's knowledge base.
 *
 * Everything the trader feeds it (videos, links, pasted transcripts, files)
 * becomes: a source record → text chunks → local embeddings + a BM25 index.
 * Retrieval is hybrid (vector cosine + BM25, blended and source-diverse) so
 * coaching answers can quote the trader's own library with citations.
 *
 * Storage is one JSON file, written atomically. Zero dependencies. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { chunk: chunkText, keyphrases } = require('./chunk');
const { embed, cosine, topicTags } = require('./embed');
const bm25 = require('./bm25');
const { normalise, wordCount } = require('./text');

const VERSION = 3;
const MAX_SOURCES = Number(process.env.COMPANION_MAX_SOURCES || 400);
const MAX_CHUNKS_PER_SOURCE = Number(process.env.COMPANION_MAX_CHUNKS || 1200);
const VEC_BLEND = 0.46; // weight of cosine vs bm25 in the hybrid score

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

class KnowledgeBase {
  /** @param {string|null} file path to persist to (null = in-memory only) */
  constructor(file) {
    this.file = file || null;
    this.db = { version: VERSION, sources: [], chunks: [], cards: [], journal: [], skills: {} };
    this._index = null;
    this._dirtyIndex = true;
    this._saveTimer = null;
    if (this.file) this.load();
  }

  /* ------------------------------ persistence ----------------------------- */

  load() {
    if (!this.file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object') {
        this.db = {
          version: VERSION,
          sources: Array.isArray(raw.sources) ? raw.sources : [],
          chunks: Array.isArray(raw.chunks) ? raw.chunks : [],
          cards: Array.isArray(raw.cards) ? raw.cards : [],
          journal: Array.isArray(raw.journal) ? raw.journal : [],
          skills: raw.skills && typeof raw.skills === 'object' ? raw.skills : {}
        };
      }
    } catch { /* first run — start empty */ }
    this._dirtyIndex = true;
  }

  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.db));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      this.lastSaveError = e.message;
    }
  }

  /** Debounced save so a big ingest doesn't thrash the disk. */
  saveSoon(ms) {
    if (!this.file) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), ms == null ? 250 : ms);
    if (this._saveTimer.unref) this._saveTimer.unref();
  }

  /* -------------------------------- sources ------------------------------- */

  /**
   * @param {{kind:string, url?:string, title?:string, text:string, meta?:object, note?:string, tags?:string[]}} input
   * @returns {{ok:boolean, source?:object, error?:string, replaced?:boolean}}
   */
  addSource(input) {
    const text = normalise(input && input.text);
    if (!text || text.length < 40) {
      return { ok: false, error: 'There was almost no text to learn from. If it is a video, paste the transcript manually.' };
    }

    const url = (input.url || '').trim();
    const title = (input.title || '').trim().slice(0, 220) || url || 'Pasted note';

    // Re-ingesting the same link updates it instead of duplicating.
    let replaced = false;
    if (url) {
      const existing = this.db.sources.find((s) => s.url === url);
      if (existing) { this.removeSource(existing.id, true); replaced = true; }
    }

    if (this.db.sources.length >= MAX_SOURCES) {
      return { ok: false, error: 'Knowledge base is full (' + MAX_SOURCES + ' sources). Remove something old first.' };
    }

    const tags = Array.from(new Set([].concat(input.tags || [], topicTags(text).slice(0, 6).map((t) => t.tag)))).slice(0, 14);
    const phrases = keyphrases(text, 14);

    const source = {
      id: uid('src'),
      kind: input.kind || (url ? 'article' : 'text'),
      url,
      title,
      author: (input.meta && (input.meta.author || input.meta.channel)) || '',
      addedAt: Date.now(),
      chars: text.length,
      words: wordCount(text),
      minutes: Math.max(1, Math.round(wordCount(text) / 220)),
      tags,
      phrases,
      note: (input.note || '').slice(0, 800),
      transcript: !!(input.meta && input.meta.transcript),
      durationSeconds: (input.meta && input.meta.durationSeconds) || 0,
      text // kept so we can re-chunk / re-embed after settings change
    };

    const pieces = chunkText(text, {}).slice(0, MAX_CHUNKS_PER_SOURCE);
    for (const p of pieces) {
      this.db.chunks.push({
        id: source.id + '#' + p.i,
        sid: source.id,
        i: p.i,
        heading: p.heading || null,
        text: p.text.slice(0, 2400),
        vec: embed(p.heading ? p.heading + '\n' + p.text : p.text)
      });
    }
    source.chunks = pieces.length;

    this.db.sources.unshift(source);
    this._dirtyIndex = true;
    this.saveSoon();
    return { ok: true, source: publicSource(source), chunks: pieces.length, replaced };
  }

  removeSource(id, silent) {
    const i = this.db.sources.findIndex((s) => s.id === id);
    if (i < 0) return { ok: false, error: 'Source not found.' };
    const [gone] = this.db.sources.splice(i, 1);
    this.db.chunks = this.db.chunks.filter((c) => c.sid !== id);
    for (const card of this.db.cards) if (card.sid === id) card.orphaned = true;
    this._dirtyIndex = true;
    if (!silent) this.saveSoon();
    return { ok: true, title: gone.title };
  }

  getSource(id) { return this.db.sources.find((s) => s.id === id) || null; }

  /** Everything except the heavy raw text, for the UI list. */
  listSources() { return this.db.sources.map(publicSource); }

  /* -------------------------------- search -------------------------------- */

  _ensureIndex() {
    if (this._dirtyIndex || !this._index) {
      this._index = bm25.build(this.db.chunks);
      this._dirtyIndex = false;
    }
    return this._index;
  }

  /**
   * Hybrid search: BM25 + cosine, min-max normalised, blended, then diversified
   * so one huge source can't crowd out the rest.
   * @param {string} query
   * @param {{k?:number, perSource?:number, minScore?:number}} [opts]
   */
  search(query, opts) {
    const o = opts || {};
    const k = Math.max(1, Math.min(40, o.k || 6));
    const perSource = o.perSource || Math.max(2, Math.ceil(k / 2));
    if (!this.db.chunks.length) return [];

    const q = String(query || '').trim();
    if (!q) return [];
    const qVec = embed(q);
    const index = this._ensureIndex();
    const lex = bm25.score(index, q);

    const rows = [];
    for (const c of this.db.chunks) {
      const cos = cosine(qVec, c.vec);
      const b = lex.get(c.id) || 0;
      if (cos <= 0.02 && b <= 0) continue;
      rows.push({ c, cos, b });
    }
    if (!rows.length) return [];

    const maxB = rows.reduce((m, r) => Math.max(m, r.b), 0) || 1;
    const maxC = rows.reduce((m, r) => Math.max(m, r.cos), 0) || 1;

    for (const r of rows) {
      const nb = r.b / maxB;
      const nc = Math.max(0, r.cos) / maxC;
      r.score = VEC_BLEND * nc + (1 - VEC_BLEND) * nb;
      // Small boost when the heading matches too — headings carry the topic.
      if (r.c.heading && q.toLowerCase().includes(r.c.heading.toLowerCase().slice(0, 18))) r.score *= 1.08;
    }
    rows.sort((a, b) => b.score - a.score);

    const seen = new Map();
    const out = [];
    for (const r of rows) {
      const n = seen.get(r.c.sid) || 0;
      if (n >= perSource) continue;
      seen.set(r.c.sid, n + 1);
      const src = this.getSource(r.c.sid);
      out.push({
        id: r.c.id,
        sid: r.c.sid,
        i: r.c.i,
        heading: r.c.heading,
        text: r.c.text,
        score: Math.round(r.score * 1000) / 1000,
        cosine: Math.round(r.cos * 1000) / 1000,
        lexical: Math.round(r.b * 100) / 100,
        snippet: bm25.highlight(snippetAround(r.c.text, q), q),
        source: src ? { id: src.id, title: src.title, url: src.url, kind: src.kind, author: src.author } : null
      });
      if (out.length >= k) break;
    }
    const min = o.minScore || 0;
    return min ? out.filter((r) => r.score >= min) : out;
  }

  /** Build the grounded context block the AI is allowed to use. */
  context(query, opts) {
    const hits = this.search(query, Object.assign({ k: (opts && opts.k) || 5 }, opts || {}));
    if (!hits.length) return { hits: [], block: '', chars: 0 };
    const budget = (opts && opts.chars) || 5200;
    const parts = [];
    let used = 0;
    hits.forEach((h, n) => {
      const body = '[' + (n + 1) + '] ' + (h.source ? h.source.title : 'Source') + (h.heading ? ' › ' + h.heading : '') + '\n' + h.text;
      if (used + body.length > budget) return;
      used += body.length;
      parts.push(body);
    });
    return {
      hits: hits.slice(0, parts.length),
      block: parts.join('\n\n---\n\n'),
      chars: used
    };
  }

  /* ---------------------------- strategy cards ---------------------------- */

  upsertCard(card) {
    const c = Object.assign({ id: card.id || uid('card'), created: Date.now(), updated: Date.now() }, card);
    const i = this.db.cards.findIndex((x) => x.id === c.id);
    if (i >= 0) this.db.cards[i] = Object.assign({}, this.db.cards[i], c);
    else this.db.cards.unshift(c);
    this.saveSoon();
    return c;
  }

  removeCard(id) {
    const i = this.db.cards.findIndex((c) => c.id === id);
    if (i < 0) return { ok: false };
    this.db.cards.splice(i, 1);
    this.saveSoon();
    return { ok: true };
  }

  listCards() { return this.db.cards.slice(); }

  /** Cards as searchable pseudo-chunks so coaching can quote a full playbook. */
  cardContext(limit) {
    const cards = this.db.cards.slice(0, limit || 4);
    return cards.map((c) =>
      'PLAYBOOK "' + c.title + '"\nSetup: ' + (c.setup || '-') + '\nEntry: ' + (c.entry || '-') +
      '\nInvalidation: ' + (c.invalidation || '-') + '\nTarget: ' + (c.target || '-') +
      '\nRisk rule: ' + (c.risk || '-') +
      (c.checklist && c.checklist.length ? '\nChecklist: ' + c.checklist.join('; ') : '')
    ).join('\n\n');
  }

  /* -------------------------------- journal ------------------------------- */

  addJournal(entry) {
    const e = {
      id: uid('j'),
      ts: Date.now(),
      kind: entry.kind || 'note',
      text: String(entry.text || '').slice(0, 4000),
      tags: entry.tags || [],
      sourceId: entry.sourceId || null,
      cardId: entry.cardId || null,
      outcome: entry.outcome || null
    };
    this.db.journal.unshift(e);
    if (this.db.journal.length > 2000) this.db.journal.length = 2000;
    this.saveSoon();
    return e;
  }

  listJournal(limit) { return this.db.journal.slice(0, limit || 100); }

  removeJournal(id) {
    const i = this.db.journal.findIndex((j) => j.id === id);
    if (i < 0) return { ok: false };
    this.db.journal.splice(i, 1);
    this.saveSoon();
    return { ok: true };
  }

  /* --------------------------------- stats -------------------------------- */

  stats() {
    // Kind markers ('pasted', 'video', a file extension) describe the container,
    // not the topic — keep them out of the topic counts and gap analysis.
    const tags = new Map();
    for (const s of this.db.sources) {
      for (const t of s.tags || []) { if (!KIND_TAGS.has(String(t).toLowerCase())) tags.set(t, (tags.get(t) || 0) + 1); }
    }
    const kinds = {};
    for (const s of this.db.sources) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
    return {
      sources: this.db.sources.length,
      chunks: this.db.chunks.length,
      words: this.db.sources.reduce((n, s) => n + (s.words || 0), 0),
      readingMinutes: this.db.sources.reduce((n, s) => n + (s.minutes || 0), 0),
      cards: this.db.cards.length,
      journalEntries: this.db.journal.length,
      kinds,
      tags: Array.from(tags.entries()).sort((a, b) => b[1] - a[1]).map(([tag, n]) => ({ tag, n })),
      coverageGaps: coverageGaps(tags),
      fileBytes: this.file ? safeSize(this.file) : 0
    };
  }

  /** Full backup, including source text so an export can be re-imported 1:1. */
  exportAll() {
    return JSON.parse(JSON.stringify(this.db));
  }
}

function safeSize(f) { try { return fs.statSync(f).size; } catch { return 0; } }

function publicSource(s) {
  const { text, ...rest } = s;
  return Object.assign({}, rest, { preview: String(s.text || '').slice(0, 260) });
}

function snippetAround(text, query, width) {
  const w = width || 260;
  const lower = String(text || '').toLowerCase();
  const terms = (String(query || '').toLowerCase().match(/[a-z][a-z' -]{2,}/g) || []).sort((a, b) => b.length - a.length);
  for (const t of terms) {
    const at = lower.indexOf(t);
    if (at >= 0) {
      const start = Math.max(0, at - Math.floor(w / 3));
      return (start > 0 ? '…' : '') + text.slice(start, start + w).trim() + (start + w < text.length ? '…' : '');
    }
  }
  return text.slice(0, w).trim() + (text.length > w ? '…' : '');
}

const CORE_TOPICS = ['risk management', 'price action', 'support & resistance', 'trend trading', 'breakouts',
  'chart patterns', 'psychology', 'trading plan'];

const KIND_TAGS = new Set(['pasted', 'video', 'article', 'file', 'pdf', 'text', 'txt', 'md', 'markdown',
  'csv', 'tsv', 'json', 'log', 'srt', 'vtt', 'html', 'htm', 'social']);

function coverageGaps(tags) {
  const have = new Set(tags.keys());
  return CORE_TOPICS.filter((t) => !have.has(t));
}

module.exports = { KnowledgeBase, uid, VERSION, VEC_BLEND, CORE_TOPICS, coverageGaps };
