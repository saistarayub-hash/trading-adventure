#!/usr/bin/env node
'use strict';
/**
 * Proves the synthetic generator is in the same magnitude range as a real FX feed, so that the
 * pip-denominated gates in presets (maxRangePips, minAtrPips, TP/SL) are not fiction.
 * If you change lib/data.js, run this. If a preset ever "only works on synthetic data", run this.
 */
const { synthetic } = require('../lib/data');

function sma(s, p) {
  const o = new Array(s.length).fill(NaN);
  let a = 0;
  for (let i = 0; i < s.length; i++) {
    a += s[i];
    if (i >= p) a -= s[i - p];
    if (i >= p) o[i] = a / p;
  }
  return o;
}
const q = (arr, p) => [...arr].sort((x, y) => x - y)[Math.floor(arr.length * p)];

function report(symbol, tf, days) {
  const pip = /JPY/i.test(symbol) ? 0.01 : 0.0001;
  const d = synthetic({ symbol, days, timeframe: tf, seed: 1337, baseSpreadPips: 0.35 });
  const bars = d.bars;
  const tr = bars.map((b, i) => (i ? Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)) : b.h - b.l));
  const at = sma(tr, 14);
  const atrTf = [];
  for (let i = 14; i < bars.length; i++) if (new Date(bars[i].t).getUTCHours() === 20) atrTf.push(at[i] / pip);
  const roll = [];
  const lb = 8;
  for (let i = lb; i < bars.length; i++) {
    if (new Date(bars[i].t).getUTCHours() !== 20) continue;
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = i - lb; k < i; k++) {
      hi = Math.max(hi, bars[k].h);
      lo = Math.min(lo, bars[k].l);
    }
    roll.push((hi - lo) / pip);
  }
  const byDay = {};
  const asian = {};
  for (const b of bars) {
    const dk = Math.floor(b.t / 86400000);
    const h = new Date(b.t).getUTCHours();
    const r = (byDay[dk] = byDay[dk] || { hi: -Infinity, lo: Infinity });
    r.hi = Math.max(r.hi, b.h);
    r.lo = Math.min(r.lo, b.l);
    if (h >= 0 && h < 7) {
      const a = (asian[dk] = asian[dk] || { hi: -Infinity, lo: Infinity, c: 0 });
      a.hi = Math.max(a.hi, b.h);
      a.lo = Math.min(a.lo, b.l);
      a.c++;
    }
  }
  const daily = Object.values(byDay).map((r) => (r.hi - r.lo) / pip);
  const asi = Object.values(asian).filter((r) => r.c > 4).map((r) => (r.hi - r.lo) / pip);
  const spreads = bars.map((b) => b.spreadPips);
  const rollover = bars.filter((b) => new Date(b.t).getUTCHours() === 22).map((b) => b.spreadPips);
  return {
    symbol,
    tf,
    bars: bars.length,
    spanDays: d.spanDays,
    atrTf_p50: +q(atrTf, 0.5).toFixed(2),
    rollRange_p50: +q(roll, 0.5).toFixed(1),
    rollRange_p90: +q(roll, 0.9).toFixed(1),
    asianRange_p50: +q(asi, 0.5).toFixed(1),
    dailyRange_p50: +q(daily, 0.5).toFixed(1),
    dailyRange_p90: +q(daily, 0.9).toFixed(1),
    spread_p50: +q(spreads, 0.5).toFixed(2),
    spread_rollover_p90: +q(rollover, 0.9).toFixed(2),
  };
}

// Targets are expressed partly as RATIOS, because that is how a real feed behaves and it is
// robust to whatever absolute vol we pick. Asian session ≈ 20-50% of the daily range on EURUSD;
// M15 ATR ≈ 5-9% of daily range; rollover spread 3-15x baseline.
const TARGETS = {
  EURUSD: { dailyRange_p50: [30, 55], asianRatio: [0.18, 0.5], atrRatio: [0.04, 0.1] },
  GBPUSD: { dailyRange_p50: [38, 70], asianRatio: [0.18, 0.5], atrRatio: [0.04, 0.1] },
};

let worst = 0;
for (const sym of ['EURUSD', 'GBPUSD']) {
  const r = report(sym, 'M15', 600);
  const t = TARGETS[sym];
  console.log(`\n${sym} (synthetic, 600d, M15, seed 1337)`);
  console.log(`  daily range p50/p90   ${r.dailyRange_p50} / ${r.dailyRange_p90} pips   target ${t.dailyRange_p50.join('-')}`);
  const asianRatio = r.asianRange_p50 / Math.max(r.dailyRange_p50, 0.01);
  const atrRatio = r.atrTf_p50 / Math.max(r.dailyRange_p50, 0.01);
  console.log(`  Asian 00-07 range     ${r.asianRange_p50} pips = ${(asianRatio * 100).toFixed(0)}% of daily   target ${(t.asianRatio[0] * 100).toFixed(0)}-${(t.asianRatio[1] * 100).toFixed(0)}%`);
  console.log(`  M15 ATR @20:00        ${r.atrTf_p50} pips = ${(atrRatio * 100).toFixed(1)}% of daily   target ${(t.atrRatio[0] * 100).toFixed(0)}-${(t.atrRatio[1] * 100).toFixed(0)}%`);
  console.log(`  rolling-8 range p50   ${r.rollRange_p50} (p90 ${r.rollRange_p90})`);
  const blowout = (r.spread_rollover_p90 / Math.max(r.spread_p50, 0.01)).toFixed(1);
  console.log(`  spread p50 / rollover p90  ${r.spread_p50} / ${r.spread_rollover_p90} pips  <-- ${blowout}x at rollover`);
  const checks = [
    [r.dailyRange_p50 >= t.dailyRange_p50[0] && r.dailyRange_p50 <= t.dailyRange_p50[1], 'daily range in band'],
    [asianRatio >= t.asianRatio[0] && asianRatio <= t.asianRatio[1], 'asian range ratio in band'],
    [atrRatio >= t.atrRatio[0] && atrRatio <= t.atrRatio[1], 'M15 ATR ratio in band'],
    [r.spread_rollover_p90 > r.spread_p50 * 3, 'rollover spread genuinely blows out'],
  ];
  for (const [ok, txt] of checks) {
    console.log(`   ${ok ? '✓' : '✗'} ${txt}`);
    if (!ok) worst++;
  }
}
console.log(worst ? `\n${worst} calibration check(s) failing — presets tuned on this data are not trustworthy.` : '\n✓ generator calibrated to documented real-world magnitudes');
process.exit(worst ? 1 : 0);
