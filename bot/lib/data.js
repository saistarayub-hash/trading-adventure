'use strict';
/**
 * Price data for the backtester.
 *
 *  A) synthetic()     — regime-switching FX-like series, fully deterministic (seeded).
 *  B) fromCsv()       — MT4/MT5 "Export History" bars, or ISO CSV. Use THIS for anything real.
 *
 * The generator deliberately reproduces the things that kill a low-volatility scalper in real
 * life, because a generator that only produces friendly conditions is how EA vendors end up with
 * 98% backtest win rates and 88% live ones:
 *   - intraday volatility seasonality (quiet Asia, expanding London, NY overlap)
 *   - bank-rollover spread widening (the hour this whole strategy family loves to trade in)
 *   - mean reversion on sub-daily bars (genuinely strong for majors — the "range" in range trading)
 *   - trend regimes that persist for days and hurt the fade
 *   - news impulses, weekend gaps, Fri-close/Sun-open structure
 *
 * CALIBRATION TARGETS (so this file is checkable rather than vibes, measured by `node
 * bot/tools/calibrate.js`): daily range p50 ≈ 35-50 pips EURUSD / 45-60 GBPUSD,
 * M15 ATR p50 ≈ 2-4 pips, Asian 00:00-07:00 range p50 ≈ 18-30 pips.
 * Still: SYNTHETIC. Proves mechanics. Proves nothing about live edge.
 */

const { mulberry32 } = require('./engine');

const MIN_MS = 60000;
const HOUR_MS = 3600000;

/** Relative per-bar volatility by UTC hour (majors). */
const HOURLY_VOL = [
  0.55, 0.45, 0.4, 0.4, 0.45, 0.5, 0.7, 1.15, 1.5, 1.45, 1.35, 1.3, 1.25, 1.4, 1.5, 1.35, 1.1, 0.85, 0.7, 0.65, 0.6, 0.6,
  0.5, 0.5,
];
/** Spread multiplier by UTC hour. 22:00 = bank rollover. */
const HOURLY_SPREAD = [1.1, 1.0, 1.0, 1.0, 1.0, 1.0, 1.2, 1.3, 1.1, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.1, 1.2, 1.4, 1.6, 2.4, 7.0, 2.0];

const HOURS_PER_TRADING_DAY = 23; // FX is not 24h: ~22:00 Sun -> 22:00 Fri

function tfMinutes(tf) {
  const map = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 };
  if (map[tf] == null) throw new Error('unsupported timeframe ' + tf);
  return map[tf];
}

/**
 * @param {object} o
 * @param {number} [o.days]          calendar days of real elapsed time
 * @param {number} [o.dailyVolPips]  target median DAILY RANGE (not sigma)
 * @param {number} [o.baseSpreadPips] ECN-ish baseline
 */
function synthetic(o = {}) {
  const {
    symbol = 'EURUSD',
    days = 730,
    timeframe = 'M15',
    seed = 1337,
    startPrice = /JPY/i.test(symbol) ? 145 : 1.085,
    dailyVolPips = /GBP/i.test(symbol) ? 52 : /JPY/i.test(symbol) ? 46 : 40,
    meanReversion = 0.06, // per hour, toward the slow equilibrium
    baseSpreadPips = 0.35,
    startMs = Date.UTC(2021, 0, 3, 22, 0), // a Sunday 22:00 open
  } = o;

  const rnd = mulberry32(seed);
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const pip = /JPY/i.test(symbol) ? 0.01 : 0.0001;
  const stepMin = tfMinutes(timeframe);
  // A median daily *range* of R pips ≈ a close-to-close daily sigma of ~0.62R (for a random walk,
  // range ≈ 1.6 sigma), spread over HOURS_PER_TRADING_DAY hours.
  const hourlySigma = (dailyVolPips * 0.62) / Math.sqrt(HOURS_PER_TRADING_DAY);
  const hourlySigmaPrice = hourlySigma * pip;
  const tfScale = Math.sqrt(stepMin / 60);

  let price = startPrice;
  let eq = startPrice;
  let trendLeft = 0;
  let trendSlope = 0;
  let regime = 'calm';
  let curDay = -1;
  let newsHourOfDay = -1;

  const bars = [];
  const events = [];
  const end = startMs + days * 86400000;

  for (let t = startMs; t < end; t += stepMin * MIN_MS) {
    const d = new Date(t);
    const hour = d.getUTCHours();
    const minute = d.getUTCMinutes();
    const dow = d.getUTCDay();
    const dayKey = Math.floor(t / 86400000);

    // ---- market structure: closed Fri 22:00 -> Sun 22:00; 22:00-05 rollover pause
    const weekend = dow === 6 || (dow === 0 && hour < 22) || (dow === 5 && hour >= 22);
    if (weekend) continue;
    if (hour === 22 && (stepMin < 60 ? minute < 5 : true)) continue;

    // ---- new trading day
    if (dayKey !== curDay) {
      curDay = dayKey;
      newsHourOfDay = rnd() < 0.14 ? 12 + Math.floor(rnd() * 4) : -1;
      if (rnd() < 0.055) {
        trendLeft = 10 + Math.floor(rnd() * 34);
        trendSlope = (rnd() < 0.5 ? -1 : 1) * hourlySigmaPrice * (0.45 + rnd() * 1.1);
        regime = 'trend';
        events.push({ t, kind: 'trend', dir: trendSlope > 0 ? 'up' : 'down' });
      }
      if (newsHourOfDay > 0) events.push({ t: t + newsHourOfDay * HOUR_MS, kind: 'news', pips: null });
      if (dow === 1) {
        const gap = gauss() * hourlySigmaPrice * 1.1 + trendSlope * 14;
        price += gap;
        eq += gap * 0.55;
      }
    }

    if (trendLeft > 0) {
      trendLeft--;
      if (trendLeft === 0) regime = 'calm';
    }
    const dtH = stepMin / 60;
    const volMult = HOURLY_VOL[hour] * (regime === 'trend' ? 1.25 : 1);
    const sigma = hourlySigmaPrice * tfScale * volMult;
    // OU discretisation: noise scales with sqrt(dt), the restoring drift scales with dt.
    let drift = (eq - price) * meanReversion * dtH;
    if (regime === 'trend') drift += trendSlope * dtH;

    const o_ = price;
    let c_ = price + drift + gauss() * sigma;
    if (newsHourOfDay >= 0 && hour === newsHourOfDay && minute < stepMin) {
      const shock = (rnd() < 0.5 ? -1 : 1) * sigma * (3.5 + rnd() * 6);
      c_ += shock;
      eq += shock * 0.4;
      const ev = events[events.length - 1];
      if (ev && ev.kind === 'news' && ev.pips == null) ev.pips = +(shock / pip).toFixed(1);
      else events.push({ t, kind: 'news', pips: +(shock / pip).toFixed(1) });
    }
    // real 15-min bars: high-low is ~1.3-1.5x |close-open|, so wicks are modest
    const wick = Math.abs(gauss()) * sigma * 0.32;
    bars.push({
      t,
      o: +o_.toFixed(6),
      h: +(Math.max(o_, c_) + wick).toFixed(6),
      l: +(Math.min(o_, c_) - wick).toFixed(6),
      c: +c_.toFixed(6),
      spreadPips: +(baseSpreadPips * HOURLY_SPREAD[hour] * (0.85 + rnd() * 0.4)).toFixed(2),
      volume: Math.round(420 * volMult * (0.6 + rnd())),
    });
    price = c_;
    // the equilibrium itself random-walks; keep it slow or there is no range to fade
    eq += gauss() * sigma * 0.3 + (regime === 'trend' ? trendSlope * dtH * 0.85 : 0);
  }

  const spanDays = bars.length ? (bars[bars.length - 1].t - bars[0].t) / 86400000 : 0;
  return {
    bars,
    events,
    symbol,
    timeframe,
    spanDays: +spanDays.toFixed(0),
    source: 'SYNTHETIC',
    note: 'mechanics demo only — not market data',
  };
}

