#!/usr/bin/env node
'use strict';
/**
 * The live/paper runner. Same engine, no second implementation of the strategy.
 *
 *   node bot/live.js --replay --preset quiet-eve-low --days 120      # proof: live path == backtest path
 *   node bot/live.js --replay --preset quiet-eve-low --days 120 --strict
 *   node bot/live.js --paper --preset quiet-eve-low --loop           # continuous paper, needs data adapter
 *   node bot/live.js --paper --once                                   # single cycle (cron-able)
 *
 * DESIGN NOTE — decisions are made by RECOMPUTING the engine over a trailing window of bars and
 * reading what it says should be open at the last bar, rather than by keeping an incremental state
 * machine in the runner. That is deliberate for a bot that trades once a day:
 *   - there is exactly one implementation of the strategy, so research and execution cannot drift
 *   - a crash/restart loses nothing, because desired state is derived from market data, not memory
 *   - broker positions are always treated as truth and reconciled against, never assumed
 * Cost: we redo ~1000 bars of indicator work per decision, ~4 times a day. Negligible here.
 */
const fs = require('fs');
const path = require('path');
const { runBacktest, assertSafe, pipSize, pipsToPrice, utcParts, roundTripCostPips } = require('./lib/engine');
void 0;
const { synthetic, fromCsv } = require('./lib/data');
const presets = require('./lib/presets');

const OUT = path.join(__dirname, 'out');
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  if (i === -1) return d;
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
};

/* ------------------------------------------------------------------ *
 * Journal: append-only record of every decision, including the ones
 * that did nothing. Silent inaction is the hardest thing to debug live.
 * ------------------------------------------------------------------ */
class Journal {
  constructor(file) {
    this.file = file;
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!fs.existsSync(file)) fs.writeFileSync(file, 'time,ev,symbol,dir,lots,px,sl,tp,pnl,reason,cid\n');
    }
  }
  write(ev, o = {}) {
    const row = [new Date().toISOString(), ev, o.symbol || '', o.dir || '', o.lots ?? '', o.px ?? '', o.sl ?? '', o.tp ?? '', o.pnl ?? '', (o.reason || '').replace(/[,\n]/g, ' '), o.cid || ''];
    const line = row.join(',');
    if (this.file) fs.appendFileSync(this.file, line + '\n');
    // echo only when a journal file actually exists: tests and replay should not spam the console
    if (this.file && ev !== 'skip') console.log('  ' + line);
  }
}

/* ------------------------------------------------------------------ *
 * Paper broker: fills at the next bar, honours attached SL/TP, and
 * persists to disk so a restart cannot reset risk state.
 * ------------------------------------------------------------------ */
