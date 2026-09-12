#!/usr/bin/env node
'use strict';
/**
 * FuryPlus backtest CLI — the "is this working?" harness.
 *
 *   node bot/backtest.js --preset quiet-eve-low --days 900 --equity 10000
 *   node bot/backtest.js --preset london-open-balanced --csv ~/exports/GBPUSD_H1.csv
 *   node bot/backtest.js --preset quiet-eve-low --ablate all        # does the filter earn its keep?
 *   node bot/backtest.js --all                                      # every preset, side by side
 *   node bot/backtest.js --preset quiet-eve-low --sweep             # TP/SL grid, honest R:R reported
 *
 * Writes bot/out/<preset>.{json,trades.csv,equity.csv,report.html}.
 */
const fs = require('fs');
const path = require('path');
const { runBacktest, monteCarlo, walkForward, fmtStatsTable, pipsToPrice, pipSize, breakEvenFor } = require('./lib/engine');
const { synthetic, fromCsv } = require('./lib/data');
const presets = require('./lib/presets');

const OUT = path.join(__dirname, 'out');
const argv = process.argv.slice(2);
function flag(name, dflt) {
  const i = argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const nxt = argv[i + 1];
  if (nxt === undefined || nxt.startsWith('--')) return true;
  return nxt;
}
function has(name) {
  return argv.includes('--' + name);
}

const BANNER = [
  '╔══════════════════════════════════════════════════════════════════════╗',
  '║  FuryPlus — a time-window range scalper you can actually inspect      ║',
  '║  Every number below is derived from the trade list. Nothing smoothed. ║',
  '╚══════════════════════════════════════════════════════════════════════╝',
].join('\n');

const WARN_SYNTHETIC = [
  '  ┌────────────────────────────────────────────────────────────────────┐',
  '  │ SYNTHETIC DATA. This run proves the MECHANICS work: filters fire,  │',
  '  │ stops trigger, governors halt, costs bite. It proves NOTHING about  │',
  '  │ whether the strategy makes money in real markets.                  │',
  '  │                                                                    │',
  '  │ ASSUMPTION DISCLOSURE: this generator embeds mean reversion on      │',
  '  │ sub-daily bars. That structurally FAVOURS range-fade presets and    │',
  '  │ structurally PENALISES breakout presets. Comparing two strategies  │',
  '  │ here is comparing them against an assumption, not against a market. │',
  '  │ Do not pick a winner from these numbers.                            │',
  '  │                                                                    │',
  '  │ For a number worth acting on: --csv <real exported bars>, then MT5  │',
  '  │ Strategy Tester on tick/real-volume data, then 30+ days on demo.    │',
  '  └────────────────────────────────────────────────────────────────────┘',
].join('\n');

/** Build a time-blocker from dataset events + preset news settings. */
function makeNewsBlocker(dataset, cfg) {
  const nf = cfg.filters.newsFilter || {};
  if (!nf.enabled || !dataset.events || !dataset.events.length) return null;
  const before = (nf.minutesBefore || 0) * 60000;
  const after = (nf.minutesAfter || 0) * 60000;
  const kinds = nf.importance === 'all' ? ['news', 'trend'] : ['news'];
  const windows = dataset.events.filter((e) => kinds.includes(e.kind)).map((e) => ({ from: e.t - before, to: e.t + after }));
  if (!windows.length) return null;
  return (t) => windows.some((w) => t >= w.from && t <= w.to);
}

