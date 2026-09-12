'use strict';
/**
 * FuryPlus — shared pure strategy engine (no I/O, no dependencies, deterministic).
 *
 * This file is the canonical specification of the strategy. The MQL5 Expert Advisor in
 * ../mql5/FuryPlus.mq5 implements the same state machine and uses the same parameter names,
 * so the backtest you can run here and the bot you deploy in MetaTrader are the same logic.
 *
 * What it is: a time-window-gated, low-volatility range scalper — the same family as Forex Fury.
 * What makes it "better" (each fix is aimed at a documented failure mode, see docs/teardown §6):
 *   1. hard stop loss is MANDATORY (assertSafe throws without it)      -> no death-by-stuck-trade
 *   2. optional forced close at window end                             -> no "open since May 12"
 *   3. break-even + trailing arming logic, single source of truth      -> consistent exits
 *   4. broker GMT offset auto-detected (live) / declared (backtest)    -> their #1 user error
 *   5. ATR z-score regime filter, isolatable                           -> we can prove the filter helps
 *   6. negative-R:R presets refused with a printed break-even win rate -> no 93%-win-rate lies
 *   7. grid/martingale only with a hard basket stop                    -> gated, never default
 *   8. cost model (spread schedule + commission + slippage + rollover) -> tester can't lie to us
 */

const PIP_FRACTION = 0.01; // JPY-quoted pairs

function isJpySymbol(symbol) {
  return /JPY/i.test(String(symbol || ''));
}
function pipSize(symbol) {
  return isJpySymbol(symbol) ? PIP_FRACTION : 0.0001;
}
/** Convert pips -> price distance. `points` are broker points (pip/10 on 5-digit). */
function pipsToPrice(pips, symbol) {
  return pips * pipSize(symbol);
}
function pointsToPips(points) {
  return points / 10;
}

/* ------------------------------------------------------------------ *
 * Indicators (Wilder-consistent where it matters)
 * ------------------------------------------------------------------ */

function trueRanges(bars) {
  const tr = new Array(bars.length).fill(0);
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      tr[i] = bars[i].h - bars[i].l;
      continue;
    }
    const pc = bars[i - 1].c;
    tr[i] = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc));
  }
  return tr;
}

/** Simple moving average of a numeric series, NaN until enough history. */
function sma(series, period) {
  const out = new Array(series.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i];
    if (i >= period) sum -= series[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Rolling mean/stdev of a series -> z-score of each value against its trailing window. */
/**
 * Trailing z-score. `requireFullSamples` is the honest default: a "400-bar norm" measured over 40 bars
 * is not that norm, and a gate that reads it as satisfied is a gate that is off. When required, bars
 * before the lookback is genuinely filled return NaN and the CALLER must treat NaN as "do not trade".
 */
function rollingZ(series, lookback, requireFullSamples = true) {
  const z = new Array(series.length).fill(NaN);
  for (let i = 0; i < series.length; i++) {
    const from = Math.max(0, i - lookback + 1);
    const n = i - from + 1;
    if (requireFullSamples ? n < lookback : n < Math.min(lookback, 30)) continue;
    let s = 0;
    for (let k = from; k <= i; k++) s += series[k];
    const mean = s / (i - from + 1);
    let v = 0;
    for (let k = from; k <= i; k++) v += (series[k] - mean) ** 2;
    const sd = Math.sqrt(v / (i - from + 1));
    z[i] = sd > 0 ? (series[i] - mean) / sd : 0;
  }
  return z;
}

/**
 * ADX built ONLY from trailing windows — every value at index i depends on bars[i-period..i]
 * and nothing earlier. This is deliberate and load-bearing: the live runner re-derives decisions
 * from a trailing window of history, so any indicator with path-dependent state (Wilder's
 * recursion seeds from the first element of the array) produces a DIFFERENT value for the same
 * bar depending on how much history you happened to pass in. That silently breaks the one
 * guarantee that matters here — "the backtest and the bot are the same strategy". The
 * bot-vs-backtest replay test exists to catch exactly this, and it caught it.
 */
function adxTrailing(bars, period = 14) {
  const n = bars.length;
  const tr = trueRanges(bars);
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = bars[i].h - bars[i - 1].h;
    const dn = bars[i - 1].l - bars[i].l;
    plusDM[i] = up > dn && up > 0 ? up : 0;
    minusDM[i] = dn > up && dn > 0 ? dn : 0;
  }
  // trailing simple averages, so smoothing depth is constant everywhere in the series
  const sTr = sma(tr, period);
  const sPlus = sma(plusDM, period);
  const sMinus = sma(minusDM, period);
  const dx = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(sTr[i]) || sTr[i] <= 0) continue;
    const pdi = (100 * sPlus[i]) / sTr[i];
    const mdi = (100 * sMinus[i]) / sTr[i];
    const denom = pdi + mdi;
    dx[i] = denom > 0 ? (100 * Math.abs(pdi - mdi)) / denom : 0;
  }
  return sma(dx.map((v) => (Number.isNaN(v) ? 0 : v)), period);
}

/* ------------------------------------------------------------------ *
 * Preset validation / safety rails
 * ------------------------------------------------------------------ */

/**
 * Throws when a preset is unsafe. This is the single biggest difference from
 * the product this is modelled on, whose default configs have historically been
 * shipped with tiny take-profits, distant-or-absent stops, and a resulting
 * break-even win rate above 90%.
 */