class PaperBroker {
  constructor({ symbol, equity, cfg, stateFile, journal }) {
    this.symbol = symbol;
    this.equity = equity;
    this.startEquity = equity;
    this.cfg = cfg;
    this.stateFile = stateFile;
    this.journal = journal || new Journal(null);
    this.positions = [];
    this.closedToday = [];
    this.cidSeen = new Set();
    this.nextTicket = 1;
    if (stateFile && fs.existsSync(stateFile)) {
      try {
        Object.assign(this, JSON.parse(fs.readFileSync(stateFile, 'utf8')));
        this.journal.write('restore', { symbol, reason: `recovered ${this.positions.length} position(s), ${this.closedToday.length} closed today`, equity: this.equity });
      } catch (e) {
        this.journal.write('restoreFailed', { reason: e.message });
      }
    }
  }
  save() {
    if (!this.stateFile) return;
    fs.writeFileSync(this.stateFile, JSON.stringify({ equity: this.equity, startEquity: this.startEquity, positions: this.positions, closedToday: this.closedToday, dayKey: this.dayKey, nextTicket: this.nextTicket, haltedUntilDay: this.haltedUntilDay }));
  }
  /** server-side stop/target check. In production the BROKER holds these; the bot dying must not expose us. */
  onBar(bar) {
    this.barT = bar.t;
    this.lastClosePx = bar.c;
    this.lastBar = bar;
    const spike = this.spreadSpike(bar);
    for (let i = this.positions.length - 1; i >= 0; i--) {
      const p = this.positions[i];
      const sign = p.dir === 'long' ? 1 : -1;
      const hitSl = sign === 1 ? bar.l <= p.sl : bar.h >= p.sl;
      const hitTp = sign === 1 ? bar.h >= p.tp : bar.l <= p.tp;
      // Same precedence as the engine, deliberately: TP > SL > forced. The engine resolves a bar
      // that tags BOTH to exits.sameBarTieBreak (default 'worst' = stop), so mirror that here or
      // the two paths disagree for a reason that has nothing to do with the strategy.
      const ambiguous = hitTp && hitSl;
      const wb = this.cfg.exits.sameBarTieBreak || 'worst';
      const takeTp = ambiguous ? wb === 'best' : hitTp;
      const takeSl = ambiguous ? wb !== 'best' : hitSl;
      if (!takeTp && !takeSl && !spike) continue;
      const px = takeSl ? p.sl : takeTp ? p.tp : bar.c;
      const reason = takeSl ? 'SL' : takeTp ? 'TP' : 'SPREAD_SPIKE';
      this._realise(p, px, reason, bar);
      this.positions.splice(i, 1);
    }
  }
  /** Broker-side mirror of the engine's spread-spike kill switch. */
  spreadSpike(bar) {
    const m = this.cfg.filters.spreadSpikeMult;
    const max = this.cfg.filters.maxSpreadPoints;
    if (!(m > 0) || !(max > 0)) return false;
    const sp = bar.spreadPips != null ? bar.spreadPips : this.cfg.costs.spreadPips;
    return sp * 10 > max * m;
  }
  _realise(p, px, reason, bar) {
    const t = bar && bar.t != null ? bar.t : bar;
    const pipDist = pipsToPrice(1, this.symbol);
    const sign = p.dir === 'long' ? 1 : -1;
    // identical cost model to the backtest, so a live-vs-backtest diff means logic, not fees
    // bar-aware, exactly like the engine: charging baseline spread here while the engine charges
    // the spiked spread is a pure accounting difference that reads as strategy divergence.
    const pips = ((px - p.px) / pipDist) * sign - roundTripCostPips(bar && bar.h != null ? bar : { t }, this.cfg);
    const pnl = pips * p.lots * (this.cfg.contractCashPerPipPerLot || 10);
    this.equity += pnl;
    const rec = { cid: p.cid, pnl, reason, t: bar && bar.t != null ? bar.t : t, dir: p.dir, lots: p.lots, px, entryPx: p.px, sl: p.sl, tp: p.tp, openedBarT: p.openedBarT, exitBar: bar && bar.h != null ? bar : null };
    this.closedToday.push(rec);
    if (this.onClose) this.onClose(rec);
    this.journal.write('close', { symbol: this.symbol, dir: p.dir, lots: p.lots, px: +px.toFixed(5), pnl: +pnl.toFixed(2), reason, cid: p.cid });
    return pnl;
  }
  open({ dir, lots, px, sl, tp, cid, reason }) {
    // idempotency: a retry after a timeout must not create a second position
    if (this.cidSeen.has(cid)) {
      this.journal.write('skip', { reason: 'duplicate cid (idempotent retry)', cid });
      return null;
    }
    if (this.positions.length >= 1) {
      this.journal.write('skip', { reason: 'already holding a position', cid });
      return null;
    }
    this.cidSeen.add(cid);
    const p = { ticket: this.nextTicket++, symbol: this.symbol, dir, lots, px, sl, tp, cid, openedAt: Date.now(), openedBarT: this.barT || Date.now() };
    this.positions.push(p);
    this.journal.write('open', { symbol: this.symbol, dir, lots, px: +px.toFixed(5), sl: +sl.toFixed(5), tp: +tp.toFixed(5), reason, cid });
    return p;
  }
  closeAll(reason, px) {
    const last = this.closedToday.length;
    const at = Number.isFinite(px) ? px : (this.lastClosePx != null ? this.lastClosePx : undefined);
    for (const p of this.positions.splice(0)) {
      if (at == null) { this.journal.write('error', { reason: 'closeAll without a market price — refusing to settle at entry price', symbol: this.symbol }); }
      this._realise(p, at != null ? at : p.px, reason, this.lastBar || { t: this.barT || Date.now() });
    }
    if (this.positions.length === 0 && this.closedToday.length > last) this.journal.write('flatten', { reason, symbol: this.symbol });
  }
  dayPL() {
    return this.closedToday.filter((c) => c.t === this.todayKey).reduce((s, c) => s + c.pnl, 0);
  }
}

