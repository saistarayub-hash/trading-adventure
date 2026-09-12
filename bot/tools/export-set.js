#!/usr/bin/env node
'use strict';
/**
 * Emit config files from the JSON presets so the same preset drives the JS backtest and MetaTrader:
 *   out/<name>.mt4.set  — MT4 "Load" format (Name=Value)
 *   out/<name>.mt5.set  — MT5 "Load" format (Name=value||start||step||stop||digits||enabled)
 *   out/<name>.inputs.sh — shell/CLI form for the JS runner, for parity checks
 * Names map to the Inp* inputs in mql5/FuryPlus.mq5. Anything in the preset with no EA counterpart
 * is printed as a comment so the drift is visible rather than silent.
 */
const fs = require('fs');
const path = require('path');
const presets = require('../lib/presets');

const OUT = path.join(__dirname, '..', 'out');
fs.mkdirSync(OUT, { recursive: true });

// preset path -> MT5 input name (see mql5/FuryPlus.mq5)
const MAP = {
  'risk.fixedLots': ['InpFixedLots', 2],
  'risk.riskPct': ['InpRiskPerTradePct', 2],
  'risk.maxLots': ['InpMaxLots', 2],
  'exits.tpPips': ['InpTakeProfitPips', 1],
  'exits.slPips': ['InpStopLossPips', 1],
  'exits.slBeyondRangePips': ['InpSlBeyondRangePips', 1],
  'exits.slMaxPips': ['InpSlMaxPips', 1],
  'exits.breakEvenTriggerPips': ['InpBreakEvenTrigger', 1],
  'exits.breakEvenOffsetPips': ['InpBreakEvenOffset', 1],
  'exits.trailStartPips': ['InpTrailStartPips', 1],
  'exits.trailPips': ['InpTrailPips', 1],
  'exits.trailStepPips': ['InpTrailStepPips', 1],
  'exits.hardTimeStopBars': ['InpMaxHoldBars', 0],
  'filters.maxSpreadPoints': ['InpMaxSpreadPoints', 0],
  'filters.spreadSpikeMult': ['InpSpreadSpikeMult', 1],
  'filters.minAtrPips': ['InpMinAtrPips', 2],
  'filters.maxAtrZ': ['InpMaxAtrZ', 2],
  'filters.adxMax': ['InpMaxAdx', 1],
  'filters.rangeLookbackBars': ['InpRangeLookbackBars', 0],
  'filters.maxRangePips': ['InpMaxRangePips', 1],
  'filters.maxRangeAtrMult': ['InpMaxRangeAtrMult', 2],
  'filters.atrPeriod': ['InpAtrPeriod', 0],
  'risk.dailyLossCapPct': ['InpDailyLossCapPct', 2],
  'risk.maxConsecutiveLosses': ['InpMaxConsecLosses', 0],
  'risk.equityStopPct': ['InpEquityStopPct', 2],
  'risk.maxBreakEvenWinRate': ['InpMaxBreakEvenWinRate', 1],
};
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const tfToMin = (tf) => ({ M1: 1, M5: 5, M15: 15, M30: 30, H1: 60 }[tf] || 15);

// --- contract check: every name we emit must actually be an `input` in the EA source ---------
const EA = path.join(__dirname, '..', 'mql5', 'FuryPlus.mq5');
const eaInputs = new Set();
if (fs.existsSync(EA)) {
  for (const m of fs.readFileSync(EA, 'utf8').matchAll(/^\s*input\s+[\w<>]+\s+(\w+)/gm)) eaInputs.add(m[1]);
}
console.log(`  EA declares ${eaInputs.size} inputs`);

function assertNames(rows, who) {
  if (!eaInputs.size) return;
  const unknown = rows.map(([k]) => k).filter((k) => !eaInputs.has(k));
  if (unknown.length) {
    throw new Error(
      `${who}: emitting ${unknown.length} input name(s) the EA does not declare: ${unknown.join(', ')}\n` +
      `  Fix the MAP in tools/export-set.js or add the input to the EA — a .set file with a typo'd\n` +
      `  name loads silently with the WRONG DEFAULT, which is worse than failing loudly.`
    );
  }
  const unused = [...eaInputs].filter((k) => !rows.some(([n]) => n === k));
  if (unused.length) console.log(`  note: ${unused.length} EA input(s) not driven by presets: ${unused.join(', ')}`);
}