/**
 * MT4/MT5 Strategy Tester / "Export History" CSV, and generic ISO CSV.
 *   date,time,open,high,low,close[,volume]   (MT4 writes "2024.01.05","00:00",...)
 *   iso,open,high,low,close[,volume]
 *   date,open,high,low,close,volume
 */
function fromCsv(text, opts = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  const rows = [];
  for (const raw of lines) {
    const f = raw.split(/[;,\t]/).map((s) => s.trim().replace(/^"|"$/g, ''));
    if (!f.length) continue;
    if (/^(date|time|open|symbol|tick|#)/i.test(f[0])) continue;
    let t;
    let rest;
    if (/^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}$/.test(f[0]) && /^\d{1,2}:\d{2}(:\d{2})?$/.test(f[1] || '')) {
      t = Date.UTC(...parseYmd(f[0]), ...parseHms(f[1]));
      rest = f.slice(2);
    } else if (/^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}[T ]\d{1,2}:\d{2}/.test(f[0])) {
      t = Date.parse(f[0].replace(' ', 'T').replace(/\./g, '-'));
      rest = f.slice(1);
    } else if (/^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}$/.test(f[0])) {
      t = Date.UTC(...parseYmd(f[0]));
      rest = f.slice(1);
    } else continue;
    if (!Number.isFinite(t)) continue;
    const [o, h, l, c] = rest.map(Number);
    if ([o, h, l, c].some((v) => !Number.isFinite(v))) continue;
    const spreadPips = rest[4] != null && Number.isFinite(+rest[4]) && +rest[4] > 0 ? +rest[4] : undefined;
    rows.push({ t, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, spreadPips });
  }
  rows.sort((a, b) => a.t - b.t);
  if (!rows.length) throw new Error('CSV parsed 0 usable rows — expected date,time,open,high,low,close');
  const spanDays = (rows[rows.length - 1].t - rows[0].t) / 86400000;
  return { bars: rows, events: [], symbol: opts.symbol || 'UNKNOWN', timeframe: guessTf(rows), spanDays: +spanDays.toFixed(0), source: 'CSV' };
}
function parseYmd(s) {
  const p = s.split(/[.\-/]/).map(Number);
  return [p[0], p[1] - 1, p[2]];
}
function parseHms(s) {
  const p = s.split(':').map(Number);
  return [p[0], p[1] || 0, p[2] || 0];
}
function guessTf(bars) {
  if (bars.length < 2) return 'UNKNOWN';
  const dt = (bars[1].t - bars[0].t) / MIN_MS;
  if (dt <= 2) return 'M1';
  if (dt <= 6) return 'M5';
  if (dt <= 16) return 'M15';
  if (dt <= 31) return 'M30';
  if (dt <= 61) return 'H1';
  if (dt <= 241) return 'H4';
  return 'D1';
}

module.exports = { synthetic, fromCsv, tfMinutes, HOUR_MS, MIN_MS, HOURLY_SPREAD, HOURLY_VOL, HOURS_PER_TRADING_DAY };