/* ------------------------------------------------------------------ *
 * Clock helpers (GMT, and loud about it — a drifted clock silently
 * moves the whole session window, the same bug class as a wrong
 * broker GMT offset)
 * ------------------------------------------------------------------ */
function toMin(v) {
  const [h, m] = String(v).split(':').map(Number);
  return h * 60 + (m || 0);
}
function inWindowUtc(bar, cfg) {
  const p = utcParts(bar.t);
  const mm = p.hour * 60 + p.minute;
  return cfg.session.windows.some((w) => {
    const a = toMin(w.start);
    const b = toMin(w.end);
    return a <= b ? mm >= a && mm < b : mm >= a || mm < b;
  });
}

/* ------------------------------------------------------------------ *
 * One decision cycle. Returns the action taken.
 * ------------------------------------------------------------------ */
/**
 * How many bars the runner needs before it will even ask the engine. Derived from the preset's own
 * lookbacks, and shared by cycle() and the parity comparison: the first time I hard-coded the
 * comparison boundary to `windowBars` instead of this number, a live trade that was perfectly legal
 * got reported as "extra" while a backtest trade that was correctly impossible got reported as
 * "excluded by warm-up". Two definitions of the same fact is how you get a green test that means
 * nothing.
 */
function minWarmupBars(cfg) {
  return Math.max(cfg.filters.volRegimeLookback || 0, cfg.filters.rangeLookbackBars, cfg.entries.maPeriod, cfg.filters.atrPeriod) + 40;
}

