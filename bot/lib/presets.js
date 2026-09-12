'use strict';
/** Preset loader + defaults. Presets ARE the strategy (that is the real lesson of this product category). */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'presets');

const DEFAULTS = {
  name: 'unnamed',
  symbol: 'EURUSD',
  timeframe: 'H1',
  // ---- clock ----
  session: {
    // All times GMT. In the live EA, `start`/`end` are matched against TimeGMT() and the
    // broker server offset is auto-detected and printed, because setting the GMT offset wrong
    // is the #1 way people silently break a session-filtered bot.
    windows: [{ start: '21:00', end: '22:00' }],
    days: [false, true, true, true, true, false, false], // Sun..Sat
    rolloverAt: '22:00',
    blackoutMinutes: 10,
    maxSetsPerDay: 1, // "One Set Trade Per Day" — theirs, kept because it is a real governor
  },
  // ---- gates (the part they claim as the edge) ----
  filters: {
    maxSpreadPoints: 5, // their documented default, in broker points (0.5 pips)
    spreadSpikeMult: 2, // their x_MaxSpread kill switch: cancel at MaxSpread x mult
    minAtrPips: 2, // a scalper needs *something* to move
    maxAtrPips: 999,
    atrPeriod: 14,
    requireFullHistory: true, // a regime filter with insufficient history must block, not pass
    volRegimeLookback: 400, // "low volatility" = ATR z-score below this
    maxAtrZ: -0.2,
    adxMax: 24, // ranging only
    rangeLookbackBars: 8, // used when rangeSource = 'rolling'
    rangeSource: 'session', // 'session' = the reference range's own hours, 'rolling' = N bars back
    sessionRange: { start: '00:00', end: '20:00' }, // must end at/before the entry window opens
    minRangeBars: 4,
    maxRangePips: 55,
    maxRangeAtrMult: 2.4,
    newsFilter: { enabled: false, currencies: ['USD'], importance: 'high', minutesBefore: 20, minutesAfter: 20 },
  },
  // ---- entry ----
  entries: {
    method: 'range_reversion', // range_reversion | open_breakout | ma_deviation
    direction: 'both', // 'both' | 'long' | 'short'  — mirrors InpTradeDirection in the EA
    trigger: 'level_cross', // level_cross (how these bots actually fire) | rejection (needs a wick+close candle)
    requireFirstTouch: false, // only fade the first touch of each edge per day
    bandBufferPips: 0.5,
    rejectionPips: 1.5,
    requireMomentum: true, // breakout must close in its own direction
    minBreakoutAtrZ: null, // e.g. 0.5 = require volatility expansion for a breakout
    breakoutAtrMult: 0.9,
    maPeriod: 20,
  },
  // ---- exits ----
  exits: {
    tpPips: 16,
    slPips: 16, // mandatory, never 0
    // Opt-IN, and deliberately off by default. Widening the stop to sit outside the range is a good
    // idea, but it changes the risk the break-even rail prices — the rail now uses the WIDENED stop, so
    // a preset that advertises SL 9 and silently allows 45 is refused rather than shipped. A library
    // whose pitch is "the rails are the product" must not default to 45 pips of surprise.
    slBeyondRangePips: 0,
    slMaxPips: 20, // the cap that makes the promise honest; 0 with widening enabled = unbounded = refused
    breakEvenTriggerPips: 8,
    breakEvenOffsetPips: 1,
    trailStartPips: 12,
    trailStepPips: 3,
    trailPips: 6,
    // 'worst' = when a bar tags both TP and SL, assume the stop. Never ship 'best' to anyone.
    sameBarTieBreak: 'worst',
    hardTimeStopBars: 12, // their trades run "15-45 minutes"; ours cannot live for days
    closeAtWindowEnd: true, // <-- the fix for "open since May 12th, TP is 1.46"
  },
  // ---- sizing + governors ----
  risk: {
    sizingMode: 'pctEquity', // fixed | cash | pctEquity
    fixedLots: 0.01,
    cashRiskPerTrade: 50,
    riskPct: 0.5,
    minLots: 0.01,
    maxLots: 5,
    lotStep: 0.01,
    dailyLossCapPct: 1.5,
    maxConsecutiveLosses: 3,
    equityStopPct: 8,
    maxOrders: 1, // >1 opens a grid: needs basketSlPips
    basketSlPips: 0,
    gridStepPips: 20,
    martingale: false,
    lotMultiplier: 1,
    maxSteps: 1,
    // Refuse any preset that needs more than this win rate to break even.
    maxBreakEvenWinRate: 0.72,
  },
  // ---- costs, deliberately pessimistic ----
  costs: {
    spreadPips: 0.6,
    commissionPips: 0.3, // ~$7/lot round trip expressed in pips, EURUSD-ish
    slippagePips: 0.4,
    rolloverSpreadMult: 5.5,
    rolloverSlippageMult: 3,
  },
  contractCashPerPipPerLot: 10, // USD per pip per lot, standard 100k USD-quoted
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}
function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : Array.isArray(v) ? [...v] : v;
  }
  return out;
}

function load(nameOrPath) {
  if (!nameOrPath) throw new Error('no preset given (see bot/presets/)');
  const p = nameOrPath.endsWith('.json')
    ? path.resolve(nameOrPath)
    : path.join(DIR, nameOrPath.endsWith('.set') ? nameOrPath : nameOrPath + '.json');
  if (!fs.existsSync(p)) throw new Error(`preset not found: ${p}\n  available: ${list().join(', ')}`);
  const user = JSON.parse(fs.readFileSync(p, 'utf8'));
  return deepMerge(DEFAULTS, user);
}

function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

module.exports = { load, list, DEFAULTS, deepMerge, DIR };
