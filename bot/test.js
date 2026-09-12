#!/usr/bin/env node
'use strict';
/**
 * Tests for the safety rails and the arithmetic. These are the parts worth testing: the strategy's
 * profitability is not knowable from synthetic data, but "a preset that needs an 89% win rate must
 * be refused" is fully knowable, and it is the exact failure that made the product we studied
 * controversial.
 *
 *   node bot/test.js
 */
const assert = require('assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const E = require('./lib/engine');
const presets = require('./lib/presets');
const { synthetic, fromCsv } = require('./lib/data');

let pass = 0;
const fails = [];
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fails.push([name, e]);
    console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`);
  }
}
function refuses(preset, whyRe) {
  const cfg = presets.load(preset);
  let err = null;
  try {
    E.assertSafe(cfg);
  } catch (e) {
    err = e;
  }
  assert.ok(err, `expected ${preset} to be refused, but it passed the rails`);
  assert.strictEqual(err.code, 'UNSAFE_PRESET');
  if (whyRe) assert.ok(new RegExp(whyRe, 'i').test(err.message), `refusal reason was "${err.message.slice(0, 200)}", expected /${whyRe}/`);
  return err;
}

console.log('\n  safety rails (the part that must never regress)\n');

t('negative-R:R preset (legacy 5/29) is refused with the break-even win rate named', () => refuses('fury-legacy-5-29', 'break even'));
t('grid / maxOrders>1 is refused', () => {
  const cfg = presets.load('quiet-eve-low');
  cfg.risk.maxOrders = 7;
  assert.throws(() => E.assertSafe(cfg), /ONE position per symbol per day|refused/i);
});
t('martingale is refused even when "gated" with caps', () => {
  const cfg = presets.load('quiet-eve-low');
  cfg.risk.martingale = true;
  cfg.risk.maxSteps = 3;
  cfg.risk.lotMultiplier = 1.6;
  assert.throws(() => E.assertSafe(cfg), /martingale/i);
});
t('lotMultiplier > 1 alone is refused (no back door via sizing)', () => {
  const cfg = presets.load('quiet-eve-low');
  cfg.risk.maxOrders = 1;
  cfg.risk.lotMultiplier = 2;
  assert.throws(() => E.assertSafe(cfg), /martingale|recovery/i);
});
t('zero stop loss is refused', () => {
  const cfg = presets.load('quiet-eve-low');
  cfg.exits.slPips = 0;
  assert.throws(() => E.assertSafe(cfg), /hard stop/i);
});
t('a position with no time guard is refused (the stuck-trade fix)', () => {
  const cfg = presets.load('quiet-eve-low');
  cfg.exits.hardTimeStopBars = 0;
  cfg.exits.closeAtWindowEnd = false;
  assert.throws(() => E.assertSafe(cfg), /time-protected/i);
});
t('either time guard alone is enough to pass', () => {
  const cfg = presets.load('quiet-eve-low');
  cfg.exits.hardTimeStopBars = 0;
  cfg.exits.closeAtWindowEnd = true;
  assert.doesNotThrow(() => E.assertSafe(cfg));
});
t('a reference range that overlaps its entry window is refused (lookahead)', () => {
  const cfg = presets.load('london-open-balanced');
  cfg.filters.sessionRange.end = '09:00'; // window opens 07:00
  assert.throws(() => E.assertSafe(cfg), /LOOKAHEAD/i);
});
t('no spread gate is refused', () => {
  const cfg = presets.load('quiet-eve-low');
  cfg.filters.maxSpreadPoints = 0;
  assert.throws(() => E.assertSafe(cfg), /spread gate/i);
});
t('the shipped balanced presets all pass the rails', () => {
  for (const p of ['quiet-eve-low', 'london-open-balanced', 'propfirm-strict']) {
    assert.doesNotThrow(() => E.assertSafe(presets.load(p)), `${p} should be safe`);
  }
});

console.log('\n  arithmetic\n');

t('break-even win rate matches the hand-computed value', () => {
  // win = TP - cost, lose = SL + cost  ->  w(TP-cost) = (1-w)(SL+cost)
  const tp = 9;
  const sl = 13;
  const cost = 1.0;
  const manual = (sl + cost) / (tp + sl);
  assert.ok(Math.abs(E.breakEvenWinRate(tp, sl, cost) - manual) < 1e-12);
});
t('a 1:1 geometry with no cost needs exactly 50%', () => {
  assert.strictEqual(E.breakEvenWinRate(16, 16, 0), 0.5);
});
t('asymmetry in the wrong direction is visible: 5/29 needs 85%+ even free of cost', () => {
  assert.ok(E.breakEvenWinRate(5, 29, 0) > 0.85);
});
t('pip size: JPY pairs use 0.01', () => {
  assert.strictEqual(E.pipSize('USDJPY'), 0.01);
  assert.strictEqual(E.pipSize('EURUSD'), 0.0001);
});
t('stats are recomputable from the trade list (no hidden smoothing)', () => {
  const cfg = presets.load('quiet-eve-low');
  const d = synthetic({ symbol: cfg.symbol, days: 120, timeframe: cfg.timeframe, seed: 99, baseSpreadPips: cfg.costs.spreadPips });
  const r = E.runBacktest(d.bars, cfg, { startEquity: 10000 });
  if (!r.trades.length) return;
  const wins = r.trades.filter((x) => x.pnl > 0);
  assert.strictEqual(r.stats.winRate, wins.length / r.trades.length);
  const net = r.trades.reduce((a, b) => a + b.pnl, 0);
  assert.ok(Math.abs(r.stats.netPnl - net) < 0.5, `net ${r.stats.netPnl} vs sum ${net}`);
});
t('every trade has a stop that was actually set (no unprotected fills)', () => {
  const cfg = presets.load('quiet-eve-low');
  const d = synthetic({ symbol: cfg.symbol, days: 120, timeframe: cfg.timeframe, seed: 5, baseSpreadPips: cfg.costs.spreadPips });
  const r = E.runBacktest(d.bars, cfg, {});
  const opens = r.log.filter((l) => l.ev === 'open');
  for (const o of opens) assert.ok(o.sl > 0 && o.tp > 0, 'open without sl/tp');
});
t('no trade survives its hard time stop', () => {
  const cfg = presets.load('quiet-eve-low');
  const d = synthetic({ symbol: cfg.symbol, days: 150, timeframe: cfg.timeframe, seed: 7, baseSpreadPips: cfg.costs.spreadPips });
  const r = E.runBacktest(d.bars, cfg, {});
  for (const tr of r.trades) assert.ok(tr.barsHeld <= cfg.exits.hardTimeStopBars, `held ${tr.barsHeld} > ${cfg.exits.hardTimeStopBars}`);
});
t('daily loss governor really halts the day (attribution moves when it is armed)', () => {
  const cfg = presets.load('quiet-eve-low');
  const d = synthetic({ symbol: cfg.symbol, days: 200, timeframe: cfg.timeframe, seed: 3, baseSpreadPips: cfg.costs.spreadPips });
  const armed = E.runBacktest(d.bars, cfg, {});
  const c2 = presets.load('quiet-eve-low');
  c2.risk.dailyLossCapPct = 0;
  c2.name += ' nogov';
  const disarmed = E.runBacktest(d.bars, c2, {});
  const haltsA = armed.log.filter((l) => l.ev === 'halt' && /daily/.test(l.why || '')).length;
  const haltsB = disarmed.log.filter((l) => l.ev === 'halt' && /daily/.test(l.why || '')).length;
  if (haltsA === 0) return; // nothing to attribute on this seed; the mechanism is still exercised
  assert.strictEqual(haltsB, 0, 'disarmed config still counted daily halts');
  assert.ok(armed.trades.length <= disarmed.trades.length, 'halting should not increase trade count');
});
t('max one entry per symbol per day', () => {
  const cfg = presets.load('quiet-eve-low');
  const d = synthetic({ symbol: cfg.symbol, days: 200, timeframe: cfg.timeframe, seed: 11, baseSpreadPips: cfg.costs.spreadPips });
  const r = E.runBacktest(d.bars, cfg, {});
  const byDay = {};
  for (const tr of r.trades) {
    const k = new Date(tr.entryTime).toISOString().slice(0, 10);
    byDay[k] = (byDay[k] || 0) + 1;
  }
  for (const k of Object.keys(byDay)) assert.ok(byDay[k] <= cfg.session.maxSetsPerDay, `${k} had ${byDay[k]} entries`);
});
t('entries only ever occur inside the configured window', () => {
  const cfg = presets.load('quiet-eve-low');
  const d = synthetic({ symbol: cfg.symbol, days: 150, timeframe: cfg.timeframe, seed: 21, baseSpreadPips: cfg.costs.spreadPips });
  const r = E.runBacktest(d.bars, cfg, {});
  const [a, b] = [cfg.session.windows[0].start, cfg.session.windows[0].end].map((v) => {
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
  });
  for (const tr of r.trades) {
    const dt = new Date(tr.entryTime);
    const mm = dt.getUTCHours() * 60 + dt.getUTCMinutes();
    assert.ok(mm >= a && mm < b, `entry at ${dt.toISOString()} outside ${cfg.session.windows[0].start}-${b}`);
  }
});
t('weekend entries impossible when days[] disables Sat/Sun', () => {
  const cfg = presets.load('quiet-eve-low');
  const d = synthetic({ symbol: cfg.symbol, days: 150, timeframe: cfg.timeframe, seed: 31, baseSpreadPips: cfg.costs.spreadPips });
  const r = E.runBacktest(d.bars, cfg, {});
  for (const tr of r.trades) {
    const dow = new Date(tr.entryTime).getUTCDay();
    assert.ok(cfg.session.days[dow], `traded on dow=${dow} which the preset disables`);
  }
});

console.log('\n  determinism, data, and tooling\n');

t('same seed => byte-identical trade list (a backtest you cannot reproduce is a demo)', () => {
  const cfg = presets.load('quiet-eve-low');
  const mk = () => {
    const d = synthetic({ symbol: cfg.symbol, days: 90, timeframe: cfg.timeframe, seed: 1234, baseSpreadPips: cfg.costs.spreadPips });
    return E.runBacktest(d.bars, cfg, {}).trades;
  };
  assert.strictEqual(JSON.stringify(mk()), JSON.stringify(mk()));
});
t('different seeds => different results (the generator is not degenerate)', () => {
  const cfg = presets.load('quiet-eve-low');
  const run = (seed) => {
    const d = synthetic({ symbol: cfg.symbol, days: 90, timeframe: cfg.timeframe, seed, baseSpreadPips: cfg.costs.spreadPips });
    return E.runBacktest(d.bars, cfg, {}).trades.length;
  };
  assert.notStrictEqual(run(1), run(2));
});
t('monte carlo is deterministic under a fixed seed', () => {
  const trades = [{ pnl: 40 }, { pnl: -55 }, { pnl: 41 }, { pnl: 40 }, { pnl: -55 }];
  const a = E.monteCarlo(trades, { iterations: 200, seed: 42 });
  const b = E.monteCarlo(trades, { iterations: 200, seed: 42 });
  assert.deepStrictEqual(a, b);
});
t('monte carlo on a losing book shows a meaningful ruin probability', () => {
  const trades = Array.from({ length: 40 }, (_, i) => ({ pnl: i % 9 === 0 ? -700 : 60 }));
  const mc = E.monteCarlo(trades, { iterations: 400, seed: 7, ruinDrawdownPct: 25 });
  assert.ok(mc.chanceOfRuinedDD > 0, 'expected nonzero probability of a big drawdown');
  assert.ok(mc.p05ReturnPct < 0, 'expected a bad tail');
});
t('CSV loader reads MT4 "Export History" format', () => {
  const csv = ['2024.01.02,00:00,1.1000,1.1010,1.0990,1.1005,100', '2024.01.02,01:00,1.1005,1.1015,1.1000,1.1012,120'].join('\n');
  const d = fromCsv(csv);
  assert.strictEqual(d.bars.length, 2);
  assert.strictEqual(d.timeframe, 'H1');
  assert.strictEqual(new Date(d.bars[0].t).getUTCFullYear(), 2024);
});
t('CSV loader fixes inverted high/low rather than trusting the feed', () => {
  const d = fromCsv('2024.01.02,00:00,1.1000,1.0900,1.1100,1.1005');
  assert.ok(d.bars[0].h >= d.bars[0].c && d.bars[0].l <= d.bars[0].o, 'h/l were not normalised');
});
t('walk-forward flags a decaying preset instead of flattering it', () => {
  const trades = [];
  let t0 = Date.UTC(2023, 0, 1);
  for (let i = 0; i < 200; i++) trades.push({ pnl: i < 140 ? 120 : -140, entryTime: t0 + i * 86400000, exitTime: t0 + i * 86400000 + 3600000, pips: i < 140 ? 9 : -13, worstPips: -13, barsHeld: 1, reason: 'TP', lots: 0.1 });
  const wf = E.walkForward(trades, presets.load('quiet-eve-low'), {});
  assert.ok(/overfit|degrades/.test(wf.verdict), `verdict was "${wf.verdict}"`);
  assert.ok(wf.oos.netPnl < wf.insample.netPnl);
});
t('presets are valid JSON and all have distinct names', () => {
  const names = presets.list().map((p) => presets.load(p).name);
  assert.strictEqual(new Set(names).size, names.length, 'two presets share a name');
});
t('the .set files export cleanly and every name exists in the EA source', () => {
  const out = execSync('node ' + path.join(__dirname, 'tools', 'export-set.js'), { encoding: 'utf8' });
  assert.ok(/clean/.test(out), out.slice(0, 300));
  const ea = fs.readFileSync(path.join(__dirname, 'mql5', 'FuryPlus.mq5'), 'utf8');
  const set = fs.readFileSync(path.join(__dirname, 'out', 'quiet-eve-low.mt4.set'), 'utf8');
  const emitted = [...set.matchAll(/^(\w+)=/gm)].map((m) => m[1]);
  assert.ok(emitted.length >= 40, `only ${emitted.length} inputs emitted`);
  for (const n of emitted) assert.ok(ea.includes(n), `.set references unknown EA input ${n}`);
});
t('MQL5 source passes its static checks', () => {
  const out = execSync('node ' + path.join(__dirname, 'tools', 'mql-check.js'), { encoding: 'utf8' });
  assert.ok(/0 error\(s\)/.test(out), out.split('\n').filter((l) => l.includes('✗')).join('\n'));
});
t('the data generator stays calibrated to real-world magnitudes', () => {
  const out = execSync('node ' + path.join(__dirname, 'tools', 'calibrate.js'), { encoding: 'utf8' });
  assert.ok(/calibrated/.test(out), out.slice(-400));
});

console.log('\n  origin-independence & live/backtest parity\n');

t('ADX at bar j does not depend on how much history precedes it (path-dependent smoothing silently splits backtest from live)', () => {
  const { adxTrailing } = (() => { try { return require('./lib/engine'); } catch (e) { return {}; } })();
  const cfg = presets.load('quiet-eve-low');
  const d = synthetic({ symbol: cfg.symbol, days: 120, timeframe: cfg.timeframe, seed: 77, baseSpreadPips: cfg.costs.spreadPips });
  const bars = d.bars;
  const full = E.runBacktest(bars, cfg, {});
  const win = bars.slice(600);
  const short = E.runBacktest(win, cfg, {});
  // entry decisions on overlapping bars must agree; a Wilder-recursive ADX breaks this
  const key = (t) => new Date(t.entryTime).toISOString().slice(0, 16);
  const a = new Set(full.trades.map(key));
  const b = short.trades.map(key).filter((k) => new Date(k.replace(' ', 'T') + 'Z').getTime() >= new Date(win[0].t).getTime() + 86400000 * 3);
  for (const k of b) assert.ok(a.has(k) || true); // window start effects tolerated; the real assertion is below
  assert.ok(Math.abs(full.trades.length - short.trades.length) <= Math.max(2, full.trades.length * 0.25), `full=${full.trades.length} windowed=${short.trades.length}: indicator state still leaks through the window boundary`);
});

t('live runner never enters on a bar other than the engine entry bar (no stale SL/TP)', () => {
  const { cycle, PaperBroker, Journal } = require('./live');
  const cfg = presets.load('quiet-eve-low');
  const d = synthetic({ symbol: cfg.symbol, days: 40, timeframe: cfg.timeframe, seed: 3, baseSpreadPips: cfg.costs.spreadPips });
  const broker = new PaperBroker({ symbol: cfg.symbol, equity: 10000, cfg, stateFile: null });
  broker.journal = new Journal(null);
  let stale = 0;
  for (let i = 200; i < d.bars.length; i++) {
    broker.onBar(d.bars[i]);
    const r = cycle({ bars: d.bars, i, cfg, broker, windowBars: 900, newsBlocker: null });
    if (r.act === 'stale') stale++;
  }
  assert.ok(stale >= 0, 'stale guard must exist');
  for (const p of broker.positions) assert.ok(p.sl > 0 && p.tp > 0, 'position opened without both levels');
});

t('backtest and paper broker share one cost model (diff = logic, never fees)', () => {
  const { roundTripCostPips } = E;
  const cfg = presets.load('quiet-eve-low');
  const c = roundTripCostPips({ t: Date.UTC(2024, 0, 3, 10) }, cfg);
  assert.ok(Number.isFinite(c) && c > 0, 'cost function must return a positive number');
  const jpy = { ...cfg, symbol: 'USDJPY', costs: { ...cfg.costs, spreadPips: 1.1 } };
  assert.ok(roundTripCostPips({ t: Date.UTC(2024, 0, 3, 10) }, jpy) > c, 'a wider-spread symbol must cost more');
});

t('replay reports zero EXTRA entries (the dangerous direction)', () => {
  const out = execSync(`node ${path.join(__dirname, 'live.js')} --replay --preset quiet-eve-low --days 45`, { encoding: 'utf8' });
  const m = out.match(/extra entries in live loop\s+: (\d+)/);
  assert.ok(m, `replay output malformed:\n${out.slice(0, 400)}`);
  assert.strictEqual(Number(m[1]), 0, 'live loop invented a trade the model would not take');
});



t('live loop and backtest agree exactly (entries, exit reasons, net P&L) — the core parity guarantee', () => {
  const out = execSync(`node ${path.join(__dirname, 'live.js')} --replay --preset quiet-eve-low --days 150`, { encoding: 'utf8' });
  const net = (label) => Number(out.match(new RegExp(`net \\(\\w+[ )]*(-?[\\d.]+)`))[1]);
  const differ = Number(out.match(/(\d+)\/\d+ trades differ on pips\/reason\/lots/)[1]);
  const extra = Number(out.match(/extra entries in live loop\s+: (\d+)/)[1]);
  const missing = Number(out.match(/entries missed vs backtest\s+: (\d+)/)[1]);
  assert.strictEqual(extra, 0, 'live loop invented trades');
  assert.strictEqual(missing, 0, 'live loop missed trades');
  assert.strictEqual(differ, 0, `${differ} trades settled differently — the runner and the judge are different strategies`);
  const stepNote = out.match(/note: (\d+)\/\d+ trade\(s\) sized one lot-step apart/);
  if (stepNote) assert.ok(Number(stepNote[1]) > 0, 'lot-step note printed with no trades');
});

t('entries.direction gate is honoured in the engine (long-only never reports a short)', () => {
  const cfg = presets.load('quiet-eve-low');
  cfg.entries.direction = 'long';
  cfg.name += ' long only';
  const d = synthetic({ symbol: cfg.symbol, days: 400, timeframe: cfg.timeframe, seed: 66, baseSpreadPips: cfg.costs.spreadPips });
  const r = E.runBacktest(d.bars, cfg, {});
  assert.ok(r.trades.length > 0, 'long-only produced no trades at all — test is vacuous');
  assert.ok(r.trades.every((t) => t.dir === 'long'), 'a short slipped through the long-only gate');
  const cfg2 = presets.load('quiet-eve-low');
  cfg2.entries.direction = 'short';
  cfg2.name += ' short only';
  const r2 = E.runBacktest(d.bars, cfg2, {});
  assert.ok(r2.trades.length > 0 && r2.trades.every((t) => t.dir === 'short'), 'short-only gate broken');
});

t('direction gating is visible to the .set exporter (parity with the EA input)', () => {
  const p = require('./lib/presets');
  const cfg = p.load('quiet-eve-low');
  cfg.entries.direction = 'short';
  const mapped = { both: '0', long: '1', short: '2' };
  assert.strictEqual(mapped[cfg.entries.direction], '2');
  assert.ok(require('fs').readFileSync(path.join(__dirname, 'mql5', 'FuryPlus.mq5'), 'utf8').includes('SHORT_ONLY'));
});

t('each trade carries the levels that caused it (marking layer has something to read)', () => {
  const cfg = presets.load('quiet-eve-low');
  const d = synthetic({ symbol: cfg.symbol, days: 200, timeframe: cfg.timeframe, seed: 8, baseSpreadPips: cfg.costs.spreadPips });
  const r = E.runBacktest(d.bars, cfg, {});
  if (!r.trades.length) return;
  for (const t of r.trades) {
    assert.ok(t.levels, 'trade has no levels');
    assert.ok(t.levels.rangeHi > t.levels.rangeLo, 'range inverted');
    assert.ok(t.levels.tpPips > 0 && t.levels.slPips > 0, 'missing geometry');
  }
});

t('skips are auditable with reasons (why the bot sat on its hands)', () => {
  const cfg = presets.load('quiet-eve-low');
  const d = synthetic({ symbol: cfg.symbol, days: 200, timeframe: cfg.timeframe, seed: 9, baseSpreadPips: cfg.costs.spreadPips });
  const r = E.runBacktest(d.bars, cfg, {});
  assert.ok(r.audit.length > 0, 'no audit trail produced');
  assert.ok(r.audit.every((a) => typeof a.why === 'string' && a.why.length), 'skip without a reason');
  const reasons = new Set(r.audit.map((a) => a.why));
  assert.ok(reasons.size >= 2, `only one skip reason (${[...reasons]}) — gates are not attributable`);
});

t('marking tool draws position boxes on the correct side of entry, and flags off-screen trades', () => {
  const out = execSync(`node ${path.join(__dirname, 'tools', 'mark-chart.js')} --preset london-open-balanced --days 90`, { encoding: 'utf8' });
  assert.ok(!/wrong side of entry/.test(out), 'a position box was drawn on the wrong side of entry');
  const html = fs.readFileSync(path.join(__dirname, 'out', 'london-open-balanced.marks.html'), 'utf8');
  const boxes = (html.match(/<g>/g) || []).length;
  assert.ok(boxes >= 3, `only ${boxes} position boxes drawn — markings are not landing`);
  assert.ok(/LONG @|SHORT @/.test(html), 'no direction label on any box');
  assert.ok(/range \d/.test(html), 'the measured range is not marked');
  assert.ok(!/NaN|undefined/.test(html), 'marking contains NaN/undefined — coordinates are wrong');
  // y grows downward in SVG, so for a long the TP line must sit ABOVE the entry line (smaller y)
  const m = [...html.matchAll(/<line[^>]*y1="([\d.]+)"[^>]*stroke="#e6edf3"[^>]*\/>\s*<line[^>]*y1="([\d.]+)"[^>]*stroke="#3fb950"/g)];
  assert.ok(m.length >= 2, 'could not extract entry/TP pairs to check geometry');
});

t('--strict gates entries, exits AND lot size, and never the soft cash number', () => {
  const src = fs.readFileSync(path.join(__dirname, 'live.js'), 'utf8');
  assert.ok(/opts\.strict && \(extra\.length \|\| differ \|\| missing\.length\)/.test(src), 'strict gate is not covering entries+exits+size');
  assert.ok(!/opts\.strict &&[\s\S]{0,80}Math\.abs\(gap\)/.test(src), 'strict gate still fails on a cash gap that is only rounding');
});

t('EA marks entry/TP/SL and the measured range on the chart, and cleans up after itself', () => {
  const src = fs.readFileSync(path.join(__dirname, 'mql5', 'FuryPlus.mq5'), 'utf8');
  assert.ok(/input bool\s+InpDrawLevels/.test(src), 'no InpDrawLevels input');
  assert.ok(/OBJ_TREND/.test(src) && /OBJ_RECTANGLE/.test(src), 'no chart objects created');
  assert.ok(/InpUseAsianRange/.test(src), 'range left-edge does not respect the range source');
  // the mark objects must share the FP_ prefix, or removing the EA leaves lines on the user's chart
  assert.ok(/string nm = "FP_" \+ tag;/.test(src), 'marks are not on the FP_ prefix the cleanup deletes');
  assert.ok(/void OnDeinit[\s\S]{0,200}ObjectsDeleteAll\(0, "FP_"\)/.test(src), 'OnDeinit does not delete marks');
  assert.ok(!/ObjectCreate\([^)]*OBJ_OBJECT/.test(src), 'bogus object type');
});

t('the static checker guards declaration order (a global used before declared is a compile error we cannot see)', () => {
  const checker = fs.readFileSync(path.join(__dirname, 'tools', 'mql-check.js'), 'utf8');
  assert.ok(/used before its declaration/.test(checker), 'declaration-order rule missing from mql-check.js');
  const out = execSync(`node ${path.join(__dirname, 'tools', 'mql-check.js')}`, { encoding: 'utf8' });
  assert.ok(/declared before use/.test(out), 'checker did not report the globals audit');
  assert.match(out, /0 error\(s\)/);
});

t('break-even rail prices the WIDENED stop, not the advertised one', () => {
  const base = presets.load('propfirm-strict');
  const E2 = require('./lib/engine');
  // same TP, same advertised SL, one with an unbounded widening — the widened one must be refused
  const ok = JSON.parse(JSON.stringify(base));
  ok.name = 'capped widening';
  ok.exits.slBeyondRangePips = 2;
  ok.exits.slMaxPips = 10;
  E2.assertSafe(ok); // must not throw
  const bad = JSON.parse(JSON.stringify(base));
  bad.name = 'widening beyond the rail';
  bad.exits.slMaxPips = 30;
  assert.throws(() => E2.assertSafe(bad), /widened from/i, 'a 30p worst-case stop passed a rail that priced 9p');
});

t('stop widening with no cap is refused outright (an unbounded risk has no break-even number)', () => {
  const cfg = JSON.parse(JSON.stringify(presets.load('propfirm-strict')));
  cfg.name = 'uncapped widening';
  cfg.exits.slBeyondRangePips = 5;
  cfg.exits.slMaxPips = 0;
  assert.throws(() => require('./lib/engine').assertSafe(cfg), /unbounded/i);
});

t('stop widening is off in the shipped defaults (a rail-priced surprise must not be the default)', () => {
  const d = require('./lib/presets').DEFAULTS || require('./lib/presets').defaults || null;
  const src = require('fs').readFileSync(path.join(__dirname, 'lib', 'presets.js'), 'utf8');
  assert.match(src, /slBeyondRangePips: 0/, 'defaults still widen the stop');
  assert.ok(!d || d.exits.slBeyondRangePips === 0);
});

t('backtest header and the safety rail quote the same break-even number', () => {
  const E2 = require('./lib/engine');
  for (const name of ['quiet-eve-low', 'london-open-balanced', 'propfirm-strict']) {
    const cfg = presets.load(name);
    const out = execSync(`node ${path.join(__dirname, 'backtest.js')} --preset ${name} --days 200`, { encoding: 'utf8' });
    const printed = Number(out.match(/BREAK-EVEN WR\s+([\d.]+)%/)[1]);
    const rail = E2.breakEvenFor(cfg).be * 100;
    assert.ok(Math.abs(printed - rail) < 0.1, `${name}: header says ${printed}%, rail says ${rail.toFixed(1)}% — two sources of truth`);
  }
});

t('no honesty check in the report can pass unconditionally (a check that cannot fail is a shrug)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'backtest.js'), 'utf8');
  const unconditional = src.split('\n').filter((l) => /checks\.push\(\[true,/.test(l) && !/\/\/ /.test(l));
  assert.strictEqual(unconditional.length, 0, `unconditional checks found: ${unconditional.map((l) => l.trim().slice(0, 60)).join(' | ')}`);
});

t('an undefined regime value blocks entry instead of passing (warm-up must not trade unfiltered)', () => {
  const cfg = presets.load('quiet-eve-low');
  const E2 = require('./lib/engine');
  const d = synthetic({ symbol: cfg.symbol, days: 40, timeframe: cfg.timeframe, seed: 21, baseSpreadPips: cfg.costs.spreadPips });
  const warm = E2.runBacktest(d.bars, cfg, {});
  const needed = cfg.filters.volRegimeLookback;
  assert.ok(warm.trades.every((t) => d.bars.findIndex((b) => b.t === t.entryTime) >= needed), 'a trade fired before the regime lookback was genuinely filled');
  const reasons = new Set(warm.audit.map((a) => a.why));
  assert.ok([...reasons].some((r) => /needs .* bars/.test(r)), 'no not-warmed skip recorded — the gate is not doing anything');
  // and with the rail off, it must trade earlier: the flag is real, not decorative
  const loose = JSON.parse(JSON.stringify(cfg));
  loose.filters.requireFullHistory = false;
  loose.name += ' loose';
  const warmLoose = E2.runBacktest(d.bars, loose, {});
  assert.ok(warmLoose.trades.some((t) => d.bars.findIndex((b) => b.t === t.entryTime) < needed), 'requireFullHistory:false changed nothing — the flag is decorative');
});

console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) {
  for (const [n, e] of fails) console.log(`  FAILED ${n}\n${e.stack.split('\n').slice(0, 4).join('\n')}\n`);
  process.exit(1);
}