function cycle({ bars, i, cfg, broker, windowBars, newsBlocker }) {
  const bar = bars[i];
  const p = utcParts(bar.t);
  const dayKey = `${p.y}-${p.m}-${p.day}`;
  if (broker.dayKey !== dayKey) {
    broker.dayKey = dayKey;
    broker.todayKey = dayKey;
    broker.closedToday = [];
    broker.cidSeen = new Set();
    broker.journal.write('newDay', { symbol: cfg.symbol, reason: `equity ${broker.equity.toFixed(2)}` });
  }

  // ---- broker-side governors (source of truth, not the engine's window-scoped copy)
  if (cfg.risk.dailyLossCapPct > 0) {
    const cap = (cfg.risk.dailyLossCapPct / 100) * broker.equity;
    const dayPL = broker.closedToday.filter((c) => c.t === broker.todayKey).reduce((s, c) => s + c.pnl, 0);
    if (dayPL <= -cap) broker.haltedUntilDay = dayKey;
  }
  if (cfg.risk.maxConsecutiveLosses > 0) {
    const rev = [...broker.closedToday].reverse();
    let n = 0;
    for (const c of rev) {
      if (c.pnl <= 0) n++;
      else break;
    }
    if (n >= cfg.risk.maxConsecutiveLosses) broker.haltedUntilDay = dayKey;
  }
  if (cfg.risk.equityStopPct > 0 && broker.equity < broker.startEquity * (1 - cfg.risk.equityStopPct / 100)) {
    broker.journal.write('halt', { reason: `equity stop: ${broker.equity.toFixed(2)} < start ${broker.startEquity.toFixed(2)}`, symbol: cfg.symbol });
    broker.closeAll('equity stop', bar.c);
    return { act: 'halted', why: 'equity stop' };
  }
  if (broker.haltedUntilDay === dayKey) {
    broker.closeAll('halted: daily governor', bar.c);
    return { act: 'halted', why: 'daily governor' };
  }
  // EXITS ARE UNCONDITIONAL; ONLY ENTRIES ARE WINDOW-GATED.
  // This block used to sit *below* the outside-window early return, which meant closeAtWindowEnd
  // could never fire in live: by the time the runner noticed the window had closed it had already
  // bailed out of the cycle. The position then sat open into the 22:00 rollover and was flattened
  // by the spread kill-switch instead — a real bug that the backtest never showed because the
  // engine evaluates exits before it evaluates the window. The replay test is what surfaced it.
  if (broker.positions.length) {
    const p0 = broker.positions[0];
    const minsPerBar = ({ M1: 1, M5: 5, M15: 15, M30: 30, H1: 60 })[cfg.timeframe] || 15;
    const ageBars = Math.floor((bar.t - p0.openedBarT) / (minsPerBar * 60000));
    const pastDeadline = cfg.exits.hardTimeStopBars > 0 && ageBars >= cfg.exits.hardTimeStopBars;
    const outside = cfg.exits.closeAtWindowEnd && !inWindowUtc(bar, cfg);
    if (pastDeadline || outside) {
      broker.closeAll(pastDeadline ? `max lifetime (${ageBars} bars)` : 'window end', bar.c);
      return { act: 'close', why: pastDeadline ? 'time stop' : 'window end' };
    }
  }

  if (!inWindowUtc(bar, cfg)) return { act: 'idle', why: 'outside window' };
  // The gate lives in the engine (entries.direction); the runner does not duplicate it. If you
  // ever feel like re-checking it here, don't — duplicated gates are how drift comes back.
  if (cfg.session.days && !cfg.session.days[p.dow]) return { act: 'idle', why: 'day disabled' };
  const spreadPips = bar.spreadPips != null ? bar.spreadPips : cfg.costs.spreadPips;
  if (spreadPips * 10 > cfg.filters.maxSpreadPoints) return { act: 'idle', why: `spread ${spreadPips.toFixed(2)}p` };
  if (newsBlocker && newsBlocker(bar.t)) return { act: 'idle', why: 'news window' };
  if (broker.positions.length) return { act: 'hold', why: 'position open, deadline pending, guards at broker' };
  const cid = `FP-${cfg.symbol}-${dayKey}`;
  if (cfg.session.maxSetsPerDay > 0 && broker.positions.length + broker.closedToday.filter((c) => c.cid === cid).length >= cfg.session.maxSetsPerDay && broker.positions.length === 0) {
    return { act: 'idle', why: 'one set per day' };
  }

  // ---- ask the engine what should be open at this bar
  const from = Math.max(0, i - windowBars);
  const win = bars.slice(from, i + 1);
  const minWarmup = minWarmupBars(cfg);
  if (win.length < minWarmup) return { act: 'idle', why: `warmup ${win.length}/${minWarmup}` };

  let res;
  try {
    res = runBacktest(win, cfg, { startEquity: broker.equity, isNewsBlocked: newsBlocker });
  } catch (e) {
    if (e.code === 'UNSAFE_PRESET') {
      broker.journal.write('error', { reason: 'UNSAFE PRESET: ' + e.problems.join(' | '), symbol: cfg.symbol });
      broker.closeAll('unsafe preset', bar.c);
      return { act: 'error', why: 'unsafe preset' };
    }
    throw e;
  }
  const want = res.openAtEnd;

  // IMPORTANT: the engine's window run has no memory of OUR position, so `!want` is not an
  // exit signal — it is amnesia. Treating it as one cuts trades short (the replay test caught
  // exactly this). Exits are owned by (a) broker-side SL/TP and (b) the runner's own time guard.
  if (broker.positions.length) {
    const p0 = broker.positions[0];
    const minsPerBar = ({ M1: 1, M5: 5, M15: 15, M30: 30, H1: 60 })[cfg.timeframe] || 15;
    const ageBars = Math.floor((bar.t - p0.openedBarT) / (minsPerBar * 60000));
    const pastDeadline = cfg.exits.hardTimeStopBars > 0 && ageBars >= cfg.exits.hardTimeStopBars;
    const outside = cfg.exits.closeAtWindowEnd && !inWindowUtc(bar, cfg);
    if (pastDeadline || outside) {
      broker.closeAll(pastDeadline ? `max lifetime (${ageBars} bars)` : 'window end', bar.c);
      return { act: 'close', why: pastDeadline ? 'time stop' : 'window end' };
    }
    return { act: 'hold', why: `position open, ${ageBars}/${cfg.exits.hardTimeStopBars} bars, guards at broker` };
  }
  if (!want) return { act: 'idle', why: 'no signal' };
  if (want && !broker.positions.length) {
    // `openAtEnd` only means "the engine is holding something at the end of this window" — it may
    // have opened bars ago. Entering now would use stop/target levels derived from a DIFFERENT price,
    // which is worse than not trading: the position looks protected and is not. In a correct live
    // loop the engine's entry bar is always the current bar; anything else is a missed bar.
    const lastEv = res.log && res.log.length ? res.log[res.log.length - 1] : null;
    const openedHere = lastEv && lastEv.ev === 'open' && lastEv.t === bar.t;
    if (!openedHere) {
      broker.journal.write('skip', { symbol: cfg.symbol, reason: 'engine holds from an earlier bar in the window — refusing to enter late on stale SL/TP (a missed bar; check the poll cadence)', cid });
      return { act: 'stale', why: 'missed entry bar' };
    }
    const lots = want.lots;
    if (!(lots > 0)) return { act: 'idle', why: 'size rounds to zero' };
    const px = bar.c; // engine enters at bar close; keep the same convention in the runner
    broker.open({ dir: want.dir, lots, px, sl: want.sl, tp: want.tp, cid, reason: `engine ${want.dir} fade` });
    return { act: 'open', dir: want.dir, lots };
  }
  return { act: 'hold', why: broker.positions.length ? 'position open, guards intact' : 'no signal' };
}