function assertSafe(cfg) {
  const problems = [];
  const x = cfg;

  if (!(x.exits.slPips > 0)) problems.push('exits.slPips must be > 0 — every position carries a hard stop loss, always.');
  if (!(x.exits.tpPips > 0)) problems.push('exits.tpPips must be > 0.');

  // Deliberate, hard difference from the product we studied. See bot/README.md "Design deltas".
  if (x.risk.maxOrders > 1) {
    problems.push(
      `risk.maxOrders=${x.risk.maxOrders} is refused. This engine takes ONE position per symbol per day. ` +
        `Averaging grids are why accounts in this category die: the documented failure is a trade left open ` +
        `waiting for a take-profit price the pair last saw years ago. Set maxOrders: 1.`
    );
  }
  if (x.risk.martingale || x.risk.lotMultiplier > 1 || x.risk.maxSteps > 1) {
    problems.push(
      'martingale / lot-multiplier recovery is refused outright. It converts a 3% drawdown profile into a ' +
        'total-loss profile; the vendor we studied ships it as an input but states it is not used on any of their own accounts.'
    );
  }
  // A scalper's fatal mode in this family is an unprotected open position, so at least one
  // of the two time guards must be on. (Their documented behaviour is "trades continue to run
  // outside the window until completed" + no time stop, which is exactly how a position ends up
  // open for weeks waiting for a price the pair last saw years ago.)
  if (!(x.exits.hardTimeStopBars > 0) && !x.exits.closeAtWindowEnd) {
    problems.push(
      'every position must be time-protected: set exits.hardTimeStopBars > 0 and/or exits.closeAtWindowEnd = true. ' +
        'A range-fade entry with no time guard is an open-ended bet that mean reversion eventually wins.'
    );
  }
  if (!(x.filters.maxSpreadPoints > 0)) problems.push('filters.maxSpreadPoints must be set — a scalper without a spread gate is a donation.');
  if (!Array.isArray(x.session.windows) || x.session.windows.length === 0) problems.push('session.windows must declare at least one window.');
  if (x.entries.method === 'range_reversion' || x.entries.method === 'open_breakout') {
    if (x.filters.rangeSource === 'session' && !x.filters.sessionRange) problems.push("rangeSource 'session' needs filters.sessionRange {start,end}.");
    if (x.filters.rangeSource === 'rolling' && !(x.filters.rangeLookbackBars >= 3)) problems.push("rangeLookbackBars must be >= 3 when rangeSource is 'rolling'.");
  }
  // LOOKAHEAD GUARD. If the reference range may contain bars from the entry window or later in the
  // same day, the "range" is partly built from the future and the whole backtest is fiction.
  // This is the most common structural bug in retail EA backtests, and it is completely silent.
  if (x.filters.rangeSource === 'session' && x.filters.sessionRange) {
    const toMin = (v) => {
      const parts = String(v).split(':').map(Number);
      return parts[0] * 60 + (parts[1] || 0);
    };
    const rEnd = toMin(x.filters.sessionRange.end);
    const rStart = toMin(x.filters.sessionRange.start);
    for (const w of x.session.windows || []) {
      const ws = toMin(w.start);
      const wrapped = rEnd < rStart; // range spans midnight
      const bad = wrapped ? false : rEnd > ws;
      if (bad) {
        problems.push(
          `LOOKAHEAD: reference range ${x.filters.sessionRange.start}-${x.filters.sessionRange.end} runs past the start of the ` +
            `entry window ${w.start}-${w.end}, so the range would be measured using prices at or after the trade. ` +
            `Set filters.sessionRange.end to ${w.start} or earlier.`
        );
      }
    }
  }

  // Cost-aware break-even win rate. Printed on every run, always, in the header.
  const cost = x.costs ? x.costs.spreadPips + x.costs.commissionPips + x.costs.slippagePips : 0;
  const beInfo = breakEvenFor(x);
  if (beInfo.be == null) {
    problems.push(
      `exits.slBeyondRangePips widens the stop to sit outside the range, but exits.slMaxPips is not set, ` +
        `so the real worst-case risk is unbounded and the break-even arithmetic would be fiction. ` +
        `Set slMaxPips to the largest stop you will actually accept — that number, not slPips, is your risk.`
    );
  }
  const beWinRate = beInfo.be == null ? 1 : beInfo.be;
  if (beWinRate > x.risk.maxBreakEvenWinRate) {
    problems.push(
      `preset rejected: TP ${x.exits.tpPips} / SL ${beInfo.sl}${beInfo.widened ? ` (widened from ${x.exits.slPips} by slBeyondRangePips)` : ''} + ${cost.toFixed(1)} cost needs a ` +
        `${(beWinRate * 100).toFixed(1)}% win rate just to break even (ceiling ${(x.risk.maxBreakEvenWinRate * 100).toFixed(0)}%). ` +
        `This is the classic ${"93% win rate but still lose"} shape — widen the TP, tighten the SL, or cut costs.`
    );
  }
  if (problems.length) {
    const err = new Error('UNSAFE PRESET: ' + cfg.name + '\n  - ' + problems.join('\n  - '));
    err.code = 'UNSAFE_PRESET';
    err.problems = problems;
    throw err;
  }
  // slPips here is the WORST-CASE stop the rail priced, so anything reading `safety` quotes the same
  // number the refusal used — a report that quietly reverts to the advertised stop is a report that
  // disagrees with the gate that let it through.
  return { ok: true, beWinRate, costPips: cost, slPips: beInfo.sl == null ? x.exits.slPips : beInfo.sl, widened: beInfo.widened };
}

/* ------------------------------------------------------------------ *
 * Session / clock helpers
 * ------------------------------------------------------------------ */

