'use strict';
/* coach.js — the live coaching brain.
 *
 * Takes a screen read (from vision.js — either the offline pixel reader or a
 * vision model), grounds it in the trader's own knowledge base and playbook,
 * picks the right lesson from the curriculum, and produces ONE short coaching
 * card: what I see · the rule · what to do · the risk · what to learn.
 *
 * It also decides when to stay quiet. A coach that talks every 5 seconds is
 * noise; `shouldSpeak()` is as important as the analysis.
 *
 * Pure logic + optional injected `ai` and `kb`, so the same code runs in the
 * Electron shell, the browser preview, or on the server. */

const CUR = (typeof require === 'function')
  ? require('./curriculum')
  : ((globalThis.TCEngine && globalThis.TCEngine.curriculum) || null);
const VIS = (typeof require === 'function')
  ? require('./vision')
  : ((globalThis.TCEngine && globalThis.TCEngine.vision) || null);

const COACH_SYSTEM =
  'You are the live coach inside a floating desktop companion for a BEGINNER trader. ' +
  'You can see their screen and you have their personal library of material they fed you (videos, articles, notes).\n' +
  'Your job is to teach, protect their capital, and keep them disciplined — not to give signals.\n' +
  'Hard rules:\n' +
  '- Never tell them to buy or sell. Say what a disciplined trader would evaluate, and what would invalidate it.\n' +
  '- Only describe what is visible or what their library says. No invented prices, symbols or indicators.\n' +
  '- Prefer THEIR library\'s language and rules over generic advice, and cite it with [n] markers matching the quotes given.\n' +
  '- Exactly one risk point per card, always.\n' +
  '- Short, skimmable, plain words. This renders in a narrow side panel during live trading.\n' +
  '- If the screen is not a chart (a video, a course page, an order ticket, a website), teach from what IS on screen.\n' +
  '- Never repeat your previous card. If nothing changed, say what to practise or ask them a question instead.\n' +
  '- This is education, not financial advice.\n' +
  'Return ONLY one JSON object, no markdown fences:\n' +
  '{\n' +
  '  "title": "3-6 words, what this moment is about",\n' +
  '  "screen": "chart|order-ticket|watchlist|news|video|course|other",\n' +
  '  "symbol": "or null", "timeframe": "or null",\n' +
  '  "see": ["3-5 short observations"],\n' +
  '  "rule": "the one rule that applies right now (cite [n] if it came from their library)",\n' +
  '  "action": "the disciplined next step (often: wait, mark the level, halve the size, journal it)",\n' +
  '  "risk": "the specific danger in this moment + the sizing/stop rule",\n' +
  '  "learn": "a 1-3 sentence mini-lesson tied to what is on screen",\n' +
  '  "askThem": "one short question that makes them think (or null)",\n' +
  '  "citations": [1,3],\n' +
  '  "lessonTag": "price action|support & resistance|trend trading|breakouts|chart patterns|indicators|volume|smart money / ICT|risk management|psychology|trading plan",\n' +
  '  "confidence": 0.0\n' +
  '}';

/* --------------------------------- helpers -------------------------------- */

function uid(prefix) {
  return (prefix || 'c') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function str(x, max) {
  if (x == null) return '';
  return String(x).replace(/\s+/g, ' ').trim().slice(0, max || 500);
}

function arr(x, max, itemMax) {
  if (!x) return [];
  const list = Array.isArray(x) ? x : String(x).split(/\n+/);
  return list.map((s) => str(s, itemMax || 240)).filter(Boolean).slice(0, max || 5);
}

function clamp01(x, dflt) {
  const n = Number(x);
  if (!isFinite(n)) return dflt == null ? 0.5 : dflt;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

function extractJson(raw) {
  let t = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(t); } catch {}
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) {
    const cand = t.slice(s, e + 1);
    try { return JSON.parse(cand); } catch {}
    try {
      return JSON.parse(cand.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/,\s*([}\]])/g, '$1'));
    } catch {}
  }
  return null;
}

/* ------------------------------- prompt input ------------------------------ */