function runOne(name, opts) {
  let cfg;
  try {
    cfg = presets.load(name);
  } catch (e) {
    console.log(`\n  ✗ ${e.message}`);
    return { name, error: 'load: ' + e.message };
  }
  const dataset = opts.csv
    ? fromCsv(fs.readFileSync(path.resolve(opts.csv), 'utf8'), { symbol: cfg.symbol })
    : synthetic({
        symbol: cfg.symbol,
        days: opts.days,
        timeframe: cfg.timeframe || 'H1',
        seed: opts.seed,
        baseSpreadPips: cfg.costs.spreadPips,
      });

  if (opts.ablate) {
    if (opts.ablate === 'all' || opts.ablate === 'regime') {
      cfg.filters.maxAtrZ = null;
      cfg.filters.adxMax = null;
      cfg.filters.maxRangePips = Infinity;
      cfg.filters.maxRangeAtrMult = Infinity;
    }
    if (opts.ablate === 'all' || opts.ablate === 'spread') cfg.filters.maxSpreadPoints = Infinity;
    if (opts.ablate === 'all' || opts.ablate === 'news') cfg.filters.newsFilter.enabled = false;
    if (opts.ablate === 'all' || opts.ablate === 'governors') {
      cfg.session.maxSetsPerDay = 0;
      cfg.risk.dailyLossCapPct = 0;
      cfg.risk.maxConsecutiveLosses = 0;
    }
    if (opts.ablate === 'all' || opts.ablate === 'exits') {
      // Ablation isolates STRATEGY components. The time guard is a SAFETY rail, not an edge, so it
      // stays on (defaulting to a long window) — otherwise ablating trips the safety rails and you
      // learn nothing about the exits.
      cfg.exits.breakEvenTriggerPips = 0;
      cfg.exits.trailStartPips = 0;
      cfg.exits.hardTimeStopBars = Math.max(cfg.exits.hardTimeStopBars, 96);
    }
    cfg.name += `  [ABLATED: ${opts.ablate}]`;
  }

  console.log(`\n▶ ${cfg.name}`);
  console.log(`  bars=${dataset.bars.length}  tf=${cfg.timeframe}  span=${new Date(dataset.bars[0].t).toISOString().slice(0, 10)} → ${new Date(dataset.bars[dataset.bars.length - 1].t).toISOString().slice(0, 10)}`);
  if (dataset.source === 'SYNTHETIC') console.log(WARN_SYNTHETIC);

  let result;
  try {
    result = runBacktest(dataset.bars, cfg, { startEquity: opts.equity, isNewsBlocked: makeNewsBlocker(dataset, cfg) });
  } catch (e) {
    if (e.code === 'UNSAFE_PRESET') {
      console.log('\n  ⛔ ENGINE REFUSED THIS PRESET — that is the safety rail doing its job:\n');
      console.log('  ' + e.message.split('\n').slice(1).join('\n  '));
      const be = breakEvenFor(cfg).be;
      const info = breakEvenFor(cfg);
      const slTxt = info.sl == null ? `${cfg.exits.slPips} (UNBOUNDED)` : `${cfg.exits.slPips}${info.sl !== cfg.exits.slPips ? ` -> ${info.sl} once slBeyondRangePips widens it` : ''}`;
      if (info.be != null) console.log(`\n  For reference: ${(info.be * 100).toFixed(1)}% win rate needed to break even at TP ${cfg.exits.tpPips} / SL ${slTxt}.`);
      else console.log(`\n  For reference: SL ${slTxt} — no cap, so no break-even number can be quoted.`);
      console.log('  That one line is the entire reason this category has a reputation problem.\n');
      return { name, refused: e.message };
    }
    throw e;
  }

  console.log(fmtStatsTable(result, cfg));

  // ---- honesty checks: does the story survive its own numbers? ----
  const checks = [];
  const s = result.stats;
  checks.push([s.winRate >= result.safety.beWinRate, `win rate ${(s.winRate * 100).toFixed(1)}% vs break-even ${(result.safety.beWinRate * 100).toFixed(1)}%`]);
  checks.push([s.profitFactor >= 1.15, `profit factor ${s.profitFactor} (need ≥1.15 to survive slippage you cannot model)`]);
  checks.push([s.maxDrawdownPct > 0 && s.recoveryFactor >= 1, `recovery factor ${s.recoveryFactor} (net vs max DD)`]);
  checks.push([s.longestHoldBars <= Math.max(24, (cfg.exits.hardTimeStopBars || 24) * 2), `longest hold ${s.longestHoldBars} bars — nothing stuck`]);
  const stuck = result.trades.filter((t) => t.reason === 'TIMESTOP' || t.reason === 'WINDOWEND').length;
  // This used to be `checks.push([true, ...])` — a check that cannot fail is not a check. The share of
  // trades closed by the clock rather than by the take-profit is the single most diagnostic number in
  // this family of strategy: if most exits are forced, the "edge" being optimised (the TP) is
  // decorative, and the backtest is measuring the risk manager, not the signal.
  const stuckPct = s.trades ? (stuck / s.trades) * 100 : 0;
  checks.push([stuckPct <= 50, `${stuck} trade(s) closed by safety exit, not by TP — ${stuckPct.toFixed(0)}% of them` + (stuckPct > 50 ? ` (the take-profit is decoration: widen the window, shrink the target, or accept that this preset trades the clock)` : '')]);

  console.log('\n  honesty checks');
  for (const [ok, txt] of checks) console.log(`   ${ok ? '✓' : '✗'} ${txt}`);

  if (s.trades < 10) {
    console.log('\n  ⚠ almost nothing traded. Why (dominant skip reason):');
    const sk = result.skipped;
    // outsideWindow is trivially huge for a one-hour window and saying it out loud is not advice.
    // Rank the skips the user can actually act on; mention the structural one once.
    const actionable = Object.entries(sk).filter(([k, v]) => k !== 'outsideWindow' && v > 0).sort((a, b) => b[1] - a[1]);
    const total = actionable.reduce((a, [, v]) => a + v, 0) || 1;
    if (sk.outsideWindow) console.log(`     (outside window: ${sk.outsideWindow} bars — expected, that is what a session filter does)`);
    for (const [k, v] of actionable.slice(0, 3)) console.log(`     ${k.padEnd(14)} ${(v / total * 100).toFixed(1)}% of in-window bars`);
    const why = actionable.length ? actionable[0][0] : sk.outsideWindow ? 'noWindowBars' : 'none';
    const advice = {
      spread: 'The spread gate is refusing everything. Either your window is sitting on the 22:00 bank\n' +
        '          rollover (move it an hour earlier), or this preset was tuned for a tighter broker than\n' +
        '          the one it is pointed at. This is the single most common real-world failure in this\n' +
        '          strategy family and the reason "works with any broker" is not a true statement.',
      regime: 'The volatility/range filter is refusing everything. Loosen maxAtrZ / maxRangePips, or accept\n' +
        '          that this edge only appears a few days a month on this symbol — which is also a valid\n' +
        '          and honest answer, and matches "we expect 0-7 trades per day".',
      noWindowBars: 'No bar in this dataset ever fell inside session.windows, so the engine never even\n' +
        '          got to the filters. Check the window against the bar timestamps and the timezone the\n' +
        '          data is stamped in (this engine compares GMT, not your local clock, not server time).',
      outsideWindow: 'Window is never open on this data — check session.windows against the bar timestamps\n' +
        '          and remember the comparison is GMT, not your local time and not broker server time.',
      dayCap: 'The one-set-per-day governor plus halts is binding. With 1 trade/day you need months of\n' +
        '          data for a statistically meaningful sample, not days.',
      adx: 'The ADX ceiling is binding — the market spent the sample trending, not ranging.',
      halted: 'The daily-loss / losing-streak governors are binding — the entries that fire are losing.',
      news: 'The news blackout is swallowing the whole window. Shorten minutesBefore/After or move the hour.',
      other: 'Sizing rounds to zero lots or day gates reject. Check risk.riskPct against startEquity\n' +
        '          (10k at 0.5% with an 18-pip stop is 0.27 lots; 1k at 0.5% is nothing).',
    }[why];
    if (advice) console.log('\n' + advice.split('\n').map((l) => '          ' + l.trim()).join('\n').replace(/\n {10}/g, '\n     '));
    console.log(`\n     n=${s.trades} trades is not evidence of anything. Do not size an account on this run.`);
  } else if (s.trades < 60) {
    console.log(`\n  ⚠ only ${s.trades} trades in the sample — every ratio above is soft. Prefer ≥200.`);
  }

  if (result.stats.ambiguousExits) {
    const optimistic = { ...cfg, name: cfg.name + ' optimistic' };
    optimistic.exits = { ...cfg.exits, sameBarTieBreak: 'best' };
    let opt = null;
    try {
      opt = runBacktest(dataset.bars, optimistic, { startEquity: opts.equity, isNewsBlocked: makeNewsBlocker(dataset, cfg) });
      const delta = opt.stats.netPnl - result.stats.netPnl;
      console.log(`\n  same-bar ordering: assuming the FAVOURABLE exit instead of the stop would`);
      console.log(`   change net P&L by ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} (${((result.stats.netPnl !== 0 ? delta / Math.abs(result.stats.netPnl) : 1) * 100).toFixed(0)}%), win rate ${result.stats.winRate ? ((opt.stats.winRate - result.stats.winRate) * 100).toFixed(1) : '0.0'}pp`);
      console.log(`   ${Math.abs(delta) > Math.abs(result.stats.netPnl) * 0.25 ? '✗ this preset\'s result is mostly an artefact of intra-bar ordering. On M1/tick data it may not exist.' : '✓ ordering assumption is not load-bearing here'}`);
    } catch (e) {
      console.log(`\n  same-bar ordering: optimistic variant refused by the rails (${e.code})`);
    }
  }

  const mc = monteCarlo(result.trades, { iterations: opts.mc, startEquity: opts.equity });
  console.log('\n  Monte Carlo (bootstrapped trade order + ±35% P&L jitter)');
  if (mc.note) console.log(`   ${mc.note}`);
  else {
    console.log(`   return   median ${mc.medianReturnPct}%   5th pct ${mc.p05ReturnPct}%   95th pct ${mc.p95ReturnPct}%`);
    console.log(`   drawdown median ${mc.medianMaxDdPct}%   95th pct ${mc.p95MaxDdPct}%   worst ${mc.worstMaxDdPct}%`);
    console.log(`   chance the whole run loses money:      ${mc.pctNegative}%`);
    console.log(`   chance of a ≥${mc.ruinThresholdPct}% drawdown:        ${mc.chanceOfRuinedDD}%   <-- the number a vendor will not print`);
  }

  const wf = walkForward(result.trades, cfg, { startEquity: opts.equity });
  console.log('\n  In-sample vs out-of-sample (is the preset a strategy or a curve?)');
  if (wf.note) console.log(`   ${wf.note}`);
  else {
    console.log(`   IS   PF ${wf.insample.profitFactor}  WR ${(wf.insample.winRate * 100).toFixed(1)}%  net ${wf.insample.netPnl}`);
    console.log(`   OOS  PF ${wf.oos.profitFactor}  WR ${(wf.oos.winRate * 100).toFixed(1)}%  net ${wf.oos.netPnl}`);
    console.log(`   verdict: ${wf.verdict} (PF decay ${wf.profitFactorDecay})`);
  }

  const spreadSensitivity = sensitivity(dataset, cfg, opts.equity);
  if (spreadSensitivity) {
    console.log('\n  Spread sensitivity (1.0× → 3.0× baseline cost) — a scalper dies here first');
    for (const row of spreadSensitivity) console.log(`   ${row.label.padEnd(8)} net ${String(row.net).padStart(9)}  PF ${String(row.pf).padStart(6)}  WR ${(row.wr * 100).toFixed(1)}%`);
  }

  // ---- artifacts ----
  fs.mkdirSync(OUT, { recursive: true });
  const base = name.replace(/[^a-z0-9.-]+/gi, '_');
  const bundle = { generatedAt: new Date().toISOString(), source: dataset.source, cfg, stats: s, monteCarlo: mc, walkForward: wf, skipped: result.skipped, checks: checks.map(([ok, txt]) => ({ ok, txt })) };
  fs.writeFileSync(path.join(OUT, `${base}.json`), JSON.stringify(bundle, null, 2));
  fs.writeFileSync(
    path.join(OUT, `${base}.trades.csv`),
    ['id,entryTime,exitTime,symbol,dir,lots,entry,exit,pips,pnl,barsHeld,reason,worstPips,costPips']
      .concat(result.trades.map((t) => [t.id, iso(t.entryTime), iso(t.exitTime), t.symbol, t.dir, t.lots, fix(t.entry, cfg), fix(t.exit, cfg), t.pips, t.pnl, t.barsHeld, t.reason, t.worstPips, t.costPips].join(',')))
      .join('\n')
  );
  fs.writeFileSync(
    path.join(OUT, `${base}.equity.csv`),
    'time,equity\n' + result.equityCurve.filter((_, i) => i % 24 === 0 || i === result.equityCurve.length - 1).map((e) => `${iso(e.t)},${e.equity.toFixed(2)}`).join('\n')
  );
  writeReport(path.join(OUT, `${base}.report.html`), bundle, result.trades, result.equityCurve);
  console.log(`\n  → bot/out/${base}.json · .trades.csv · .equity.csv · .report.html`);

  return { name, stats: s, mc, wf, beWinRate: result.safety.beWinRate, refused: false };
}