function utcParts(ms) {
  const d = new Date(ms);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    dow: d.getUTCDay(), // 0=Sun
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    doy: Math.floor(ms / 86400000),
  };
}
const hhmm = (v) => {
  if (typeof v === 'number') return { h: Math.floor(v), m: Math.round((v % 1) * 60) };
  const [h, m] = String(v).split(':').map(Number);
  return { h, m: m || 0 };
};
/** minutes since midnight GMT of the bar */
function barMinute(ms) {
  const p = utcParts(ms);
  return p.hour * 60 + p.minute;
}
function inWindow(minute, w) {
  const s = hhmm(w.start).h * 60 + hhmm(w.start).m;
  const e = hhmm(w.end).h * 60 + hhmm(w.end).m;
  const ws = w.usesServerTime; // server time -> shift by declared offset
  if (ws) minute = (minute + 24 * 60 - (w.gmtShiftMinutes || 0) + 24 * 60) % (24 * 60);
  return s <= e ? minute >= s && minute < e : minute >= s || minute < e; // wraps midnight
}
function inRolloverBlackout(minute, cfg) {
  const rollover = hhmm(cfg.session.rolloverAt).h * 60 + hhmm(cfg.session.rolloverAt).m;
  const diff = ((minute - rollover + 24 * 60 + 24 * 60) % (24 * 60)) - 0;
  const signed = diff > 12 * 60 ? diff - 24 * 60 : diff;
  return Math.abs(signed) <= cfg.session.blackoutMinutes;
}

/* ------------------------------------------------------------------ *
 * Cost model
 * ------------------------------------------------------------------ */

function costForBar(bar, i, cfg, series) {
  const c = cfg.costs;
  const minute = barMinute(bar.t);
  const rollover = hhmm(cfg.session.rolloverAt).h * 60 + hhmm(cfg.session.rolloverAt).m;
  const nearRollover = Math.abs(minute - rollover) <= cfg.session.blackoutMinutes;
  const spreadPips =
    bar.spreadPips != null ? bar.spreadPips : c.spreadPips * (nearRollover ? c.rolloverSpreadMult : 1);
  const slip = c.slippagePips * (nearRollover ? c.rolloverSlippageMult : 1);
  const half = spreadPips / 2 + slip;
  return { spreadPips, slippagePips: slip, costPips: half + c.commissionPips / 2, nearRollover };
}

/** Round-trip cost in pips, shared by the backtester AND the live/paper fill model.
 * If those two ever use different cost assumptions, every live-vs-backtest diff becomes
 * uninterpretable — you can't tell logic drift from fee drift. One function, one truth. */
function roundTripCostPips(bar, cfg) {
  const c = costForBar(bar, 0, cfg, {});
  return c.costPips;
}

/* ------------------------------------------------------------------ *
 * The engine
 * ------------------------------------------------------------------ */

/**
 * @param {Array<{t:number,o:number,h:number,l:number,c:number,spreadPips?:number}>} bars  ascending
 * @param {object} cfg  validated preset (see defaultConfig / presets/*.json)
 * @param {object} [opts] { startEquity, barsPerYear, onEvent }
 */
