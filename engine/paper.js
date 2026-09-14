'use strict';
/* engine/paper.js — the Paper Trading Gym: a dealer of scripted market situations.
 *
 * The coach can watch your real screen, but skills are built by reps. The gym
 * deals ten hands per session: a synthetic chart with a hidden story (trend
 * pullback, failed breakout, liquidity sweep, chop…), and you call it —
 * long, short, or stand aside. It then grades two separate things, because
 * they are two separate skills:
 *
 *   • PROCESS  — did you take the right kind of trade? (compared to the story)
 *   • OUTCOME  — what actually happened to a structure-based stop/target, in R
 *
 * A correct process can lose money and a bad process can win; the feedback
 * line always says which one you just experienced. Seeded, deterministic,
 * offline, and shared verbatim between the desktop app, the browser and the
 * phone (pure JS, no dependencies, browser-safe export).
 */

/* ── seeded rng (mulberry32) ─────────────────────────────────────────────── */
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  // Box–Muller, cheap
  const u = Math.max(rand(), 1e-9);
  const v = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ── candle walk helpers ─────────────────────────────────────────────────── */
function walk(rand, n, start, drift, vol) {
  const out = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = o + drift + gauss(rand) * vol;
    const h = Math.max(o, c) + rand() * vol * 0.7;
    const l = Math.min(o, c) - rand() * vol * 0.7;
    out.push({ o, h, l, c });
    px = c;
  }
  return out;
}

const last = (a) => a[a.length - 1];

/* ── the six stories ─────────────────────────────────────────────────────── */
const TYPES = ['trend-pullback', 'trend-fade', 'range', 'breakout-go', 'breakout-fail', 'sweep-reversal'];

const META = {
  'trend-pullback': { best: 'long', tag: 'trend trading', title: 'Uptrend, pullback to the trend' },
  'trend-fade': { best: 'short', tag: 'trend trading', title: 'Downtrend, rally into a lower high' },
  'range': { best: 'wait', tag: 'support & resistance', title: 'Mid-range chop' },
  'breakout-go': { best: 'long', tag: 'breakouts', title: 'Tight consolidation, edges' },
  'breakout-fail': { best: 'wait', tag: 'breakouts', title: 'A breakout that smells wrong' },
  'sweep-reversal': { best: 'long', tag: 'smart money / ICT', title: 'A sweep of an obvious low' }
};

