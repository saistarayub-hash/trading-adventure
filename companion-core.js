'use strict';
/* companion-core.js — the operations layer of the Trading Companion.
 *
 * One implementation, two shells:
 *   • server.js          → server-companion.js wraps this in HTTP routes
 *   • companion/main.js  → the Electron shell wraps this in IPC handlers
 *
 * It owns: the knowledge base (sources/chunks/embeddings), playbook cards,
 * the journal, the skill profile and the settings file. It never calls an AI
 * provider — the renderer does that, so API keys stay on the user's machine. */

const fs = require('fs');
const path = require('path');
const ENGINE = require('./engine');

const KB = ENGINE.KnowledgeBase;
const SKILL_TAGS = ENGINE.curriculum.SKILL_TAGS.concat(['__done']);

const DEFAULT_SETTINGS = {
  intervalMs: 8000,
  sensitivity: 'normal',
  capture: 'screen',
  quality: 0.72,
  maxW: 1100,
  pauseHidden: true,
  riskPercent: 1,
  account: 0,
  dailyCap: 2,
  demoMode: false,
  onTop: true,
  dock: 'right',
  opacity: 100,
  width: 400,
  excludeSelf: true,
  language: 'English'
};

function clampInt(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * @param {{dataDir:string, kbFile?:string, settingsFile?:string, publishLessons?:Function}} opts
 */
function createCore(opts) {
  const o = opts || {};
  const dataDir = o.dataDir || path.join(__dirname, '.data');
  const kbFile = o.kbFile || path.join(dataDir, 'knowledge.json');
  const settingsFile = o.settingsFile || path.join(dataDir, 'settings.json');

  fs.mkdirSync(dataDir, { recursive: true });
  const kb = new KB(kbFile);
  let settings = loadSettings();

  function loadSettings() {
    try {
      const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      return Object.assign({}, DEFAULT_SETTINGS, s || {});
    } catch { return Object.assign({}, DEFAULT_SETTINGS); }
  }

  function persistSettings() {
    try {
      const tmp = settingsFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
      fs.renameSync(tmp, settingsFile);
    } catch {}
  }

  function sanitiseSkills(input) {
    const out = {};
    if (!input || typeof input !== 'object') return out;
    for (const tag of SKILL_TAGS) {
      if (tag === '__done') {
        if (Array.isArray(input.__done)) out.__done = input.__done.map((x) => String(x).slice(0, 40)).slice(0, 80);
        continue;
      }
      const s = input[tag];
      if (!s || typeof s !== 'object') continue;
      out[tag] = {
        exposure: clampInt(s.exposure, 0, 100000),
        correct: clampInt(s.correct, 0, 100000),
        wrong: clampInt(s.wrong, 0, 100000),
        taught: clampInt(s.taught, 0, 100000),
        lastTaught: clampInt(s.lastTaught, 0, Number.MAX_SAFE_INTEGER),
        lastWrong: clampInt(s.lastWrong, 0, Number.MAX_SAFE_INTEGER)
      };
    }
    // Keep any tags the curriculum does not know about (distilled cards add their own).
    for (const k of Object.keys(input)) {
      if (k === '__done' || SKILL_TAGS.includes(k)) continue;
      const s = input[k];
      if (s && typeof s === 'object') {
        out[String(k).slice(0, 60)] = {
          exposure: clampInt(s.exposure, 0, 100000),
          correct: clampInt(s.correct, 0, 100000),
          wrong: clampInt(s.wrong, 0, 100000),
          taught: clampInt(s.taught, 0, 100000),
          lastTaught: clampInt(s.lastTaught, 0, Number.MAX_SAFE_INTEGER),
          lastWrong: clampInt(s.lastWrong, 0, Number.MAX_SAFE_INTEGER)
        };
      }
    }
    return out;
  }

  function sanitiseSettings(input) {
    const s = Object.assign({}, settings);
    if (!input || typeof input !== 'object') return s;
    if (input.intervalMs != null) s.intervalMs = clampInt(input.intervalMs, 3000, 300000);
    if (['calm', 'normal', 'chatty'].includes(input.sensitivity)) s.sensitivity = input.sensitivity;
    if (['screen', 'window'].includes(input.capture)) s.capture = input.capture;
    if (input.quality != null) s.quality = clampNum(input.quality, 0.3, 0.95, 0.72);
    if (input.maxW != null) s.maxW = clampInt(input.maxW, 480, 2400);
    if (typeof input.pauseHidden === 'boolean') s.pauseHidden = input.pauseHidden;
    if (input.riskPercent != null) s.riskPercent = clampNum(input.riskPercent, 0.1, 5, 1);
    if (input.account != null) s.account = clampInt(input.account, 0, 1e12);
    if (input.dailyCap != null) s.dailyCap = clampInt(input.dailyCap, 0, 50);
    if (typeof input.demoMode === 'boolean') s.demoMode = input.demoMode;
    if (typeof input.onTop === 'boolean') s.onTop = input.onTop;
    if (['left', 'right'].includes(input.dock)) s.dock = input.dock;
    if (input.opacity != null) s.opacity = clampInt(input.opacity, 40, 100);
    if (input.width != null) s.width = clampInt(input.width, 320, 900);
    if (typeof input.excludeSelf === 'boolean') s.excludeSelf = input.excludeSelf;
    if (typeof input.language === 'string' && input.language.trim()) s.language = input.language.trim().slice(0, 40);
    return s;
  }

  function statePayload(shell) {
    return {
      ok: true,
      shell: shell || 'core',
      engineVersion: ENGINE.VERSION,
      dataPath: kbFile,
      stats: kb.stats(),
      sources: kb.listSources(),
      cards: kb.listCards(),
      journal: kb.listJournal(120),
      skills: kb.db.skills || {},
      settings
    };
  }

  /* --------------------------------- ops --------------------------------- */

  const core = {
    kb,
    get settings() { return settings; },
    dataDir, kbFile, settingsFile,

    state(shell) { return statePayload(shell); },

    async ingestUrl(url, language) {
      const u = String(url || '').trim();
      if (!u) return { ok: false, error: 'No link given.' };
      const r = await ENGINE.feed(kb, { url: u, language: String(language || 'en').slice(0, 8) });
      if (r.ok) kb.save();
      return r;
    },

    async ingestText(text, title) {
      const r = ENGINE.feed(kb, { text: String(text || ''), title: String(title || '') });
      if (r.ok) kb.save();
      return r;
    },

    /** @param {{name:string, text?:string, base64?:string}} file */
    async ingestFile(file) {
      const f = {
        name: String((file && file.name) || 'file').slice(0, 200),
        text: file && file.text != null ? String(file.text) : undefined,
        buffer: file && file.base64 ? Buffer.from(String(file.base64), 'base64') : undefined
      };
      const r = await ENGINE.feed(kb, { file: f });
      if (r.ok) kb.save();
      return r;
    },

    sourceText(id, chunkId) {
      const src = kb.getSource(String(id || ''));
      if (!src) return { ok: false, error: 'That source is not in the knowledge base.' };
      let chunkText = '';
      if (chunkId) {
        const c = kb.db.chunks.find((x) => x.id === String(chunkId));
        chunkText = c ? c.text : '';
      }
      return { ok: true, source: Object.assign({}, src), chunkText };
    },

    removeSource(id) { const r = kb.removeSource(String(id || '')); if (r.ok) kb.save(); return r; },

    search(q, k) { return { ok: true, hits: kb.search(String(q || ''), { k: clampInt(k, 1, 25) || 6 }), query: String(q || '') }; },

    pack(query, question) {
      return Object.assign({ ok: true }, ENGINE.coach.packContext(kb, {
        query: String(query || ''), question: String(question || ''), k: 5, cards: 3, journal: 8
      }));
    },

    /** Store an AI-distilled result against a source: cards, terms, summary, warnings. */
    saveDistill(sourceId, result) {
      const src = kb.getSource(String(sourceId || ''));
      if (!src) return { ok: false, error: 'That source is not in the knowledge base.' };
      const d = result;
      if (!d || typeof d !== 'object') return { ok: false, error: 'No distilled result supplied.' };

      src.summary = String(d.summary || '').slice(0, 1200);
      src.takeaways = (Array.isArray(d.takeaways) ? d.takeaways : []).map((t) => String(t).slice(0, 300)).slice(0, 12);
      src.terms = (Array.isArray(d.terms) ? d.terms : [])
        .map((t) => ({ term: String((t && t.term) || '').slice(0, 60), meaning: String((t && t.meaning) || '').slice(0, 260) }))
        .filter((t) => t.term && t.meaning).slice(0, 30);
      src.warnings = (Array.isArray(d.warnings) ? d.warnings : []).map((t) => String(t).slice(0, 300)).slice(0, 8);
      src.quality = clampNum(d.quality, 0, 1, 0);
      src.distilled = true;
      src.distilledAt = Date.now();
      if (d.title && !src.title) src.title = String(d.title).slice(0, 200);
      if (d.author && !src.author) src.author = String(d.author).slice(0, 100);
      const newTags = (Array.isArray(d.cards) ? d.cards : []).reduce((acc, c) => acc.concat((c && c.tags) || []), []);
      src.tags = Array.from(new Set((src.tags || []).concat(newTags))).slice(0, 16);

      const saved = [];
      for (const c of (Array.isArray(d.cards) ? d.cards : []).slice(0, 8)) {
        saved.push(kb.upsertCard({
          sid: src.id,
          title: String(c.title || 'Untitled setup').slice(0, 120),
          tags: (Array.isArray(c.tags) ? c.tags : []).map((t) => String(t).slice(0, 40)).slice(0, 6),
          level: [1, 2, 3, 4].includes(Number(c.level)) ? Number(c.level) : 2,
          setup: String(c.setup || '').slice(0, 1400),
          entry: String(c.entry || '').slice(0, 600),
          invalidation: String(c.invalidation || '').slice(0, 600),
          target: String(c.target || '').slice(0, 600),
          risk: String(c.risk || '').slice(0, 700),
          checklist: (Array.isArray(c.checklist) ? c.checklist : []).map((x) => String(x).slice(0, 200)).slice(0, 8),
          mistakes: (Array.isArray(c.mistakes) ? c.mistakes : []).map((x) => String(x).slice(0, 240)).slice(0, 6),
          markets: (Array.isArray(c.markets) ? c.markets : []).map((x) => String(x).slice(0, 24)).slice(0, 5),
          quote: c.quote ? String(c.quote).slice(0, 400) : null,
          sourceTitle: src.title,
          sourceUrl: src.url || null
        }));
      }
      kb.save();
      return { ok: true, cards: saved.length, saved };
    },

    saveCard(body) {
      if (!body || typeof body !== 'object') return { ok: false, error: 'No card supplied.' };
      const card = kb.upsertCard({
        id: body.id ? String(body.id).slice(0, 40) : undefined,
        sid: body.sid ? String(body.sid).slice(0, 40) : null,
        title: String(body.title || 'Untitled').slice(0, 120),
        tags: (Array.isArray(body.tags) ? body.tags : []).map((t) => String(t).slice(0, 40)).slice(0, 6),
        setup: String(body.setup || '').slice(0, 1400),
        entry: String(body.entry || '').slice(0, 600),
        invalidation: String(body.invalidation || '').slice(0, 600),
        target: String(body.target || '').slice(0, 600),
        risk: String(body.risk || '').slice(0, 700),
        checklist: (Array.isArray(body.checklist) ? body.checklist : []).map((x) => String(x).slice(0, 200)).slice(0, 8),
        mistakes: (Array.isArray(body.mistakes) ? body.mistakes : []).map((x) => String(x).slice(0, 240)).slice(0, 6),
        questions: Array.isArray(body.questions) ? body.questions.slice(0, 8) : [],
        sourceTitle: body.sourceTitle ? String(body.sourceTitle).slice(0, 200) : null,
        sourceUrl: body.sourceUrl ? String(body.sourceUrl).slice(0, 400) : null
      });
      kb.save();
      return { ok: true, card };
    },

    removeCard(id) { const r = kb.removeCard(String(id || '')); if (r.ok) kb.save(); return r; },

    addJournal(body) {
      const b = body || {};
      const kinds = ['note', 'trade', 'rule-break', 'win', 'review', 'coach'];
      const e = kb.addJournal({
        kind: kinds.includes(b.kind) ? b.kind : 'note',
        text: String(b.text || '').slice(0, 4000),
        outcome: b.outcome ? String(b.outcome).slice(0, 60) : null,
        tags: (Array.isArray(b.tags) ? b.tags : []).map((t) => String(t).slice(0, 40)).slice(0, 8),
        cardId: b.cardId ? String(b.cardId).slice(0, 40) : null
      });
      kb.save();
      return { ok: true, entry: e };
    },

    removeJournal(id) { const r = kb.removeJournal(String(id || '')); if (r.ok) kb.save(); return r; },

    saveSkills(skills) {
      kb.db.skills = Object.assign({}, kb.db.skills, sanitiseSkills(skills));
      kb.save();
      return { ok: true, skills: kb.db.skills };
    },

    saveSettings(input) {
      settings = sanitiseSettings(input);
      persistSettings();
      return { ok: true, settings };
    },

    publishLessons(lessons) {
      if (typeof o.publishLessons !== 'function') return { ok: false, error: 'Publishing is not available in this shell.' };
      return o.publishLessons(Array.isArray(lessons) ? lessons.slice(0, 12) : []);
    },

    exportData() { return { ok: true, data: kb.exportAll(), settings }; },

    importData(data) {
      if (!data || !Array.isArray(data.sources)) return { ok: false, error: 'That file does not look like a companion export.' };
      let added = 0;
      for (const s of data.sources.slice(0, 200)) {
        if (!s || !s.text) continue;
        const r = kb.addSource({
          kind: s.kind || 'text', url: s.url || '', title: s.title || '', text: String(s.text),
          note: s.note || '', meta: s.meta || {}, tags: s.tags || []
        });
        if (r.ok) added++;
      }
      for (const c of (Array.isArray(data.cards) ? data.cards : []).slice(0, 200)) core.saveCard(c);
      for (const j of (Array.isArray(data.journal) ? data.journal : []).slice(0, 500)) core.addJournal(j);
      if (data.skills) core.saveSkills(data.skills);
      if (data.settings) core.saveSettings(data.settings);
      kb.save();
      return { ok: true, sources: added };
    },

    wipe() {
      kb.db.sources = []; kb.db.chunks = []; kb.db.cards = []; kb.db.journal = []; kb.db.skills = {};
      kb.save();
      return { ok: true };
    }
  };

  return core;
}

module.exports = { createCore, DEFAULT_SETTINGS, SKILL_TAGS, clampInt, clampNum };