function runBacktest(bars, cfg, opts = {}) {
  const safety = assertSafe(cfg);
  const sym = cfg.symbol;
  const pip = pipSize(sym);
  const pipDist = pipsToPrice(1, sym);
  const atrPeriod = cfg.filters.atrPeriod;
  const tr = trueRanges(bars);
  const atr = sma(tr, atrPeriod);
  const needHistory = cfg.filters.requireFullHistory !== false;
  const atrZ = rollingZ(atr.map((v) => (Number.isNaN(v) ? 0 : v)), cfg.filters.volRegimeLookback, needHistory);
  const adx = cfg.filters.adxMax != null ? adxTrailing(bars, 14) : null;
  const midPeriod = cfg.entries.maPeriod;
  const mid = sma(bars.map((b) => b.c), midPeriod);

  const startEquity = opts.startEquity ?? 10000;
  const lotsPerUsdPerPip = 100000 * pip; // $/pip per lot for a USD-quoted pair (approx, documented)
  const cashPerPipPerLot = cfg.contractCashPerPipPerLot ?? lotsPerUsdPerPip;

  const trades = [];
  const log = [];
  const equityCurve = [];
  let equity = startEquity;
  let peakEquity = startEquity;
  let maxFloatingDrawdownPct = 0;
  let haltedUntilDay = -1;
  let lastSetDay = -1;
  let dayPL = 0;
  let dayDow = -1;
  let consecLosses = 0;
  let position = null;
  let basket = null;
  const skipped = { outsideWindow: 0, spread: 0, regime: 0, adx: 0, news: 0, halted: 0, dayCap: 0, dirFiltered: 0, other: 0 };
  // Audit trail: every in-window bar we chose NOT to trade, with the reason. "Why is the bot
  // sitting on its hands" is the #1 support question in this category, and it is also the only way
  // a marking view can show the filter working rather than just assert that it does.
  const audit = [];
  const markSkip = (t, why, extra) => {
    if (audit.length < 20000) audit.push({ t, why, ...(extra || {}) });
    skipped[why in skipped ? why : 'other']++;
  };

  const warmup = Math.max(atrPeriod, midPeriod, cfg.filters.rangeLookbackBars, 2 * 14, 30) + 2;

  // Reference range per UTC day, built only from bars inside the declared reference hours and
  // always ending before the entry window — so there is no lookahead into the day we trade.
  let touchedToday = new Set();
  const dayRange = new Map();
  if (cfg.filters.rangeSource === 'session') {
    const rs = hhmm(cfg.filters.sessionRange.start);
    const re = hhmm(cfg.filters.sessionRange.end);
    const sMin = rs.h * 60 + rs.m;
    const eMin = re.h * 60 + re.m;
    let curDay = null;
    let rhi = -Infinity;
    let rlo = Infinity;
    let cnt = 0;
    for (const b of bars) {
      const pp = utcParts(b.t);
      if (pp.doy !== curDay) {
        if (curDay !== null) dayRange.set(curDay, { hi: rhi, lo: rlo, count: cnt });
        curDay = pp.doy;
        rhi = -Infinity;
        rlo = Infinity;
        cnt = 0;
      }
      const m = pp.hour * 60 + pp.minute;
      const inside = sMin <= eMin ? m >= sMin && m < eMin : m >= sMin || m < eMin;
      if (inside) {
        rhi = Math.max(rhi, b.h);
        rlo = Math.min(rlo, b.l);
        cnt++;
      }
    }
    if (curDay !== null) dayRange.set(curDay, { hi: rhi, lo: rlo, count: cnt });
  }

  for (let i = warmup; i < bars.length; i++) {
    const bar = bars[i];
    const p = utcParts(bar.t);
    const newsBlocked = !!opts.isNewsBlocked && opts.isNewsBlocked(bar.t);
    // Computed ONCE per bar, before anything acts on it: entry gates and exit logic must see the
    // same spread state. When the spike was evaluated after exits (as it used to be), the engine
    // flattened one bar later than the broker on the same data — a pure ordering artefact that
    // showed up as "strategy divergence" in the replay test and wasted an hour of triage.
    const barCost = costForBar(bar, i, cfg, {});
    const spikeNow =
      cfg.filters.spreadSpikeMult > 0 &&
      cfg.filters.maxSpreadPoints > 0 &&
      barCost.spreadPips * 10 > cfg.filters.maxSpreadPoints * cfg.filters.spreadSpikeMult;
    if (p.doy !== dayDow) {
      dayDow = p.doy;
      dayPL = 0;
      touchedToday = new Set();
    }

    // ---- manage open position -------------------------------------------------
    if (position) {
      const sign = position.dir === 'long' ? 1 : -1;
      const favPips = ((sign === 1 ? bar.c : position.entry) - (sign === 1 ? position.entry : bar.c)) / pipDist;

      // floating drawdown of the open trade, as a % of peak equity — the number that
      // actually matters on a funded account, and the one marketing curves hide.
      const openPnlPips = favPips;
      if (openPnlPips < position.worstPips) position.worstPips = openPnlPips;
      {
        const dd = Math.max(0, -openPnlPips * position.lots * cashPerPipPerLot) / Math.max(peakEquity, 1e-9);
        if (dd > maxFloatingDrawdownPct) maxFloatingDrawdownPct = dd;
      }

      // break-even
      if (!position.beSet && cfg.exits.breakEvenTriggerPips > 0 && favPips >= cfg.exits.breakEvenTriggerPips) {
        position.beSet = true;
        position.sl = position.entry + sign * pipsToPrice(cfg.exits.breakEvenOffsetPips, sym);
      }
      // trailing
      if (cfg.exits.trailStartPips > 0 && favPips >= cfg.exits.trailStartPips) {
        const candidate =
          sign === 1
            ? bar.c - pipsToPrice(cfg.exits.trailPips, sym)
            : bar.c + pipsToPrice(cfg.exits.trailPips, sym);
        const stepped =
          sign === 1
            ? Math.max(position.sl || -Infinity, candidate - pipsToPrice(cfg.exits.trailStepPips, sym))
            : Math.min(position.sl || Infinity, candidate + pipsToPrice(cfg.exits.trailStepPips, sym));
        position.sl = stepped;
      }

      let hitTp = sign === 1 ? bar.h >= position.tp : bar.l <= position.tp;

      let hitSl = sign === 1 ? bar.l <= position.sl : bar.h >= position.sl;
      // THE MOST COMMON WAY A BACKTEST LIES: on a coarse bar, price can tag both the target and
      // the stop inside the same candle, and the ordering is unknowable from OHLC. Assuming the
      // favourable one inflates results silently — for a scalper with a small TP and a wide SL it
      // is the difference between "profitable" and fiction. Default is pessimistic.
      let ambiguous = false;
      if (hitTp && hitSl) {
        ambiguous = true;
        const wb = cfg.exits.sameBarTieBreak || 'worst';
        if (wb === 'worst') hitTp = false;
        else if (wb === 'best') hitSl = false;
        else if (wb === 'proximity') {
          const dTp = Math.abs(bar.o - position.tp);
          const dSl = Math.abs(bar.o - position.sl);
          if (dTp < dSl) hitSl = false;
          else hitTp = false;
        }
      }
      const ageBars = i - position.entryIndex;
      const timedOut = cfg.exits.hardTimeStopBars > 0 && ageBars >= cfg.exits.hardTimeStopBars;
      const windowEnd = cfg.exits.closeAtWindowEnd && !inWindow(barMinute(bar.t), cfg.session.windows[position.windowIdx ?? 0] || cfg.session.windows[0]);

      if (hitTp || hitSl || timedOut || windowEnd || spikeNow) {
        const exitRaw = hitTp
          ? position.tp
          : hitSl
            ? position.sl
            : bar.c; // timedOut / windowEnd / spread-spike all settle at the bar close: one rule, broker-replicable
        const exitPrice = exitRaw - sign * pipDist * barCost.costPips;
        const grossPips = ((exitPrice - position.entry) / pipDist) * sign;
        const pnlCash = grossPips * position.lots * cashPerPipPerLot;
        equity += pnlCash;
        dayPL += pnlCash;
        const trade = {
          id: trades.length + 1,
          symbol: sym,
          dir: position.dir,
          entryTime: bars[position.entryIndex].t,
          exitTime: bar.t,
          entry: position.entry,
          exit: exitPrice,
          lots: position.lots,
          pips: +grossPips.toFixed(1),
          pnl: +pnlCash.toFixed(2),
          barsHeld: ageBars,
          reason: hitTp
            ? 'TP'
            : hitSl
              ? position.beSet && grossPips >= 0
                ? 'BE'
                : 'SL'
              : timedOut
                ? 'TIMESTOP'
                : spikeNow
                  ? 'SPREAD_SPIKE'
                  : 'WINDOWEND',
          worstPips: +position.worstPips.toFixed(1),
          ambiguous,
          levels: position.levels,
          costPips: +barCost.costPips.toFixed(2),
          rolloverCrossed: barCost.nearRollover,
        };
        trades.push(trade);
        log.push({ t: bar.t, ev: 'close', trade });
        position = null;
        consecLosses = grossPips > 0 ? 0 : consecLosses + 1;

        // daily loss governor
        const lossCapCash = (cfg.risk.dailyLossCapPct / 100) * equity;
        if (lossCapCash > 0 && dayPL <= -lossCapCash) {
          haltedUntilDay = p.doy;
          skipped.dayCap++;
          log.push({ t: bar.t, ev: 'halt', why: 'daily loss cap' });
        }
        if (cfg.risk.maxConsecutiveLosses > 0 && consecLosses >= cfg.risk.maxConsecutiveLosses) {
          haltedUntilDay = p.doy;
          log.push({ t: bar.t, ev: 'halt', why: `${consecLosses} straight losers` });
          consecLosses = 0;
        }
        if (cfg.risk.equityStopPct > 0 && equity < startEquity * (1 - cfg.risk.equityStopPct / 100)) {
          log.push({ t: bar.t, ev: 'equityStop', equity });
          break;
        }
      }
    }

    // ---- new trade search -----------------------------------------------------
    const inWindowAny = cfg.session.windows.findIndex((w) => inWindow(barMinute(bar.t), w));
    if (inWindowAny < 0) {
      skipped.outsideWindow++;
      equityCurve.push({ t: bar.t, equity });
      continue;
    }
    if (cfg.session.days && cfg.session.days.length === 7 && !cfg.session.days[p.dow]) {
      markSkip(bar.t, 'day disabled');
      equityCurve.push({ t: bar.t, equity });
      continue;
    }
    if (inRolloverBlackout(barMinute(bar.t), cfg)) {
      markSkip(bar.t, 'rollover blackout');
      equityCurve.push({ t: bar.t, equity });
      continue;
    }
    if (haltedUntilDay === p.doy) {
      markSkip(bar.t, 'halted');
      equityCurve.push({ t: bar.t, equity });
      continue;
    }
    if (cfg.session.maxSetsPerDay > 0 && lastSetDay === p.doy) {
      markSkip(bar.t, 'one set per day');
      equityCurve.push({ t: bar.t, equity });
      continue;
    }
    if (position) {
      equityCurve.push({ t: bar.t, equity });
      continue;
    }
    if (newsBlocked) {
      markSkip(bar.t, 'news');
      equityCurve.push({ t: bar.t, equity });
      continue;
    }

    // spread gate. The spike case is deliberately NOT skipped here: a spike means "stop trading and
    // get out", handled above in the exit path, so it must not also masquerade as a missing entry.
    if (spikeNow) {
      markSkip(bar.t, 'spread spike');
      log.push({ t: bar.t, ev: 'killSwitch', why: 'spread spike' });
      equityCurve.push({ t: bar.t, equity });
      continue;
    }
    if (barCost.spreadPips * 10 > cfg.filters.maxSpreadPoints) {
      markSkip(bar.t, 'spread', { spreadPips: +barCost.spreadPips.toFixed(2) });
      equityCurve.push({ t: bar.t, equity });
      continue;
    }
    // regime gates
    const a = atr[i];
    if (Number.isNaN(a) || a <= 0) {
      markSkip(bar.t, 'no ATR');
      equityCurve.push({ t: bar.t, equity });
      continue;
    }
    if (cfg.filters.minAtrPips > 0 && a / pipDist < cfg.filters.minAtrPips) {
      markSkip(bar.t, 'ATR too small', { atrPips: +(a / pipDist).toFixed(2) });
      equityCurve.push({ t: bar.t, equity });
      continue;
    }
    if (cfg.filters.maxAtrZ != null) {
      if (Number.isNaN(atrZ[i])) {
        // "I have not seen enough of this market to call it calm" is a reason NOT to trade, not a free pass.
        if (needHistory) {
          markSkip(bar.t, `regime norm needs ${cfg.filters.volRegimeLookback} bars (have ${i + 1})`);
          equityCurve.push({ t: bar.t, equity });
          continue;
        }
      } else if (atrZ[i] > cfg.filters.maxAtrZ) {
        markSkip(bar.t, 'vol above norm', { atrZ: +atrZ[i].toFixed(2) });
        equityCurve.push({ t: bar.t, equity });
        continue;
      }
    }
    if (adx && cfg.filters.adxMax != null && Number.isNaN(adx[i]) && needHistory && i < 30) {
      markSkip(bar.t, 'adx not warmed');
      equityCurve.push({ t: bar.t, equity });
      continue;
    }
    if (adx && cfg.filters.adxMax != null && !Number.isNaN(adx[i]) && adx[i] > cfg.filters.adxMax) {
      markSkip(bar.t, 'adx trending', { adx: +adx[i].toFixed(1) });
      equityCurve.push({ t: bar.t, equity });
      continue;
    }

    // ---- reference range (the level the fade/breakout is measured against) ----
    let hi;
    let lo;
    let rangeCount;
    if (cfg.filters.rangeSource === 'session') {
      const r = dayRange.get(p.doy);
      if (!r || r.count < cfg.filters.minRangeBars) {
        markSkip(bar.t, 'no reference range');
        equityCurve.push({ t: bar.t, equity });
        continue;
      }
      hi = r.hi;
      lo = r.lo;
      rangeCount = r.count;
    } else {
      const lb = cfg.filters.rangeLookbackBars;
      hi = -Infinity;
      lo = Infinity;
      for (let k = i - lb; k < i; k++) {
        if (k < 0) continue;
        hi = Math.max(hi, bars[k].h);
        lo = Math.min(lo, bars[k].l);
      }
      rangeCount = lb;
    }
    const width = hi - lo;
    const midPrice = (hi + lo) / 2;
    if (!(width > 0)) {
      equityCurve.push({ t: bar.t, equity });
      continue;
    }
    const widthPips = width / pipDist;
    const rangey =
      widthPips <= cfg.filters.maxRangePips || width <= cfg.filters.maxRangeAtrMult * a;
    if (cfg.entries.method === 'range_reversion' && !rangey) {
      markSkip(bar.t, 'range too wide', { rangePips: +widthPips.toFixed(1) });
      equityCurve.push({ t: bar.t, equity });
      continue;
    }

    let dir = null;
    let entry = bar.c;
    let stopBase = null;
    const buf = pipsToPrice(cfg.entries.bandBufferPips, sym);
    if (cfg.entries.method === 'range_reversion') {
      if (cfg.entries.trigger === 'rejection') {
        // wick tags the edge, body closes back inside, direction confirms
        const touchLow = bar.l <= lo + buf;
        const touchHigh = bar.h >= hi - buf;
        const rejectUp = bar.c > lo + pipsToPrice(cfg.entries.rejectionPips, sym);
        const rejectDown = bar.c < hi - pipsToPrice(cfg.entries.rejectionPips, sym);
        if (touchLow && rejectUp && bar.c > bar.o) dir = 'long';
        else if (touchHigh && rejectDown && bar.c < bar.o) dir = 'short';
      } else {
        // level_cross: price trades through the level and we act on it. This is how the real
        // night scalpers fire — waiting for a "confirmation candle" on H1 inside a 1-hour
        // window produces about two trades a year, which is not a strategy, it is a demo.
        if (bar.c <= lo + buf) dir = 'long';
        else if (bar.c >= hi - buf) dir = 'short';
        if (dir && cfg.entries.requireFirstTouch && touchedToday.has(dir)) dir = null;
        if (dir) touchedToday.add(dir);
      }
      stopBase = dir === 'long' ? lo : dir === 'short' ? hi : null;
    } else if (cfg.entries.method === 'open_breakout') {
      // close beyond the reference range, with momentum and (optionally) volatility expansion
      const momentum = cfg.entries.requireMomentum ? (bar.c > bar.o ? 1 : -1) : 0;
      const expand = cfg.entries.minBreakoutAtrZ == null || Number.isNaN(atrZ[i]) || atrZ[i] >= cfg.entries.minBreakoutAtrZ;
      if (bar.c >= hi + buf && expand && momentum >= 0) dir = 'long';
      else if (bar.c <= lo - buf && expand && momentum <= 0) dir = 'short';
      stopBase = dir === 'long' ? lo : dir === 'short' ? hi : null;
    } else {
      // ma_deviation
      const dev = (bar.c - mid[i]) / pipDist;
      const threshold = cfg.entries.breakoutAtrMult * (a / pipDist);
      if (dev > threshold && bar.c > bar.o) dir = 'long';
      else if (dev < -threshold && bar.c < bar.o) dir = 'short';
    }

    // Direction gate. The EA has InpTradeDirection (both / long-only / short-only); the engine
    // lacked it, which meant a long-only preset could be "backtested" as both-directions and every
    // number from it described a bot that does not exist. Gates belong in the shared engine.
    const wantDir = cfg.entries.direction || 'both';
    if (dir && wantDir !== 'both' && dir !== wantDir) {
      skipped.dirFiltered++;
      markSkip(bar.t, `direction gate (${wantDir})`, { wanted: dir });
      dir = null;
    }

    if (!dir) {
      equityCurve.push({ t: bar.t, equity });
      continue;
    }

    // sizing
    let lots;
    const riskPct = cfg.risk.riskPct;
    if (cfg.risk.sizingMode === 'fixed') lots = cfg.risk.fixedLots;
    else if (cfg.risk.sizingMode === 'cash') lots = cfg.risk.cashRiskPerTrade / (cashPerPipPerLot * cfg.exits.slPips);
    else lots = (equity * (riskPct / 100)) / (cashPerPipPerLot * cfg.exits.slPips);
    lots = Math.max(cfg.risk.minLots, Math.min(cfg.risk.maxLots, Math.floor(lots / cfg.risk.lotStep) * cfg.risk.lotStep));
    if (!(lots > 0)) {
      markSkip(bar.t, 'size rounds to zero');
      equityCurve.push({ t: bar.t, equity });
      continue;
    }

    const sign = dir === 'long' ? 1 : -1;
    let slPips = cfg.exits.slPips;
    if (cfg.exits.slBeyondRangePips > 0 && stopBase != null) {
      const geo = Math.abs(entry - stopBase) / pipDist + cfg.exits.slBeyondRangePips;
      slPips = Math.min(cfg.exits.slMaxPips || geo, Math.max(slPips, geo));
    }
    position = {
      dir,
      entry,
      entryIndex: i,
      windowIdx: inWindowAny,
      // Marking layer needs the levels that *caused* the trade, not just the outcome. The engine
      // already computed all of this to decide, then threw it away — which is why an audit view
      // could not be built on top of it.
      levels: {
        rangeHi: hi,
        rangeLo: lo,
        rangeMid: midPrice,
        rangePips: +widthPips.toFixed(1),
        atrPips: +(a / pipDist).toFixed(1),
        atrZ: Number.isNaN(atrZ[i]) ? null : +atrZ[i].toFixed(2),
        adx: adx && !Number.isNaN(adx[i]) ? +adx[i].toFixed(1) : null,
        spreadPips: +barCost.spreadPips.toFixed(2),
        slPips: +slPips.toFixed(1),
        tpPips: +cfg.exits.tpPips.toFixed(1),
        method: cfg.entries.method,
        gate: wantDir,
      },
      lots,
      tp: entry + sign * pipsToPrice(cfg.exits.tpPips, sym),
      sl: entry - sign * pipsToPrice(slPips, sym),
      beSet: false,
      worstPips: 0,
    };
    lastSetDay = p.doy;
    consecLosses = consecLosses; // loss streak only advances on closes
    log.push({ t: bar.t, ev: 'open', dir, entry, lots, tp: position.tp, sl: position.sl, rangePips: +widthPips.toFixed(1), atrPips: +(a / pipDist).toFixed(1), spreadPips: +barCost.spreadPips.toFixed(1) });
    equityCurve.push({ t: bar.t, equity });
  }

  let maxDdPct = 0;
  let runPeak = equityCurve.length ? equityCurve[0].equity : startEquity;
  for (const e of equityCurve) {
    runPeak = Math.max(runPeak, e.equity);
    if (runPeak > 0) maxDdPct = Math.max(maxDdPct, (runPeak - e.equity) / runPeak);
  }
  peakEquity = runPeak;

  return {
    cfg,
    safety,
    trades,
    log,
    audit,
    equityCurve,
    skipped,
    stats: computeStats(trades, {
      startEquity,
      equity,
      maxDdPct,
      maxFloatingDrawdownPct,
      bars: bars.length,
      firstT: bars.length ? bars[0].t : 0,
      lastT: bars.length ? bars[bars.length - 1].t : 0,
    }),
    openAtEnd: position,
  };
}