function buildScenario(rand, type) {
  const vol = 1.0;
  let ctx; let fut;
  if (type === 'trend-pullback') {
    ctx = walk(rand, 42, 100, 0.55, vol).concat(walk(rand, 9, 0, -0.45, vol * 0.8));
    // re-base the pullback onto the trend's last price
    rebase(ctx, 42);
    const e = last(ctx).c;
    fut = walk(rand, 34, e, 0.62, vol * 0.9);
  } else if (type === 'trend-fade') {
    ctx = walk(rand, 42, 200, -0.55, vol).concat(walk(rand, 9, 0, 0.45, vol * 0.8));
    rebase(ctx, 42);
    const e = last(ctx).c;
    fut = walk(rand, 34, e, -0.62, vol * 0.9);
  } else if (type === 'range') {
    ctx = walk(rand, 50, 150, 0, vol);
    // mean-revert it into a visible range
    const mid = ctx[20].c;
    for (let i = 0; i < ctx.length; i++) {
      const k = ctx[i];
      const pull = (mid - k.c) * 0.12;
      k.c += pull; k.o += pull; k.h = Math.max(k.h + pull, k.c + 0.2); k.l = Math.min(k.l + pull, k.c - 0.2);
    }
    const e = last(ctx).c;
    fut = walk(rand, 34, e, 0, vol);
    for (let i = 0; i < fut.length; i++) { // keep it choppy around the middle
      const pull = (mid - fut[i].c) * 0.18;
      fut[i].c += pull; fut[i].o += pull; fut[i].h += pull; fut[i].l += pull;
    }
  } else if (type === 'breakout-go' || type === 'breakout-fail') {
    ctx = walk(rand, 34, 120, 0, vol * 0.5);
    const mid = ctx[10].c;
    for (let i = 0; i < ctx.length; i++) { // squeeze: flatten into a tight box
      const k = ctx[i];
      const pull = (mid - k.c) * 0.3;
      k.c += pull; k.o += pull; k.h = Math.max(k.h + pull, k.c + 0.15); k.l = Math.min(k.l + pull, k.c - 0.15);
    }
    const hi = Math.max.apply(null, ctx.map((k) => k.h));
    const e = last(ctx).c;
    if (type === 'breakout-go') {
      fut = walk(rand, 34, e, 0.9, vol * 1.1);
      fut[0] = { o: e, c: hi + 1.6, h: hi + 2.2, l: e - 0.3 };   // the expansion candle
    } else {
      const poke = walk(rand, 3, e, 0.8, vol * 0.6);
      poke[0] = { o: e, c: hi + 1.1, h: hi + 1.6, l: e - 0.2 };
      const back = walk(rand, 31, hi + 1.1, -0.85, vol);
      fut = poke.concat(back);
    }
  } else { // sweep-reversal
    ctx = walk(rand, 40, 130, 0.15, vol);
    const lo = Math.min.apply(null, ctx.slice(-24).map((k) => k.l));
    const wick = { o: last(ctx).c, c: lo + 0.35, h: last(ctx).c + 0.4, l: lo - 1.8 }; // the sweep
    ctx = ctx.concat([wick, { o: lo + 0.35, c: lo + 1.4, h: lo + 1.9, l: lo + 0.1 }]);
    const e = last(ctx).c;
    fut = walk(rand, 34, e, 0.7, vol * 0.9);
  }
  return { type, ctx, fut, meta: META[type] };
}

function rebase(candles, from) {
  // glue a second walk segment onto the first segment's last close
  const anchor = candles[from - 1].c;
  const first = candles[from].o;
  const d = anchor - first;
  for (let i = from; i < candles.length; i++) {
    candles[i].o += d; candles[i].c += d; candles[i].h += d; candles[i].l += d;
  }
}

/* ── structure-based stop & target, then the forward walk ────────────────── */
function planFor(sc, action) {
  const ctx = sc.ctx;
  const entry = last(ctx).c;
  const look = ctx.slice(-12);
  if (action === 'wait') return { entry, stop: null, target: null, r: 0 };
  if (action === 'long') {
    const stop = Math.min.apply(null, look.map((k) => k.l)) - 0.4;
    const risk = Math.max(entry - stop, 1e-6);
    return { entry, stop, target: entry + 2 * risk, r: null };
  }
  const stop = Math.max.apply(null, look.map((k) => k.h)) + 0.4;
  const risk = Math.max(stop - entry, 1e-6);
  return { entry, stop, target: entry - 2 * risk, r: null };
}

function realise(sc, plan, action) {
  if (action === 'wait') return 0;
  let r = 0;
  for (const k of sc.fut) {
    if (action === 'long') {
      if (k.l <= plan.stop) return -1;          // stopped first
      if (k.h >= plan.target) return 2;         // target first
    } else {
      if (k.h >= plan.stop) return -1;
      if (k.l <= plan.target) return 2;
    }
    r = action === 'long' ? (k.c - plan.entry) / (plan.entry - plan.stop) : (plan.entry - k.c) / (plan.stop - plan.entry);
  }
  return Math.round(Math.max(-1, Math.min(2, r)) * 100) / 100;   // open at horizon, mark it
}