/** Compact description of the skill profile, for the prompt. */
function skillsSummary(profile) {
  if (!profile || !CUR) return '';
  const rows = [];
  for (const tag of CUR.SKILL_TAGS) {
    const s = profile[tag];
    if (!s || !(s.exposure || s.correct || s.wrong)) continue;
    rows.push('- ' + tag + ': exposure ' + s.exposure + ', correct ' + s.correct + ', wrong ' + s.wrong +
      ', mastery ≈ ' + CUR.mastery(s) + '%');
  }
  if (!rows.length) return 'Brand new trader: nothing taught or tested yet. Start with foundations and risk.';
  const weakest = rows.slice().sort((a, b) => {
    const wa = weaknessOf(a), wb = weaknessOf(b);
    return wb - wa;
  }).slice(0, 3);
  return rows.join('\n') + '\nWeakest right now: ' + weakest.join(' · ');
}

function weaknessOf(row) {
  const m = /correct (\d+), wrong (\d+)/.exec(row);
  if (!m) return 0;
  const c = Number(m[1]), w = Number(m[2]);
  return c + w ? w / (c + w) : 0;
}

/** Recent journal entries as prompt text (so the coach does not repeat itself). */
function journalText(entries, limit) {
  const list = (entries || []).slice(0, limit || 8);
  if (!list.length) return '';
  return list.map((e) => {
    const when = new Date(e.ts || Date.now()).toISOString().slice(5, 16).replace('T', ' ');
    return '[' + when + '] ' + (e.kind || 'note') + ': ' + str(e.text, 200);
  }).join('\n');
}

/** Build the query used to search the trader's own knowledge base. */
function kbQuery(read, question) {
  const bits = [];
  if (question) bits.push(question);
  if (!read) return bits.join(' ') || 'trading rules';
  if (read.trend && read.trend !== 'unknown') bits.push(read.trend + ' trend');
  if (read.regime) bits.push(read.regime);
  if (read.momentum && read.momentum !== 'unknown') bits.push(read.momentum + ' momentum');
  if (read.volatility && read.volatility !== 'unknown') bits.push(read.volatility + ' volatility');
  if (read.positionInRange && read.positionInRange !== 'unknown') bits.push('price at ' + read.positionInRange + ' of range');
  for (const p of (read.patterns || []).slice(0, 2)) bits.push(p);
  for (const f of (read.riskFlags || []).slice(0, 1)) bits.push(f);
  if (!bits.length) bits.push('trading rules risk management');
  return bits.join(' ');
}

/* ------------------------------ the coach class ---------------------------- */

class Coach {
  /**
   * @param {{kb?:object, ai?:{ask:Function, vision:Function}, settings?:object}} deps
   */
  constructor(deps) {
    const d = deps || {};
    this.kb = d.kb || null;
    this.ai = d.ai || null;                 // null = offline mode
    this.settings = Object.assign({
      sensitivity: 'normal',                // calm | normal | chatty
      intervalMs: 8000,
      maxCitations: 3,
      riskPercent: 1,
      alwaysWarn: true,
      language: 'English'
    }, d.settings || {});
    this.skills = d.skills || {};           // used when no kb is attached (renderer-side coach)
    this.last = null;                       // last card emitted
    this.lastSceneKey = '';
    this.lastChangeAt = 0;
    this.history = [];
  }

  setAI(ai) { this.ai = ai || null; }
  setKB(kb) { this.kb = kb || null; }
  configure(patch) { this.settings = Object.assign({}, this.settings, patch || {}); return this.settings; }

  /* ------------------------------- main entry ------------------------------ */