/* ------------------------------------------------------------------ *
 * Stats — all of it derived, nothing smoothed
 * ------------------------------------------------------------------ */

function computeStats(trades, ctx) {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const net = grossWin - grossLoss;
  const pipsArr = trades.map((t) => t.pips);
  const days = Math.max(1, (ctx.lastT - ctx.firstT) / 86400000);
  const months = days / 30.44;
  const equitySeries = [ctx.startEquity, ctx.equity];
  const returns = trades.map((t) => t.pnl / Math.max(ctx.startEquity, 1e-9));
  const meanRet = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const sdRet =
    returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length - 1))
      : 0;
  const longestHoldBars = trades.reduce((m, t) => Math.max(m, t.barsHeld), 0);
  const worstFloat = trades.reduce((m, t) => Math.min(m, t.worstPips), 0);
  return {
    trades: n,
    winRate: n ? wins.length / n : 0,
    losses: losses.length,
    grossWin,
    grossLoss,
    netPnl: +net.toFixed(2),
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : grossWin > 0 ? Infinity : 0,
    expectancy: n ? +(net / n).toFixed(2) : 0,
    avgWinPips: wins.length ? +(wins.reduce((s, t) => s + t.pips, 0) / wins.length).toFixed(2) : 0,
    avgLossPips: losses.length ? +(losses.reduce((s, t) => s + t.pips, 0) / losses.length).toFixed(2) : 0,
    totalPips: +pipsArr.reduce((a, b) => a + b, 0).toFixed(1),
    maxDrawdownPct: +(ctx.maxDdPct * 100).toFixed(2),
    maxFloatingDrawdownPct: +(ctx.maxFloatingDrawdownPct * 100).toFixed(2),
    monthlyPct: months > 0 ? +((ctx.equity / ctx.startEquity - 1) * 100 / months).toFixed(2) : 0,
    daysHeld: +days.toFixed(0),
    tradesPerDay: +(n / days).toFixed(2),
    longestHoldBars,
    ambiguousExits: trades.filter((t) => t.ambiguous).length,
    worstFloatPips: +worstFloat.toFixed(1),
    sharpeLike: sdRet > 0 ? +(meanRet / sdRet) * Math.sqrt(Math.max(1, n / Math.max(1, months))) : 0,
    startEquity: ctx.startEquity,
    endEquity: +ctx.equity.toFixed(2),
    equityChangePct: +(((ctx.equity - ctx.startEquity) / ctx.startEquity) * 100).toFixed(2),
    recoveryFactor: ctx.maxDdPct > 0 ? +(net / (ctx.maxDdPct * ctx.startEquity)).toFixed(2) : Infinity,
  };
}