/* ── feedback lines: process and outcome are graded separately ───────────── */
function note(sc, action, correct, r) {
  const m = sc.meta;
  const story = {
    'trend-pullback': 'Higher highs, higher lows, then a pullback into the trend. The stop belongs under the last higher low — that is a real invalidation.',
    'trend-fade': 'Lower highs and lower lows; the rally died at a lower high. In a downtrend the rally is the entry, not the reversal.',
    'range': 'Price was mid-range: no edge, just noise between two levels. Standing aside IS a position — the best traders take it often.',
    'breakout-go': 'A long tight consolidation, then a candle that closed beyond it with expansion. That is the breakout profile worth paying for.',
    'breakout-fail': 'It poked out and closed back inside — the breakout buyers are now trapped. Chasing that candle is how pros feed.',
    'sweep-reversal': 'A fast wick through an obvious low that closed back inside: liquidity taken, then rejection. The sweep is the signal.'
  }[sc.type];
  if (action === 'wait') {
    if (correct) return '✅ Right call. ' + story + ' Open R: ' + r + '.';
    return '⏸ You waited, but this one was a trade: ' + story + ' (it would have printed ' + r + 'R)';
  }
  const dirWord = action === 'long' ? 'long' : 'short';
  if (correct) {
    return '✅ Correct process — ' + dirWord + ' was the right kind of trade here. ' + story +
      (r >= 0 ? ' Outcome: +' + r + 'R. Process and result agreed.' : ' Outcome: ' + r + 'R. Good trade, bad luck — that is variance, not a mistake.');
  }
  return '❌ Wrong kind of trade here (' + dirWord + '). ' + story +
    (r >= 0 ? ' It made +' + r + 'R anyway — a bad process that pays is the most expensive lesson there is.' : ' Outcome: ' + r + 'R.');
}

/* ── session ─────────────────────────────────────────────────────────────── */
function createSession(seed) {
  const rand = rng(seed);
  const order = [];
  const pool = TYPES.slice();
  while (order.length < 10) {
    if (!pool.length) pool.push.apply(pool, TYPES);
    order.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  const scenarios = order.map((t) => buildScenario(rand, t));
  const S = {
    seed: seed >>> 0,
    i: 0,
    rounds: scenarios.length,
    score: 0,
    correct: 0,
    rSum: 0,
    streak: 0,
    bestStreak: 0,
    tags: {},
    log: [],
    done: false
  };
  function current() { return S.done ? null : scenarios[S.i]; }
  function answer(action) {
    if (S.done) throw new Error('session finished');
    if (['long', 'short', 'wait'].indexOf(action) < 0) throw new Error('action must be long, short or wait');
    const sc = scenarios[S.i];
    const plan = planFor(sc, action);
    const r = realise(sc, plan, action);
    const correct = action === sc.meta.best;
    S.rSum += r;
    if (correct) {
      S.correct++; S.score += 10 + (r > 0 ? Math.round(r * 2) : 0);
      S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak);
    } else { S.streak = 0; }
    S.tags[sc.meta.tag] = S.tags[sc.meta.tag] || { seen: 0, correct: 0 };
    S.tags[sc.meta.tag].seen++;
    if (correct) S.tags[sc.meta.tag].correct++;
    const res = {
      round: S.i + 1, type: sc.type, title: sc.meta.title, tag: sc.meta.tag,
      action, best: sc.meta.best, correct, r,
      entry: Math.round(plan.entry * 100) / 100,
      stop: plan.stop == null ? null : Math.round(plan.stop * 100) / 100,
      target: plan.target == null ? null : Math.round(plan.target * 100) / 100,
      note: note(sc, action, correct, r),
      future: sc.fut
    };
    S.log.push(res);
    S.i++;
    if (S.i >= S.rounds) S.done = true;
    return res;
  }
  return {
    state: S,
    current,
    answer,
    summary() {
      const weak = Object.keys(S.tags).filter((t) => S.tags[t].correct / S.tags[t].seen < 0.6);
      return {
        seed: S.seed, rounds: S.rounds, correct: S.correct, score: S.score,
        rSum: Math.round(S.rSum * 100) / 100, bestStreak: S.bestStreak,
        hitRate: Math.round((S.correct / S.rounds) * 100), weak, tags: S.tags
      };
    }
  };
}

const __exports = { rng, walk, buildScenario, planFor, realise, createSession, TYPES, META };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
if (typeof globalThis !== 'undefined') {
  globalThis.TCEngine = globalThis.TCEngine || {};
  globalThis.TCEngine.paper = __exports;
}