/* ------------------------------------------------------------------ *
 * Replay: run the LIVE loop over history and diff it against the
 * backtest. This is the test that matters — if these two ever disagree,
 * the number you optimised is not the number you trade.
 * ------------------------------------------------------------------ */
function replay(cfg, opts) {
  const dataset = opts.csv ? fromCsv(fs.readFileSync(path.resolve(opts.csv), 'utf8'), { symbol: cfg.symbol }) : synthetic({ symbol: cfg.symbol, days: opts.days, timeframe: cfg.timeframe, seed: opts.seed, baseSpreadPips: cfg.costs.spreadPips });
  const bars = dataset.bars;
  const broker = new PaperBroker({ symbol: cfg.symbol, equity: opts.equity, cfg, stateFile: null });
  broker.journal = new Journal(null);
  const liveTrades = [];
  broker.onClose = (c) => {
    const sign = c.dir === 'long' ? 1 : -1;
    liveTrades.push({
      day: new Date(c.t).toISOString().slice(0, 10),
      entryDay: new Date(c.openedBarT).toISOString().slice(0, 10),
      dir: c.dir,
      // NET of the same round-trip cost the engine charges. Comparing a gross broker figure against
      // a net engine figure makes identical trades look different and trains you to ignore the table.
      livePips: +((((c.px - c.entryPx) / pipsToPrice(1, cfg.symbol)) * sign) - roundTripCostPips(c.exitBar || { t: c.t }, cfg)).toFixed(1),
      liveReason: c.reason,
      lots: c.lots,
      pnl: +c.pnl.toFixed(2),
    });
  };
  const windowBars = Number(opts.window || 1200);
  const newsBlocker = null;
  const liveActions = [];
  let skippedWarmup = 0;

  for (let i = 60; i < bars.length; i++) {
    broker.onBar(bars[i]);
    const r = cycle({ bars, i, cfg, broker, windowBars, newsBlocker });
    if (r.act === 'open') liveActions.push({ t: bars[i].t, dir: r.dir, lots: r.lots });
    if (/warmup/.test(r.why || '')) skippedWarmup++;
  }
  broker.closeAll('end of replay', bars[bars.length - 1].c);

  const bt = runBacktest(bars, cfg, { startEquity: opts.equity });
  const key = (t) => new Date(t).toISOString().slice(0, 16);
  // A process cannot trade before it has `--window` bars of history, so the oldest backtest trades
  // have no live counterpart by construction. Calling those "missed" blames the runner for the
  // inconvenience of having started at some point in time — and it hides real misses inside a number
  // that is never going to be zero. They are excluded, counted, and named.
  const firstTradeableT = bars[Math.min(bars.length - 1, minWarmupBars(cfg))].t;
  const warmupTrades = bt.trades.filter((t) => t.entryTime < firstTradeableT);
  const comparable = bt.trades.filter((t) => t.entryTime >= firstTradeableT);
  const btKeys = new Set(comparable.map((t) => key(t.entryTime)));
  const liveKeys = liveActions.map((a) => key(a.t));
  const missing = [...btKeys].filter((k) => !liveKeys.includes(k));
  const extra = liveKeys.filter((k) => !btKeys.has(k));

  console.log(`\n═══ live-loop replay vs backtest  (${dataset.source}, ${bars.length} bars, window ${windowBars}) ═══`);
  console.log(`  backtest entries   ${bt.trades.length}`);
  console.log(`  live-loop entries  ${liveActions.length}`);
  console.log(`  net (backtest)     ${bt.stats.netPnl}   win ${(bt.stats.winRate * 100).toFixed(1)}%  DD ${bt.stats.maxDrawdownPct}%`);
  console.log(`  net (live loop)    ${(broker.equity - broker.startEquity).toFixed(2)}   equity ${broker.equity.toFixed(2)}   (cash follows equity path; see note above)`);
  // Build the per-trade comparison FIRST — the summary lines below quote it, and referencing it
  // before it exists is a temporal-dead-zone crash that only shows up when a replay has trades.
  const liveByDay = new Map(liveTrades.map((a) => [a.entryDay, a]));
  const rows = [];
  for (const t of bt.trades) {
    const day = new Date(t.entryTime).toISOString().slice(0, 10);
    const L = liveByDay.get(day);
    if (!L) { rows.push([day, t.dir, `${t.pips}p ${t.reason}`, 'NEVER OPENED', '-']); continue; }
    // Compare PIPS and REASON. Cash is the wrong unit here: lot size is derived from live equity, so
    // two correct implementations on two different equity paths produce different dollars for the same
    // trade, and that difference would look like a logic bug. Pips are what the logic decides.
    const samePips = Math.abs(L.livePips - t.pips) < 0.15;
    // Lot size is compared explicitly rather than allowed to hide inside a cash tolerance: identical
    // pips with a different lot is a RISK difference, and "the dollars matched to within a rounding"
    // would have papered over exactly that for as long as the rounding stayed small.
    const lotStep = cfg.risk.lotStep || 0.01;
    const dLots = L.lots == null ? 0 : Math.abs(L.lots - t.lots);
    // One step of jitter is not a divergence: `lots = f(equity)` and equity differs by cents between a
    // fill priced off the engine and one booked by the broker, which is enough to flip a 0.4950 boundary
    // in a 0.01 grid. Anything BIGGER than a step means the two sides are sizing differently, and that
    // is a risk bug, so the tolerance is exactly one step — not "whatever makes the test green".
    const sameLots = dLots <= lotStep + 1e-9;
    const same = samePips && sameLots;
    const jitter = L.lots != null && dLots > 1e-9 && dLots <= lotStep + 1e-9;
    rows.push([day, t.dir, `${t.pips}p ${t.reason}`, `${L.livePips}p ${L.liveReason}${L.lots != null && dLots > 1e-9 ? ` lots ${L.lots}${jitter ? '~' : 'v'}${t.lots}` : ''}`, same ? '=' : '≠']);
  }
  const differ = rows.filter((r) => r[4] === '≠').length;
  const steps = rows.filter((r) => /lots [\d.]+~/.test(r[3])).length;
  if (steps) console.log(`  note: ${steps}/${rows.length} trade(s) sized one lot-step apart (equity cents at a step boundary) — reported, not hidden, and not a logic difference`);
  const gap = broker.equity - broker.startEquity - bt.stats.netPnl;

  console.log(`  P&L gap            ${gap.toFixed(2)}  (${differ}/${rows.length || 0} trades differ on pips/reason/lots; cash gap is informational, gated per-trade)`);
  if (rows.length && differ === rows.length) {
    // Report what was OBSERVED, not a remembered diagnosis — a hardcoded explanation goes stale the
    // moment one of the causes is fixed, and then it misleads instead of informs.
    const pairs = [...new Set(rows.map((r) => `${r[2].split(' ').pop()} → ${r[3].split(' ').slice(1).join(' ')}`))];
    console.log('  ⛔ EVERY trade settled differently. Entries align, exits do not, so this is not slippage.');
    console.log(`     exit reasons observed (backtest → live): ${pairs.join(' | ')}`);
    console.log('     Find the asymmetry between the two exit paths and fix it in the shared engine, not here.');
    console.log('     Do not fund this until the table reads mostly \"=\". Shipping a runner with a known-divergent');
    console.log('     exit path is defensible; calling that divergence noise is not.');
  } else if (rows.length) {
    console.log(`     ${differ}/${rows.length} differ. Bounded, explicable divergence is normal (the broker owns`);
    console.log('        real fills, the model gets one shot per bar). Growing or total divergence is not.');
  }
  console.log(`  extra entries in live loop    : ${extra.length} ${extra.length ? '<-- MUST BE ZERO: live traded where the model would not' : '✓'}`);
  if (rows.length) {
    console.log('\n  trade-by-trade (backtest → live loop):');
    for (const r of rows) console.log('   ' + r[0] + '  ' + String(r[1]).padEnd(5) + String(r[2]).padEnd(16) + String(r[3]).padEnd(16) + r[4]);
    console.log(`   ${differ}/${rows.length} settled differently. This comparison exists because the model and the\n   broker must agree; when they don't, the number you optimised is not the number you trade.\n   Read it as a to-do list, not as rounding.`);
  } else if (rows.length) {
    console.log('   ✓ model and broker agree trade for trade. That is the precondition for trusting any');
    console.log('     number in this repo — it is not a claim that the strategy is profitable.');
  }
  console.log(`  entries missed vs backtest    : ${missing.length}  (window-scoped state restarts each cycle: halts and one-per-day counts are re-derived, not remembered; warmup skipped ${skippedWarmup} cycles)`);
  if (warmupTrades.length) {
    console.log(`  excluded (runner warm-up)     : ${warmupTrades.length}  backtest trade(s) before bar ${minWarmupBars(cfg)} — a live process`);
    console.log(`                                cannot have taken them, so they are not a divergence. Not forgiven: not compared.`);
  }
  console.log(`\n  ${extra.length === 0 ? '✓ no drift in the dangerous direction: the live loop never invents a trade' : '✗ DRIFT — the runner and the judge disagree, stop'}`);
  // --strict used to fail only on extra entries, which let a runner with 100% divergent exits pass.
  // Once exact parity was achieved it became achievable, so the gate was raised to cover it: entries
  // AND exit reasons AND the P&L gap. A parity test that only checks half of a system is a shrug.
  // Only demand the cash match when both sides started from the same equity and the same trade —
  // i.e. when nothing was excluded. Otherwise the gate is pips/reasons, which is what logic controls.
  // Cash is NOT gated: equity paths legitimately differ by sub-tick rounding when fills are priced on
  // different tick counters, and a 0.05 tolerance on a 17-trade replay would be theatre. What IS gated
  // is per-trade pips, reason and lot size — if those match, the cash can only differ by rounding.
  if (opts.strict && (extra.length || differ || missing.length)) {
    process.exitCode = 1;
    console.log(`  ⛔ --strict failed: extra=${extra.length} missing=${missing.length} settledDifferently=${differ}` + (cashGate ? ` netGap=${gap.toFixed(2)}` : ` (cash not gated: ${warmupTrades.length} trade(s) excluded by warm-up)`));
  }
  return { bt, live: liveActions, extra, missing };
}