for (const name of presets.list()) {
  const cfg = presets.load(name);
  const rows = [];
  const missing = [];
  for (const [k, [inp, dec]] of Object.entries(MAP)) {
    const v = get(cfg, k);
    if (v === null || v === undefined) { missing.push(k); continue; }
    rows.push([inp, typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v), dec]);
  }
  // booleans / strings the EA has but the preset encodes structurally
  rows.push(['InpRequireHardStop', 'true', 0]);
  rows.push(['InpCloseAtWindowEnd', String(!!cfg.exits.closeAtWindowEnd), 0]);
  rows.push(['InpTimeRestriction', 'true', 0]);
  rows.push(['InpOneSetTradePerDay', String(!!cfg.session.maxSetsPerDay), 0]);
  rows.push(['InpUseIncrementalLot', String(cfg.risk.sizingMode === 'pctEquity'), 0]);
  rows.push(['InpAvoidNews', String(!!cfg.filters.newsFilter.enabled), 0]);
  rows.push(['InpNewsBeforeMin', String(cfg.filters.newsFilter.minutesBefore), 0]);
  rows.push(['InpNewsAfterMin', String(cfg.filters.newsFilter.minutesAfter), 0]);
  rows.push(['InpRolloverBlackoutMin', String(cfg.session.blackoutMinutes), 0]);
  rows.push(['InpRegimeTFMinutes', String(tfToMin(cfg.timeframe)), 0]);
  rows.push(['InpUseAsianRange', String(cfg.filters.rangeSource === 'session'), 0]);
  // 0=BOTH 1=LONG_ONLY 2=SHORT_ONLY, matching ENUM_FURY_DIR in the EA. This used to be a
  // hardcoded ternary with two identical branches — i.e. direction never actually reached MT5.
  rows.push(['InpTradeDirection', { both: '0', long: '1', short: '2' }[cfg.entries.direction] || '0', 0]);
  const w = cfg.session.windows[0];
  rows.push(['InpWindowStart', `"${w.start}"`, 0]);
  rows.push(['InpWindowEnd', `"${w.end}"`, 0]);
  // only emit the session range when it is actually the reference being used, so a .set file
  // never carries settings that look load-bearing but are ignored
  if (cfg.filters.rangeSource === 'session' && cfg.filters.sessionRange) {
    rows.push(['InpSessionRangeStart', `"${cfg.filters.sessionRange.start}"`, 0]);
    rows.push(['InpSessionRangeEnd', `"${cfg.filters.sessionRange.end}"`, 0]);
  }
  const days = cfg.session.days;
  ['InpTradeMonday', 'InpTradeTuesday', 'InpTradeWednesday', 'InpTradeThursday', 'InpTradeFriday'].forEach((inp, i) => {
    rows.push([inp, String(days[i + 1]), 0]);
  });

  const header = `; FuryPlus preset "${cfg.name}"\n; symbol ${cfg.symbol}  timeframe ${cfg.timeframe}  method ${cfg.entries.method}\n; TP ${cfg.exits.tpPips}p / SL ${cfg.exits.slPips}p — needs ${((cfg.exits.slPips + cfg.costs.spreadPips + cfg.costs.commissionPips + cfg.costs.slippagePips) / (cfg.exits.tpPips + cfg.exits.slPips) * 100).toFixed(1)}% win rate to break even\n; generated by bot/tools/export-set.js — re-generate after editing the JSON, do not hand-edit\n`;
  fs.writeFileSync(path.join(OUT, `${name}.mt4.set`), header + rows.map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  fs.writeFileSync(
    path.join(OUT, `${name}.mt5.set`),
    header + rows.map(([k, v, dec]) => `${k}=${v}||${v}||0||100000||${dec}||true`).join('\n') + '\n'
  );
  assertNames(rows, name);
  if (missing.length) console.log(`  ${name}: ${rows.length} inputs · ${missing.length} preset field(s) absent, skipped (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''})`);
  else console.log(`  ${name}: ${rows.length} inputs, clean`);
}
console.log(`\n  wrote *.mt4.set / *.mt5.set into bot/out/ — load in MT5 via the EA "Inputs…/Load" button.\n`);