/**
 * Break-even win rate for a TP/SL pair, including round-trip costs.
 * Printed next to every win rate so a 93% claim can never be read without its ratio.
 */
/**
 * The stop this preset can ACTUALLY risk. When `slBeyondRangePips` is set the engine widens the stop
 * to sit outside the measured range, so the advertised `slPips` is a floor, not the risk. Pricing the
 * floor is how a preset passes a break-even rail while trading a shape the rail exists to refuse —
 * small target against a stop the geometry can stretch. `slMaxPips` is the cap that makes the promise
 * honest; with no cap there is no bound to price, and `sl` comes back null so callers must refuse.
 */
function effectiveSlPips(cfg) {
  const base = cfg.exits.slPips;
  if (!(cfg.exits.slBeyondRangePips > 0)) return { sl: base, capped: true, widened: false };
  const cap = cfg.exits.slMaxPips;
  if (!(cap > 0)) return { sl: null, capped: false, widened: true };
  return { sl: Math.max(base, cap), capped: true, widened: Math.max(base, cap) !== base };
}

/** Break-even win rate for a config, using the worst-case stop. Returns { be, sl, cost, widened, capped }. */
function breakEvenFor(cfg) {
  const cost = cfg.costs ? cfg.costs.spreadPips + cfg.costs.commissionPips + cfg.costs.slippagePips : 0;
  const e = effectiveSlPips(cfg);
  if (e.sl == null) return { be: null, sl: null, cost, widened: e.widened, capped: false };
  return { be: breakEvenWinRate(cfg.exits.tpPips, e.sl, cost), sl: e.sl, cost, widened: e.widened, capped: e.capped };
}