async function main() {
  const presetName = flag('preset', 'quiet-eve-low');
  const cfg = presets.load(presetName);
  assertSafe(cfg);
  const opts = {
    days: Number(flag('days', 120)),
    equity: Number(flag('equity', 10000)),
    seed: Number(flag('seed', 1337)),
    csv: flag('csv', null),
    window: flag('window', 1200),
    strict: !!flag('strict', false),
  };
  console.log(`\n  FuryPlus live runner · preset "${cfg.name}" · ${cfg.symbol} ${cfg.timeframe} · window ${cfg.session.windows.map((w) => w.start + '-' + w.end).join(',')} GMT`);
  if (flag('replay')) return void replay(cfg, opts);

  // live/paper loop against an adapter
  const brokerKind = flag('broker', 'paper');
  const stateFile = path.join(OUT, `${presetName}.${brokerKind}.state.json`);
  const journal = new Journal(path.join(OUT, `${presetName}.live-journal.csv`));
  const broker = new PaperBroker({ symbol: cfg.symbol, equity: opts.equity, cfg, stateFile, journal });
  if (brokerKind !== 'paper') {
    const adapter = require(`./adapters/${brokerKind}`);
    broker.journal.write('adapter', { reason: `${brokerKind} adapter loaded — verify against a PRACTICE account first; this path has not been exercised against the live API from this environment` });
    if (!adapter) throw new Error(`no adapter bot/adapters/${brokerKind}.js`);
  }
  const fetchBars = async () => {
    if (opts.csv) return fromCsv(fs.readFileSync(path.resolve(opts.csv), 'utf8'), { symbol: cfg.symbol }).bars;
    const ds = synthetic({ symbol: cfg.symbol, days: opts.days, timeframe: cfg.timeframe, seed: opts.seed, baseSpreadPips: cfg.costs.spreadPips });
    return ds.bars;
  };

  const tick = async () => {
    const bars = await fetchBars();
    const i = bars.length - 1;
    const r = cycle({ bars, i, cfg, broker, windowBars: Number(opts.window), newsBlocker: null });
    broker.save();
    return r;
  };

  if (flag('once')) {
    const r = await tick();
    console.log(`  cycle → ${r.act}${r.why ? ' (' + r.why + ')' : ''} · equity ${broker.equity.toFixed(2)}`);
    return;
  }
  console.log('  --loop: press Ctrl-C to stop. Polling every 60s for a new bar; in production wake on the candle close.');
  let lastT = 0;
  for (;;) {
    const bars = await fetchBars();
    if (bars.length && bars[bars.length - 1].t !== lastT) {
      lastT = bars[bars.length - 1].t;
      broker.onBar(bars[bars.length - 1]);
      const r = cycle({ bars, i: bars.length - 1, cfg, broker, windowBars: Number(opts.window), newsBlocker: null });
      broker.save();
      if (r.act !== 'idle' && r.act !== 'hold') console.log(`  → ${r.act} ${r.why || r.dir || ''}`);
    }
    if (!global.__testOneCycle) await new Promise((res) => setTimeout(res, 60000));
    else break;
  }
}

if (require.main === module) main().catch((e) => { console.error('\n  ✗ ' + e.message + '\n'); process.exit(1); });
module.exports = { cycle, PaperBroker, Journal, replay, inWindowUtc };