function sensitivity(dataset, cfg, equity) {
  const out = [];
  for (const mult of [1, 2, 3]) {
    const c2 = JSON.parse(JSON.stringify(cfg));
    c2.costs.spreadPips *= mult;
    c2.costs.slippagePips *= mult;
    c2.name = `${mult.toFixed(1)}x`;
    try {
      const r = runBacktest(dataset.bars, c2, { startEquity: equity, isNewsBlocked: makeNewsBlocker(dataset, c2) });
      out.push({ label: `${mult.toFixed(1)}x`, net: r.stats.netPnl, pf: r.stats.profitFactor, wr: r.stats.winRate });
    } catch (e) {
      out.push({ label: `${mult.toFixed(1)}x`, net: 'refused', pf: '-', wr: 0 });
    }
  }
  return out.length ? out : null;
}

function tpSlSweep(name, opts) {
  const base = presets.load(name);
  const dataset = opts.csv ? fromCsv(fs.readFileSync(path.resolve(opts.csv), 'utf8')) : synthetic({ symbol: base.symbol, days: opts.days, timeframe: base.timeframe || 'H1', seed: opts.seed, baseSpreadPips: base.costs.spreadPips });
  const tps = [8, 10, 12, 14, 16, 20, 24, 30];
  const sls = [10, 14, 16, 20, 25, 30, 40];
  console.log(`\n▶ TP/SL sweep on ${base.symbol} (${dataset.source}) — every cell reports the win rate it needs vs the win rate it got\n`);
  const header = '   TP\\SL ' + sls.map((s) => String(s).padStart(7)).join('');
  console.log(header);
  console.log('   ' + '-'.repeat(header.length - 3));
  const cells = [];
  for (const tp of tps) {
    const row = [`${tp}`.padStart(5)];
    for (const sl of sls) {
      const cfg = JSON.parse(JSON.stringify(base));
      cfg.exits.tpPips = tp;
      cfg.exits.slPips = sl;
      cfg.exits.slMaxPips = Math.max(cfg.exits.slMaxPips, sl);
      cfg.name = `sweep ${tp}/${sl}`;
      let mark = ' ·  ';
      try {
        const r = runBacktest(dataset.bars, cfg, { startEquity: opts.equity, isNewsBlocked: makeNewsBlocker(dataset, cfg) });
        const net = r.stats.netPnl;
        const be = r.safety.beWinRate;
        mark = (net > 0 ? '+' : ' ') + (r.stats.winRate >= be ? '✓' : 'x');
        cells.push({ tp, sl, net, wr: r.stats.winRate, be, pf: r.stats.profitFactor, refused: false });
      } catch (e) {
        mark = e.code === 'UNSAFE_PRESET' ? ' ⛔' : ' ·  ';
        cells.push({ tp, sl, net: null, refused: e.code === 'UNSAFE_PRESET' });
      }
      row.push(mark.padStart(7));
    }
    console.log('  ' + row.join(''));
  }
  const winners = cells.filter((c) => !c.refused && c.net > 0).sort((a, b) => b.net - a.net).slice(0, 5);
  console.log('\n  best cells:');
  for (const w of winners) console.log(`   TP ${String(w.tp).padStart(2)} / SL ${String(w.sl).padStart(2)}  net ${String(w.net).padStart(9)}  WR ${(w.wr * 100).toFixed(1)}% (needs ${(w.be * 100).toFixed(1)}%)  PF ${w.pf}`);
  console.log('\n  ⚠ the best cell of a sweep is the most overfit cell. Re-run any winner on --csv data');
  console.log('    outside this window, and on --ablate all, before you believe it.\n');
  return cells;
}