  /**
   * Analyse a captured frame and produce a coaching card (or null if the coach
   * should stay quiet).
   * @param {{signature?:object, imageDataUrl?:string, question?:string, force?:boolean}} input
   */
  async look(input) {
    const inp = input || {};
    const local = VIS && inp.signature ? VIS.localRead(inp.signature) : (inp.localRead || null);
    const question = str(inp.question, 600) || '';

    let read = local;
    let aiRead = null;
    let mode = 'offline';

    const hasVision = !!(this.ai && this.ai.vision && inp.imageDataUrl);

    if (hasVision) {
      const vr = await this._aiRead(inp.imageDataUrl, local, question);
      if (vr && vr.ok) { aiRead = vr.read; read = mergeReads(local, vr.read); mode = 'ai'; }
    }

    const card = mode === 'ai'
      ? this._cardFromAI(aiRead, local, question)
      : this._cardOffline(local, question, inp.pack);

    if (!card) return null;
    card.mode = mode;
    card.read = { local, ai: aiRead };
    card.images = hasVision ? 1 : 0;

    if (!inp.force && !question && !this.shouldSpeak(card)) return null;

    this._commit(card);
    return card;
  }

  async _aiRead(imageDataUrl, local, question) {
    const kbCtx = this._kbContext(kbQuery(local, question), question);
    const playbook = this.kb && this.kb.cardContext ? this.kb.cardContext(3) : '';
    const user = VIS.chartPrompt({
      local,
      question,
      playbook,
      kbContext: kbCtx.block,
      skills: skillsSummary(this._skills()),
      journal: journalText(this.kb && this.kb.listJournal ? this.kb.listJournal(6) : []),
      previous: this.last ? shortCard(this.last) : ''
    });
    try {
      const res = await this.ai.vision(VIS.CHART_SYSTEM, user, [imageDataUrl]);
      if (!res || !res.ok) return { ok: false, error: res && res.error };
      const parsed = VIS.parseChartRead(res.text);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      parsed._citations = kbCtx.hits;
      return { ok: true, read: parsed, citations: kbCtx.hits };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Ask the model to produce the full coaching card (with an image attached). */
  async coach(input) {
    const inp = input || {};
    const local = VIS && inp.signature ? VIS.localRead(inp.signature) : (inp.localRead || null);
    const question = str(inp.question, 600) || '';

    // No screenshot available (or no vision model) — answer from text alone if we can.
    if (!inp.imageDataUrl) {
      if (question && this.ai && this.ai.ask) {
        const pack0 = this._pack(local, question, inp.pack);
        const user0 = buildCoachUserPrompt({
          local, question, playbook: pack0.playbook, kbContext: pack0.kbContext.block,
          skills: skillsSummary(this._skills()), journal: journalText(pack0.journal, 6),
          previous: this.last ? shortCard(this.last) : '', settings: this.settings
        }) + '\n\n(No screenshot is attached this time — answer from the question and their library.)';
        try {
          const res = await this.ai.ask(COACH_SYSTEM, user0);
          if (res && res.ok) {
            const card = parseCoachCard(res.text, pack0.kbContext.hits);
            if (card) {
              card.mode = 'ai-text';
              card.question = question;
              card.read = { local, ai: null };
              this._commit(card);
              return card;
            }
          }
        } catch { /* fall through to offline */ }
      }
      const c = this._cardOffline(local, question, inp.pack);
      if (c) { c.mode = 'offline'; c.read = { local, ai: null }; this._commit(c); }
      return c;
    }

    if (!this.ai || !this.ai.vision) {
      const c = this._cardOffline(local, question, inp.pack);
      if (c) { c.mode = 'offline'; c.read = { local, ai: null }; this._commit(c); }
      return c;
    }

    const pack = this._pack(local, question, inp.pack);
    const user = buildCoachUserPrompt({
      local, question, playbook: pack.playbook, kbContext: pack.kbContext.block,
      skills: skillsSummary(this._skills()),
      journal: journalText(pack.journal, 6),
      previous: this.last ? shortCard(this.last) : '',
      settings: this.settings
    });

    try {
      const res = await this.ai.vision(COACH_SYSTEM, user, [inp.imageDataUrl]);
      if (!res || !res.ok) return this._fallback(local, question, res && res.error, inp.pack);
      const card = parseCoachCard(res.text, pack.kbContext.hits);
      if (!card) return this._fallback(local, question, 'Unreadable reply from the brain.');
      card.mode = 'ai';
      card.read = { local, ai: null };
      if (!inp.force && !question && !this.shouldSpeak(card)) return null;
      this._commit(card);
      return card;
    } catch (e) {
      return this._fallback(local, question, e.message);
    }
  }

  _fallback(local, question, error, pack) {
    const c = this._cardOffline(local, question, pack);
    if (c) {
      c.mode = 'offline';
      c.degraded = { reason: String(error || 'brain unavailable').slice(0, 200) };
      c.read = { local, ai: null };
      this._commit(c);
    }
    return c;
  }

  /* ------------------------------ offline coach ---------------------------- */

  /** Full rule-based card with no AI at all — this is the no-key demo mode. */
  _cardOffline(read, question, pack) {
    if (!CUR) return null;
    const r = read || {};
    const mod = pickModule(r, this._skills());
    if (!mod) return null;

    const kbCtx = this._pack(r, question, pack).kbContext;
    const ownCard = (pack && pack.cards && pack.cards[0]) || (this.kb && this.kb.listCards ? this.kb.listCards()[0] : null);

    const see = (r.observations || []).slice(0, 4);
    if (r.looksLikeChart === false && see.length < 3) {
      see.push('I cannot see a candlestick chart here yet — open a chart and I will read it live.');
    }

    const rule = ownCard && ownCard.risk
      ? 'From your playbook "' + ownCard.title + '": ' + str(ownCard.risk, 220)
      : pickRule(mod, r);

    const learn = kbCtx.hits.length
      ? 'From your library (' + str(kbCtx.hits[0].source && kbCtx.hits[0].source.title, 60) + '): ' + str(kbCtx.hits[0].text, 300)
      : mod.summary;

    const card = {
      id: uid('card'),
      ts: Date.now(),
      title: mod.emoji + ' ' + (question ? 'Your question' : mod.name),
      screen: r.looksLikeChart === false ? 'other' : 'chart',
      symbol: null, timeframe: null,
      see: see.length ? see : ['Watching your screen — open a chart to get a live read.'],
      rule,
      action: pickAction(mod, r, question),
      risk: pickRisk(r, this.settings),
      learn,
      askThem: (mod.mistakes && mod.mistakes[0]) ? 'Where would your stop go on this screen, and why there?' : null,
      tags: mod.tags.slice(0, 3),
      lessonTag: mod.tags[0],
      moduleId: mod.id,
      moduleName: mod.name,
      citations: kbCtx.hits.slice(0, this.settings.maxCitations).map((h, i) => ({
        n: i + 1, title: h.source && h.source.title, url: h.source && h.source.url,
        sid: h.sid, chunkId: h.id, snippet: str(h.text, 220)
      })),
      confidence: r.confidence != null ? clamp01(r.confidence, 0.4) : 0.4,
      question: question || null,
      offline: true
    };
    return card;
  }

  _cardFromAI(aiRead, local, question) {
    const mod = CUR ? pickModule(aiRead || local || {}, this._skills()) : null;
    return {
      id: uid('card'),
      ts: Date.now(),
      title: str(aiRead.structure, 60) || (mod ? mod.emoji + ' ' + mod.name : 'Screen read'),
      screen: aiRead.screen || 'chart',
      symbol: aiRead.symbol || null,
      timeframe: aiRead.timeframe || null,
      see: arr(aiRead.see, 5, 240),
      rule: str(aiRead.action, 400),
      action: str(aiRead.action, 400),
      risk: arr(aiRead.riskFlags, 3, 200).join(' · ') || 'Risk 1% and know your stop before you click.',
      learn: str(aiRead.teach, 500),
      askThem: null,
      tags: aiRead.patterns.slice(0, 3).concat(aiRead.lessonTag ? [aiRead.lessonTag] : []),
      lessonTag: aiRead.lessonTag || null,
      moduleId: mod ? mod.id : null,
      moduleName: mod ? mod.name : null,
      citations: [],
      confidence: clamp01(aiRead.confidence, 0.5),
      question: question || null,
      offline: false
    };
  }

  /* -------------------------------- plumbing ------------------------------- */

  _kbContext(query, question) {
    if (!this.kb || !this.kb.context) return { hits: [], block: '' };
    const q = (question ? question + ' ' : '') + query;
    try { return this.kb.context(q, { k: this.settings.maxCitations + 2, chars: 3600 }); }
    catch { return { hits: [], block: '' }; }
  }

  /**
   * Everything the coach needs from the knowledge base. The renderer (which holds
   * the AI key) can pre-fetch this over IPC/HTTP and pass it in as `pack`, so the
   * key never has to travel to where the data lives.
   */
  _pack(read, question, pack) {
    if (pack && (pack.kbContext || pack.playbook || pack.journal)) {
      return {
        kbContext: pack.kbContext || { hits: [], block: '' },
        playbook: pack.playbook || '',
        journal: pack.journal || [],
        cards: pack.cards || []
      };
    }
    return {
      kbContext: this._kbContext(kbQuery(read, question), question),
      playbook: this.kb && this.kb.cardContext ? this.kb.cardContext(3) : '',
      journal: this.kb && this.kb.listJournal ? this.kb.listJournal(6) : [],
      cards: this.kb && this.kb.listCards ? this.kb.listCards() : []
    };
  }

  _skills() { return (this.kb && this.kb.db && this.kb.db.skills) || this.skills || {}; }

  _saveSkills() {
    if (this.kb && this.kb.db) { this.kb.db.skills = this._skills(); if (this.kb.saveSoon) this.kb.saveSoon(); }
  }

  _commit(card) {
    this.last = card;
    this.lastSceneKey = VIS && card.read ? VIS.sceneKey(card.read.ai || card.read.local) : '';
    this.lastChangeAt = Date.now();
    this.history.push({ id: card.id, ts: card.ts, title: card.title, key: this.lastSceneKey, tag: card.lessonTag });
    if (this.history.length > 200) this.history.shift();
    if (CUR) {
      CUR.markTaught(this._skills(), card.lessonTag || (card.tags && card.tags[0]), 1);
      this._saveSkills();
    }
  }

  /**
   * Rate limiting: only speak when something meaningful changed.
   * @returns {boolean}
   */
  shouldSpeak(card) {
    if (!card) return false;
    const now = Date.now();
    const key = VIS && card.read ? VIS.sceneKey(card.read.ai || card.read.local) : card.title;
    const changed = key !== this.lastSceneKey;
    const since = now - this.lastChangeAt;
    const sens = this.settings.sensitivity || 'normal';
    const cooldown = sens === 'chatty' ? 12000 : sens === 'calm' ? 90000 : 35000;

    if (changed) { this.lastChangeAt = now; return true; }
    if (since < cooldown) return false;

    // Same scene, but time has passed: speak only if there is something new to say.
    if (sens === 'calm') {
      const read = card.read && (card.read.ai || card.read.local);
      return !!(read && (read.riskFlags || []).length);
    }
    return true;
  }

  /* ------------------------------- teaching -------------------------------- */

  /** Next best things to study, adapted to their profile and library gaps. */
  plan(limit, kbTags, doneModules) {
    if (!CUR) return [];
    const stats = this.kb && this.kb.stats ? this.kb.stats() : { tags: [] };
    const done = doneModules || (this.kb && this.kb.db && this.kb.db.skills && this.kb.db.skills.__done) || [];
    const plan = CUR.planFor({
      skills: this._skills(),
      kbTags: kbTags || (stats.tags || []).map((t) => t.tag),
      doneModules: done
    });
    return plan.slice(0, limit || 5).map((p) => ({
      id: p.module.id, name: p.module.name, emoji: p.module.emoji, level: p.module.level,
      minutes: p.module.minutes, tags: p.module.tags, summary: p.module.summary,
      reason: p.reason, priority: p.priority
    }));
  }

  module(id) { return CUR ? CUR.byId(id) : null; }

  quiz(tags) {
    if (!CUR) return null;
    const weak = weakTags(this._skills(), tags);
    return CUR.quizQuestion(weak);
  }

  /** Record a quiz answer and return the correction text. */
  answer(q, chosen) {
    const correct = Number(chosen) === Number(q.answer);
    if (CUR) {
      CUR.markAnswer(this._skills(), q.tag || q.moduleName, correct);
      this._saveSkills();
    }
    return { correct, why: q.why || '', correctText: (q.options && q.options[q.answer]) || '' };
  }

  microLesson(tag) { return CUR ? CUR.microLesson(tag) : null; }

  /** Save a coaching moment into the journal. */
  journalCard(card, note) {
    if (!this.kb || !this.kb.addJournal) return null;
    return this.kb.addJournal({
      kind: 'coach',
      text: (note ? note + ' — ' : '') + card.title + ' | see: ' + (card.see || []).slice(0, 2).join(' ') +
        ' | rule: ' + str(card.rule, 140) + ' | risk: ' + str(card.risk, 120),
      tags: (card.tags || []).concat(card.lessonTag ? [card.lessonTag] : []),
      cardId: card.id
    });
  }
}

function weakTags(skills, override) {
  if (override && override.length) return override;
  if (!CUR) return [];
  return CUR.SKILL_TAGS
    .map((t) => ({ t, w: CUR.weaknessScore(skills[t]) }))
    .filter((x) => x.w > 0.3)
    .sort((a, b) => b.w - a.w)
    .slice(0, 3)
    .map((x) => x.t);
}

/* ----------------------------- offline decisioning --------------------------- */

const MODULE_BY_REGIME = {
  'uptrend': ['trend-pullback', 'multi-timeframe', 'volume'],
  'downtrend': ['trend-pullback', 'market-structure', 'liquidity-sweeps'],
  'ranging': ['range-trading', 'support-resistance', 'breakouts-fakeouts'],
  'tight consolidation': ['breakouts-fakeouts', 'volume', 'chart-patterns'],
  'not-a-chart': ['trading-plan', 'journaling', 'psychology-tilt']
};

function pickModule(read, skills) {
  if (!CUR) return null;
  const r = read || {};
  let ids = [];

  if (r.looksLikeChart === false) {
    ids = MODULE_BY_REGIME['not-a-chart'];
  } else {
    if (r.volatility === 'high' || (r.measures && r.measures.spikes)) ids = ['risk-1-percent', 'liquidity-sweeps', 'psychology-tilt'];
    else if (r.trend === 'up') ids = MODULE_BY_REGIME.uptrend;
    else if (r.trend === 'down') ids = MODULE_BY_REGIME.downtrend;
    else if (r.trend === 'flat') ids = MODULE_BY_REGIME['tight consolidation'];
    else ids = MODULE_BY_REGIME.ranging;

    if (r.positionInRange === 'top' && r.trend === 'up') ids = ['psychology-tilt', 'risk-1-percent', 'trend-pullback'];
    if (r.positionInRange === 'bottom' && r.trend === 'down') ids = ['psychology-tilt', 'market-structure', 'risk-1-percent'];
  }

  // Bias toward their weakest topic when several modules are equally relevant.
  const scored = ids.map((id, pos) => {
    const m = CUR.byId(id);
    if (!m) return null;
    const w = Math.max.apply(null, m.tags.map((t) => CUR.weaknessScore(skills && skills[t])).concat([0]));
    const stale = m.tags.every((t) => !(skills && skills[t] && skills[t].exposure));
    // Regime order carries the relevance signal; weakness can override it;
    // a small random term only breaks ties so a long session is not monotonous.
    const fit = (ids.length - pos) * 0.3;
    return { m, score: fit + w * 1.6 + (stale ? 0.5 : 0) + Math.random() * 0.12 };
  }).filter(Boolean);

  if (!scored.length) return CUR.LIBRARY[0];
  scored.sort((a, b) => b.score - a.score);
  return scored[0].m;
}

function pickRule(mod, read) {
  const r = read || {};
  if (r.positionInRange === 'top' && r.trend === 'up') {
    return 'Extended near the top of the range: entries here usually have a bad risk:reward. Wait for the pullback, not the chase.';
  }
  if (r.positionInRange === 'bottom' && r.trend === 'down') {
    return 'Extended near the bottom of a downtrend: catching this needs a higher low first. Until structure prints, it is a falling knife.';
  }
  if (r.volatility === 'high') {
    return 'Volatility is elevated: the same 1% risk needs a SMALLER position, because the stop distance is wider.';
  }
  if (r.volatility === 'low') {
    return 'Tight range: breakouts from here fake out first. Wait for a close outside the range, then the retest.';
  }
  if (r.trend === 'flat' || r.regime === 'ranging') {
    return 'No trend to join: trade the edges of the range or stand aside. The middle of a range is a coin flip minus fees.';
  }
  const idx = Math.floor(Math.random() * mod.rules.length);
  return mod.rules[idx];
}

function pickAction(mod, read, question) {
  if (question) return 'Answer above, then mark the level this screen is testing before you click anything.';
  const r = read || {};
  if (r.looksLikeChart === false) return 'Do this drill: ' + mod.drill;
  if (r.volatility === 'high') return 'Reduce size, widen nothing. If you are already in, move to the plan you wrote before the spike.';
  if (r.trend === 'flat') return 'Mark the two range edges and set an alert. Do not trade the middle.';
  if (r.trend === 'up') return 'Wait for the pullback into the last higher low or the 20 EMA; enter only on a close back up.';
  if (r.trend === 'down') return 'Do not buy the dip yet. Wait for a higher low on this timeframe, or a retest of the lower high to short.';
  return 'Do this drill: ' + mod.drill;
}

const RISK_LINES = [
  'Risk 1% of equity. Position size = (account × 1%) ÷ (entry − stop). The stop sets the size.',
  'No stop = no trade. Decide where the idea is wrong before you decide how much to buy.',
  'Two losses in a row → half size. Three → done for the day. This is a rule, not a mood.',
  'Leverage does not change your risk. Size and stop distance do.',
  'If the trade would hurt to lose, it is already too big.',
  'Never average down on a losing idea. Adding to a loser is how small losses become account-ending ones.'
];

function pickRisk(read, settings) {
  const r = read || {};
  const pct = Number((settings && settings.riskPercent) || 1);
  if (r.volatility === 'high') {
    return 'High volatility on screen: your stop has to be wider, so your position size must be SMALLER to keep risk at ' +
      pct + '%. Wide stop + normal size = oversized risk.';
  }
  if ((r.riskFlags || []).length) return 'Flag on screen: ' + r.riskFlags[0] + '. Risk ' + pct + '% of equity: size = (account × ' + pct + '%) ÷ (entry − stop).';
  const i = Math.floor(Math.random() * RISK_LINES.length);
  const line = RISK_LINES[i].replace(/1%/g, pct + '%');
  // Guarantee the configured number always appears, whichever line was picked.
  return /\d/.test(line) && line.includes('%') ? line : line + ' Risk ' + pct + '% per trade.';
}

/* ------------------------------- AI card parsing --------------------------- */

function buildCoachUserPrompt(ctx) {
  const c = ctx || {};
  const parts = [];
  if (c.local) {
    parts.push(c.local.looksLikeChart
      ? 'OFFLINE PIXEL PRE-READ (approximate, use as a hint and correct it if the image disagrees):\n' + VIS.describeLocal(c.local)
      : 'OFFLINE PIXEL PRE-READ: this does not look like a candlestick chart. Work out what screen it is and teach from that.');
  }
  if (c.playbook) parts.push('THEIR PLAYBOOK (distilled from material they fed me — prefer these rules):\n' + c.playbook);
  if (c.kbContext) parts.push('QUOTES FROM THEIR KNOWLEDGE BASE — cite with [n] matching these numbers:\n' + c.kbContext);
  if (c.skills) parts.push('THEIR SKILL PROFILE:\n' + c.skills);
  if (c.journal) parts.push('RECENT JOURNAL:\n' + c.journal);
  if (c.previous) parts.push('YOUR PREVIOUS CARD (do not repeat it):\n' + c.previous);
  if (c.question) parts.push('THEY ASKED: "' + c.question + '" — answer that first inside "learn", then keep the normal structure.');
  if (c.settings && c.settings.language && c.settings.language !== 'English') {
    parts.push('Write the card in ' + c.settings.language + '.');
  }
  parts.push('Now produce the JSON coaching card for the attached screenshot.');
  return parts.join('\n\n');
}

function parseCoachCard(raw, kbHits) {
  const j = extractJson(raw);
  if (!j || typeof j !== 'object') return null;
  const hits = kbHits || [];
  const citeNums = arr(j.citations, 4, 8).map((n) => parseInt(n, 10)).filter((n) => n >= 1 && n <= hits.length);

  const card = {
    id: uid('card'),
    ts: Date.now(),
    title: str(j.title, 70) || 'Live read',
    screen: ['chart', 'order-ticket', 'watchlist', 'news', 'video', 'course', 'other'].includes(str(j.screen)) ? str(j.screen) : 'other',
    symbol: str(j.symbol, 40) === 'null' ? null : (str(j.symbol, 40) || null),
    timeframe: str(j.timeframe, 12) === 'null' ? null : (str(j.timeframe, 12) || null),
    see: arr(j.see, 5, 240),
    rule: str(j.rule, 500),
    action: str(j.action, 400),
    risk: str(j.risk, 400),
    learn: str(j.learn, 700),
    askThem: str(j.askThem, 240) === 'null' ? null : (str(j.askThem, 240) || null),
    lessonTag: VALID_TAGS.includes(str(j.lessonTag)) ? str(j.lessonTag) : null,
    tags: [str(j.lessonTag)].filter(Boolean),
    citations: citeNums.map((n) => {
      const h = hits[n - 1];
      return { n, title: h.source && h.source.title, url: h.source && h.source.url, sid: h.sid, chunkId: h.id, snippet: str(h.text, 220) };
    }),
    confidence: clamp01(j.confidence, 0.5),
    question: null,
    offline: false
  };
  if (!card.see.length && !card.learn) return null;
  return card;
}

const VALID_TAGS = ['price action', 'support & resistance', 'trend trading', 'breakouts', 'chart patterns',
  'indicators', 'volume', 'smart money / ICT', 'risk management', 'psychology', 'trading plan'];

/** Merge the offline read with the AI read; the AI wins where it is specific. */
function mergeReads(local, ai) {
  if (!ai) return local;
  if (!local) return ai;
  return Object.assign({}, local, ai, {
    looksLikeChart: ai.screen === 'chart' ? true : local.looksLikeChart,
    observations: (ai.see && ai.see.length ? ai.see : local.observations),
    offline: local,
    ai
  });
}

function shortCard(card) {
  if (!card) return '';
  return 'title: ' + card.title + '\nsee: ' + (card.see || []).slice(0, 3).join(' | ') +
    '\nrule: ' + str(card.rule, 160) + '\naction: ' + str(card.action, 160) + '\nrisk: ' + str(card.risk, 120);
}

function sceneKeyOf(card) {
  if (!card || !card.read) return '';
  return VIS ? VIS.sceneKey(card.read.ai || card.read.local) : String(card.title || '');
}

/**
 * Node-side helper: build the context pack for a query straight from a kb.
 * Used by server.js and the Electron main process.
 */
function packContext(kb, input) {
  const i = input || {};
  const query = i.query || kbQuery(i.read || null, i.question || '');
  const q = i.question ? i.question + ' ' + query : query;
  const ctx = kb && kb.context ? kb.context(q, { k: i.k || 5, chars: i.chars || 3600 }) : { hits: [], block: '' };
  return {
    query: q,
    kbContext: ctx,
    playbook: kb && kb.cardContext ? kb.cardContext(i.cards || 3) : '',
    cards: kb && kb.listCards ? kb.listCards().slice(0, 12) : [],
    journal: kb && kb.listJournal ? kb.listJournal(i.journal || 8) : [],
    stats: kb && kb.stats ? kb.stats() : null
  };
}

const __exports = {
  Coach, COACH_SYSTEM, buildCoachUserPrompt, parseCoachCard, skillsSummary, journalText,
  kbQuery, pickModule, pickRule, pickAction, pickRisk, mergeReads, shortCard, sceneKeyOf, packContext
};
// Works in Node (require) and in the browser/Electron renderer (<script> tag).
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
if (typeof globalThis !== 'undefined') { globalThis.TCEngine = globalThis.TCEngine || {}; globalThis.TCEngine.coach = __exports; }