function breakEvenWinRate(tpPips, slPips, costPips = 0) {
  if (!(tpPips > 0) || !(slPips >= 0)) return NaN;
  return (slPips + costPips) / (tpPips + slPips);
}

/* ------------------------------------------------------------------ *
 * Monte Carlo — the "PDF of Monte Carlo testing" they advertise, actually done
 * ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap the trade sequence, plus optional adverse slippage perturbation,
 * to get a distribution of outcomes instead of one lucky path.
 */
function monteCarlo(trades, opts = {}) {
  const { iterations = 2000, startEquity = 10000, seed = 20260911, slippageJitter = 0.35, horizonTrades = null } = opts;
  if (!trades.length) return { iterations: 0, note: 'no trades' };
  const rnd = mulberry32(seed);
  const dd = [];
  const rets = [];
  let ruin = 0;
  const ruinPct = opts.ruinDrawdownPct ?? 30;
  for (let it = 0; it < iterations; it++) {
    let eq = startEquity;
    let peak = eq;
    let worstDD = 0;
    const len = horizonTrades ? Math.min(horizonTrades, trades.length) : trades.length;
    for (let k = 0; k < len; k++) {
      const t = trades[Math.floor(rnd() * trades.length)];
      const jitter = 1 + (rnd() - 0.5) * 2 * slippageJitter;
      const pnl = t.pnl * jitter;
      eq += pnl;
      peak = Math.max(peak, eq);
      if (peak > 0) worstDD = Math.max(worstDD, (peak - eq) / peak);
      if (worstDD * 100 >= ruinPct) {
        ruin++;
        break;
      }
    }
    dd.push(worstDD * 100);
    rets.push(((eq - startEquity) / startEquity) * 100);
  }
  const q = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  return {
    iterations,
    medianReturnPct: +q(rets, 0.5).toFixed(2),
    p05ReturnPct: +q(rets, 0.05).toFixed(2),
    p95ReturnPct: +q(rets, 0.95).toFixed(2),
    pctNegative: +(rets.filter((r) => r < 0).length / rets.length * 100).toFixed(1),
    medianMaxDdPct: +q(dd, 0.5).toFixed(2),
    p95MaxDdPct: +q(dd, 0.95).toFixed(2),
    worstMaxDdPct: +Math.max(...dd).toFixed(2),
    chanceOfRuinedDD: +(ruin / iterations * 100).toFixed(1),
    ruinThresholdPct: ruinPct,
  };
}