function writeReport(file, bundle, trades, equityCurve) {
  const s = bundle.stats;
  // real equity path, no smoothing. Decimated to <=400 points so the report stays a report and
  // not a 200KB SVG — decimation never invents a high, it only thins the sample.
  const src = equityCurve || [];
  const stride = Math.max(1, Math.ceil(src.length / 400));
  const pts = src.filter((_, i) => i % stride === 0);
  if (src.length && pts[pts.length - 1] !== src[src.length - 1]) pts.push(src[src.length - 1]);
  let spark = '<div class="card"><div class="k">equity curve</div><div class="v" style="font-size:12px">no trades — nothing to plot</div></div>';
  if (pts.length > 1) {
    const vals = pts.map((e) => e.equity);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const W = 860;
    const H = 150;
    const span = Math.max(hi - lo, 1e-6);
    const xy = pts.map((e, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - ((e.equity - lo) / span) * (H - 12) - 6).toFixed(1)}`);
    // peak-to-trough shading: honest drawdown visibility, not a decorative sparkline
    let peak = -Infinity;
    const dd = pts.map((e) => {
      peak = Math.max(peak, e.equity);
      return ((peak - e.equity) / Math.max(peak, 1e-9)) * 100;
    });
    const ddMax = Math.max(...dd, 1e-6);
    const ddPath = pts.map((_, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - (dd[i] / ddMax) * (H / 3)).toFixed(1)}`).join(' ');
    spark = `<div style="grid-column:1/-1;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px">
      <div class="k">equity (peak-to-trough shading = drawdown, max ${s.maxDrawdownPct}%)</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="150" preserveAspectRatio="none">
        <polygon points="0,${H} ${ddPath} ${W},${H}" fill="#f8514922"/>
        <polyline points="${xy.join(' ')}" fill="none" stroke="#3fb950" stroke-width="1.6"/>
      </svg>
      <div class="k">${pts[0] ? new Date(pts[0].t).toISOString().slice(0, 10) : ''} → ${pts[pts.length - 1] ? new Date(pts[pts.length - 1].t).toISOString().slice(0, 10) : ''} · ${s.startEquity} → ${s.endEquity} · flat line = no trades, not a stable strategy</div>
    </div>`;
  }
  const rows = trades
    .slice(-400)
    .map((t) => `<tr><td>${iso(t.entryTime)}</td><td>${t.dir}</td><td class="${t.pips >= 0 ? 'w' : 'l'}">${t.pips}</td><td>${t.reason}</td><td>${t.barsHeld}</td><td>${t.worstPips}</td></tr>`)
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${bundle.cfg.name}</title>
<style>
body{font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;background:#0d1117;color:#e6edf3;margin:24px}
h1{font-size:18px} h2{font-size:15px;margin-top:26px;color:#79c0ff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px}
.k{color:#8b949e;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.v{font-size:19px}
.w{color:#3fb950}.l{color:#f85149}
table{border-collapse:collapse;width:100%;font-size:12px}
td,th{padding:4px 8px;border-bottom:1px solid #21262d;text-align:right}
th:first-child,td:first-child{text-align:left}
.warn{background:#3a2d12;border:1px solid #d29922;border-radius:8px;padding:10px;margin:14px 0}
</style></head><body>
<h1>${bundle.cfg.name}</h1>
<div class="warn"><b>${bundle.source === 'SYNTHETIC' ? 'Synthetic data — mechanics only, not evidence of edge.' : 'Real exported bars — still demo-grade evidence until 30+ days of forward testing.'}</b>
Past performance does not predict future performance. This tool is for study, not for sizing a real account.</div>
<div class="grid">
${spark}
<div class="card"><div class="k">Net P&L</div><div class="v ${s.netPnl>=0?'w':'l'}">${s.netPnl}</div></div>
<div class="card"><div class="k">Trades</div><div class="v">${s.trades}</div></div>
<div class="card"><div class="k">Win rate</div><div class="v">${(s.winRate*100).toFixed(1)}%</div></div>
<div class="card"><div class="k">Break-even WR</div><div class="v">${(safetyBe(bundle).be*100).toFixed(1)}%</div><div class="k">${safetyBe(bundle).note}</div></div>
<div class="card"><div class="k">Profit factor</div><div class="v">${s.profitFactor}</div></div>
<div class="card"><div class="k">Max drawdown</div><div class="v l">${s.maxDrawdownPct}%</div></div>
<div class="card"><div class="k">Monthly</div><div class="v">${s.monthlyPct}%</div></div>
<div class="card"><div class="k">MC 95th pct DD</div><div class="v l">${bundle.monteCarlo.p95MaxDdPct ?? '-'}%</div></div>
<div class="card"><div class="k">MC chance of DD ≥${bundle.monteCarlo.ruinThresholdPct ?? 30}%</div><div class="v l">${bundle.monteCarlo.chanceOfRuinedDD ?? '-'}%</div></div>
<div class="card"><div class="k">OOS verdict</div><div class="v" style="font-size:13px">${bundle.walkForward.verdict || '-'}</div></div>
</div>
<h2>Checks</h2><div>${bundle.checks.map((c)=>`<div>${c.ok?'✅':'❌'} ${c.txt}</div>`).join('')}</div>
<h2>Last ${Math.min(400, trades.length)} trades</h2>
<table><tr><th>entry</th><th>dir</th><th>pips</th><th>why</th><th>bars</th><th>worst float</th></tr>${rows}</table>
</body></html>`;
  fs.writeFileSync(file, html);
}
function safetyBe(bundle) {
  const c = bundle.cfg;
  const i = breakEvenFor(c);
  // Quote the stop the preset can actually reach, not the one it advertises, and say which you got.
  return { be: i.be == null ? 1 : i.be, note: i.sl == null ? 'stop widening uncapped' : i.widened ? `priced on the widened ${i.sl}p stop` : `at TP ${c.exits.tpPips} / SL ${c.exits.slPips}` };
}
const fix = (v, cfg) => Number(v).toFixed(pipSize(cfg.symbol) === 0.01 ? 3 : 5);
const iso = (ms) => new Date(ms).toISOString().replace('.000', '').slice(0, 16).replace('T', ' ');

function main() {
  console.log(BANNER);
  const opts = {
    days: Number(flag('days', 900)),
    equity: Number(flag('equity', 10000)),
    seed: Number(flag('seed', 1337)),
    mc: Number(flag('mc', 2000)),
    csv: flag('csv', null),
    ablate: flag('ablate', null),
  };
  if (has('list')) {
    console.log('\n  presets in bot/presets/:\n');
    for (const p of presets.list()) console.log('   - ' + p);
    console.log('');
    return 0;
  }
  if (has('sweep')) return runOne0(() => tpSlSweep(String(flag('preset', 'quiet-eve-low')), opts), opts);
  if (has('all')) {
    const rows = [];
    for (const p of presets.list()) rows.push(runOne(p, opts));
    console.log('\n═══ summary ═══');
    console.log('  preset'.padEnd(30) + 'trades'.padStart(8) + 'win%'.padStart(8) + 'BE%'.padStart(8) + 'net'.padStart(10) + 'PF'.padStart(7) + 'DD%'.padStart(7) + 'MC95DD%'.padStart(10));
    for (const r of rows) {
      if (r.refused) {
        console.log('  ' + r.name.padEnd(28) + 'REFUSED BY SAFETY RAILS');
        continue;
      }
      if (!r.stats) continue;
      console.log(
        '  ' +
          r.name.padEnd(28) +
          String(r.stats.trades).padStart(8) +
          String((r.stats.winRate * 100).toFixed(1)).padStart(8) +
          String((r.beWinRate * 100).toFixed(1)).padStart(8) +
          String(r.stats.netPnl).padStart(10) +
          String(r.stats.profitFactor).padStart(7) +
          String(r.stats.maxDrawdownPct).padStart(7) +
          String(r.mc.p95MaxDdPct ?? '-').padStart(10)
      );
    }
    console.log('');
    return 0;
  }
  const p = flag('preset', null);
  if (!p) {
    console.log('\n  usage: node bot/backtest.js --preset <name> [--days 900] [--csv bars.csv]\n');
    console.log('  ' + presets.list().join('\n  '));
    console.log('');
    return 1;
  }
  const r = runOne(p, opts);
  if (r.error) return 1;
  console.log('\n  Reminder: run this on your broker\'s real exported bars before you trust a single digit above.\n');
  return 0;
}
function runOne0(fn) {
  fn();
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { runOne, makeNewsBlocker };