/** In-sample / out-of-sample split. Overfit .set files die here, which is the point. */
function walkForward(trades, cfg, { oosRatio = 0.3, startEquity = 10000, barsPerYear = 252 } = {}) {
  if (trades.length < 20) return { note: 'too few trades to split' };
  const cut = Math.floor(trades.length * (1 - oosRatio));
  const mk = (slice) => {
    let eq = startEquity;
    let peak = eq;
    let worst = 0;
    for (const t of slice) {
      eq += t.pnl;
      peak = Math.max(peak, eq);
      worst = Math.max(worst, (peak - eq) / peak);
    }
    return computeStats(slice, {
      startEquity,
      equity: eq,
      maxDdPct: worst,
      maxFloatingDrawdownPct: worst,
      firstT: slice[0].entryTime,
      lastT: slice[slice.length - 1].exitTime,
    });
  };
  const insample = mk(trades.slice(0, cut));
  const oos = mk(trades.slice(cut));
  const decay = insample.profitFactor > 0 ? oos.profitFactor / insample.profitFactor : NaN;
  return {
    insample,
    oos,
    profitFactorDecay: Number.isFinite(decay) ? +decay.toFixed(2) : null,
    verdict:
      !Number.isFinite(decay)
        ? 'inconclusive'
        : decay >= 0.85
          ? 'holds up out of sample'
          : decay >= 0.6
            ? 'degrades out of sample — tune, do not deploy'
            : 'overfit — this preset is a curve, not a strategy',
  };
}

function fmtStatsTable(result, cfg) {
  const s = result.stats;
  const be = result.safety.beWinRate;
  const line = (k, v) => `  ${k.padEnd(26)}${v}`;
  const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : String(x));
  return [
    `  preset              ${cfg.name}`,
    `  symbol              ${cfg.symbol}   ${cfg.entries.method}`,
    `  geometry            TP ${cfg.exits.tpPips}p / SL ${cfg.exits.slPips}p  (R:R ${(cfg.exits.tpPips / cfg.exits.slPips).toFixed(2)})`,
    `  cost per trade      ~${result.safety.costPips.toFixed(2)} pips`,
    `  BREAK-EVEN WR       ${pct(be)}   <-- a win rate below this loses money, full stop`,
    `  ---`,
    `  trades              ${s.trades}  (${s.tradesPerDay}/day over ${s.daysHeld}d)`,
    `  win rate            ${pct(s.winRate)}`,
    `  net P&L             ${s.netPnl} on ${s.startEquity}  (${s.equityChangePct}%)`,
    `  profit factor       ${s.profitFactor}`,
    `  expectancy          ${s.expectancy} /trade`,
    `  avg win / loss      ${s.avgWinPips}p / ${s.avgLossPips}p`,
    `  max drawdown        ${s.maxDrawdownPct}%   (floating ${s.maxFloatingDrawdownPct}%)`,
    `  recovery factor     ${s.recoveryFactor}`,
    `  monthly             ${s.monthlyPct}%/mo`,
    `  worst float         ${s.worstFloatPips}p, longest hold ${s.longestHoldBars} bars`,
    `  same-bar TP+SL      ${s.ambiguousExits}/${s.trades} trades where the bar touched BOTH target and stop (${(cfg.exits.sameBarTieBreak || 'worst').toUpperCase()} assumed)${s.ambiguousExits ? '  <-- see --optimistic' : ''}`,
    `  skipped by filter   ${JSON.stringify(result.skipped)}`,
  ].join('\n');
}

module.exports = {
  costForBar,
  roundTripCostPips,
  pipSize,
  pipsToPrice,
  pointsToPips,
  assertSafe,
  runBacktest,
  computeStats,
  breakEvenWinRate,
  breakEvenFor,
  effectiveSlPips,
  monteCarlo,
  walkForward,
  mulberry32,
  fmtStatsTable,
  utcParts,
  inWindow,
};
