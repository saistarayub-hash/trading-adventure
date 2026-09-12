#!/usr/bin/env node
'use strict';
/**
 * Auto-marking view: draws the chart, the long/short position boxes, and every level the bot
 * actually used to decide — generated from the same engine the backtest and the EA share, so a
 * marking can never disagree with a trade.
 *
 *   node bot/tools/mark-chart.js --preset quiet-eve-low --days 45
 *   node bot/tools/mark-chart.js --preset quiet-eve-low --days 45 --dir long
 *   node bot/tools/mark-chart.js --preset quiet-eve-low --csv bars.csv --no-skips
 *
 * Output: bot/out/<preset>.marks.html  (self-contained: inline SVG, no JS libs, no CDN, no network)
 *
 * What gets marked, and why each one is on there:
 *   - candles                       context, nothing else
 *   - entry / TP / SL               the position tool: profit box above, risk box below (mirrored
 *                                   for shorts), R:R and the break-even win rate printed on the box
 *   - range high / low / mid        the levels the engine measured and then used. This is the part
 *                                   a vendor UI never shows: without it a fade looks arbitrary,
 *                                   and with it you can see instantly whether the "range" was a
 *                                   range or a trend the filter let through
 *   - skipped bars, ticked + titled why   the audit half: "why did it not trade at 20:15" is the
 *                                   question every user of this strategy family has
 *   - session window shading        so you can see the bot idling on purpose
 */
const fs = require('fs');
const path = require('path');
const { runBacktest, breakEvenFor, pipSize } = require('../lib/engine');
const { synthetic, fromCsv } = require('../lib/data');
const presets = require('../lib/presets');

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  if (i === -1) return d;
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
};
const OUT = path.join(__dirname, '..', 'out');

const cfg = presets.load(flag('preset', 'quiet-eve-low'));
if (flag('dir')) cfg.entries.direction = String(flag('dir'));
const dataset = flag('csv')
  ? fromCsv(fs.readFileSync(path.resolve(String(flag('csv'))), 'utf8'), { symbol: cfg.symbol })
  : synthetic({ symbol: cfg.symbol, days: Number(flag('days', 45)), timeframe: cfg.timeframe, seed: Number(flag('seed', 1337)), baseSpreadPips: cfg.costs.spreadPips });
const res = runBacktest(dataset.bars, cfg, { startEquity: Number(flag('equity', 10000)) });

// ---- viewport: frame the MARKED events, not just the tail ----
// Defaulting to the last N bars made the chart look broken on quiet presets: with a flagship that
// trades ~1/day, 260 bars is two days and usually zero trades in them. Widen to span every trade
// (plus a day of context each side) up to a legible cap, and say so when something is off-screen.
const barsAll = dataset.bars;
const tailN = Number(flag('bars', 260));
const idxAll = new Map(barsAll.map((b, i) => [b.t, i]));
let from = Math.max(0, barsAll.length - tailN);
let to = barsAll.length;
if (res.trades.length) {
  const ii = res.trades.map((t) => idxAll.get(t.entryTime)).filter((v) => v != null);
  const ex = res.trades.map((t) => idxAll.get(t.exitTime)).filter((v) => v != null);
  if (ii.length) {
    const first = Math.min(...ii);
    const last = Math.max(...ii, ...(ex.length ? ex : ii));
    const ctx = Math.round(24 * 60 / ({ M1: 1, M5: 5, M15: 15, M30: 30, H1: 60 }[cfg.timeframe] || 15) / 2);
    from = Math.max(0, first - ctx);
    to = Math.min(barsAll.length, last + ctx);
    if (!flag('bars')) {
      const need = to - from;
      if (need > 1400) {
        from = Math.max(0, last + ctx - 1400);
        console.log(`  note: ${need} bars needed to show every trade; showing the last 1400. Use --bars ${need} or --all.`);
      }
    }
  }
}
if (flag('all', false)) from = 0;
const bars = barsAll.slice(from, to);
const W = 1180;
const PAD = { l: 58, r: 14, t: 46, b: 34 };
const H = 460;
const prices = bars.flatMap((b) => [b.h, b.l]);
for (const t of res.trades) prices.push(t.entry, t.exit, ...(t.levels ? [t.levels.rangeHi, t.levels.rangeLo] : []));
let lo = Math.min(...prices);
let hi = Math.max(...prices);
const padp = (hi - lo) * 0.08 || 0.001;
lo -= padp;
hi += padp;
const x = (i) => PAD.l + (i / Math.max(1, bars.length - 1)) * (W - PAD.l - PAD.r);
const y = (p) => PAD.t + (1 - (p - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
const idxOf = new Map(bars.map((b, i) => [b.t, i]));
const pip = pipSize(cfg.symbol);
const dec = pip === 0.01 ? 3 : 5;
const px = (v) => Number(v).toFixed(dec);
const bw = Math.max(1.2, ((W - PAD.l - PAD.r) / bars.length) * 0.62);

const svg = [];
// session window shading
for (let i = 0; i < bars.length; i++) {
  const h = new Date(bars[i].t).getUTCHours() * 60 + new Date(bars[i].t).getUTCMinutes();
  const inWin = cfg.session.windows.some((w) => {
    const [a, b] = [w.start, w.end].map((v) => {
      const [hh, mm] = String(v).split(':').map(Number);
      return hh * 60 + (mm || 0);
    });
    return a <= b ? h >= a && h < b : h >= a || h < b;
  });
  if (inWin) svg.push(`<rect x="${x(i) - bw / 2 - 1}" y="${PAD.t}" width="${bw + 2}" height="${H - PAD.t - PAD.b}" fill="#79c0ff" opacity="0.09"/>`);
}
// candles
for (let i = 0; i < bars.length; i++) {
  const b = bars[i];
  const up = b.c >= b.o;
  const col = up ? '#3fb950' : '#f85149';
  svg.push(`<line x1="${x(i)}" y1="${y(b.h)}" x2="${x(i)}" y2="${y(b.l)}" stroke="${col}" stroke-width="0.8"/>`);
  svg.push(`<rect x="${x(i) - bw / 2}" y="${Math.min(y(b.o), y(b.c))}" width="${bw}" height="${Math.max(0.8, Math.abs(y(b.c) - y(b.o)))}" fill="${col}" opacity="0.85"/>`);
}
// price axis
for (let k = 0; k <= 4; k++) {
  const p = lo + ((hi - lo) * k) / 4;
  svg.push(`<line x1="${PAD.l}" y1="${y(p)}" x2="${W - PAD.r}" y2="${y(p)}" stroke="#21262d"/>`);
  svg.push(`<text x="6" y="${y(p) + 3}" fill="#8b949e" font-size="10">${px(p)}</text>`);
}
// skip marks (the audit half)
const showSkips = !flag('no-skips', false);
if (showSkips) {
  for (const a of res.audit) {
    const i = idxOf.get(a.t);
    if (i == null) continue;
    svg.push(`<line x1="${x(i)}" y1="${H - PAD.b + 2}" x2="${x(i)}" y2="${H - PAD.b + 9}" stroke="#d29922" stroke-width="1.4" opacity="0.75"><title>${a.why}</title></line>`);
  }
}
// position boxes: entry / TP / SL + the range the engine used
const boxes = [];
for (const t of res.trades) {
  const i0 = idxOf.get(t.entryTime);
  const i1 = idxOf.get(t.exitTime);
  if (i0 == null) continue;
  const x0 = x(i0);
  const x1 = x(i1 == null ? Math.min(bars.length - 1, i0 + 1) : i1);
  const long = t.dir === 'long';
  const entryY = y(t.entry);
  const tpY = y(long ? t.entry + t.levels.tpPips * pip : t.entry - t.levels.tpPips * pip);
  const slY = y(long ? t.entry - t.levels.slPips * pip : t.entry + t.levels.slPips * pip);
  const w = Math.max(26, x1 - x0);
  boxes.push(`<g>
<rect x="${x0}" y="${Math.min(entryY, tpY)}" width="${w}" height="${Math.abs(tpY - entryY)}" fill="#3fb950" opacity="0.16" stroke="#3fb950" stroke-width="0.8"/>
<rect x="${x0}" y="${Math.min(entryY, slY)}" width="${w}" height="${Math.abs(slY - entryY)}" fill="#f85149" opacity="0.16" stroke="#f85149" stroke-width="0.8"/>
<line x1="${x0 - 5}" y1="${entryY}" x2="${x0 + w}" y2="${entryY}" stroke="#e6edf3" stroke-width="1.2"/>
<line x1="${x0 - 5}" y1="${tpY}" x2="${x0 + w}" y2="${tpY}" stroke="#3fb950" stroke-width="1.2" stroke-dasharray="4 3"/>
<line x1="${x0 - 5}" y1="${slY}" x2="${x0 + w}" y2="${slY}" stroke="#f85149" stroke-width="1.2" stroke-dasharray="4 3"/>
${t.levels ? `<line x1="${x0 - 26}" y1="${y(t.levels.rangeHi)}" x2="${x0 + w}" y2="${y(t.levels.rangeHi)}" stroke="#a371f7" stroke-width="1" stroke-dasharray="2 3" opacity="0.9"/>
<line x1="${x0 - 26}" y1="${y(t.levels.rangeLo)}" x2="${x0 + w}" y2="${y(t.levels.rangeLo)}" stroke="#a371f7" stroke-width="1" stroke-dasharray="2 3" opacity="0.9"/>
<line x1="${x0 - 26}" y1="${y(t.levels.rangeMid)}" x2="${x0 + w}" y2="${y(t.levels.rangeMid)}" stroke="#a371f7" stroke-width="0.7" opacity="0.45"/>` : ''}
<text x="${x0 - 4}" y="${entryY - 4}" fill="#e6edf3" font-size="10" text-anchor="end">${long ? 'LONG' : 'SHORT'} @${px(t.entry)}</text>
<text x="${x0 + w + 4}" y="${tpY + 3}" fill="#3fb950" font-size="10">TP ${t.levels.tpPips}p</text>
<text x="${x0 + w + 4}" y="${slY + 3}" fill="#f85149" font-size="10">SL ${t.levels.slPips}p</text>
${t.levels ? `<text x="${x0 - 28}" y="${y(t.levels.rangeHi) - 3}" fill="#a371f7" font-size="9" text-anchor="end">range ${t.levels.rangePips}p</text>` : ''}
<text x="${x0 + 2}" y="${Math.min(entryY, tpY, slY) - 6}" fill="#8b949e" font-size="9">R:R ${(t.levels.tpPips / t.levels.slPips).toFixed(2)} · ${t.pnl >= 0 ? '+' : ''}${t.pnl} · ${t.reason}</text>
</g>`);
}
svg.push(boxes.join('\n'));

// ---- geometry check: a marking that disagrees with the numbers is worse than no marking ----
const geom = [];
for (const t of res.trades) {
  if (idxOf.get(t.entryTime) == null || !t.levels) continue;
  const long = t.dir === 'long';
  const tp = long ? t.entry + t.levels.tpPips * pip : t.entry - t.levels.tpPips * pip;
  const sl = long ? t.entry - t.levels.slPips * pip : t.entry + t.levels.slPips * pip;
  geom.push({
    dir: t.dir,
    tpAboveEntry: long ? tp > t.entry : tp < t.entry,
    slBelowEntry: long ? sl < t.entry : sl > t.entry,
    // the fade side: a long must be taken near the LOW of the measured range, a short near the HIGH
    nearRange: long ? t.entry - t.levels.rangeLo <= t.levels.rangeHi - t.entry : t.levels.rangeHi - t.entry <= t.entry - t.levels.rangeLo,
    rangeBrackets: t.levels.rangeLo <= t.entry && t.entry <= t.levels.rangeHi,
  });
}
const bad = geom.filter((g) => !g.tpAboveEntry || !g.slBelowEntry);

const s = res.stats;
const beInfo = breakEvenFor(cfg);
// A preset whose stop can widen without a cap has no quotable break-even number. Print that instead of
// a percentage, or the chart would silently advertise a risk it has not measured.
const beTxt = beInfo.be == null ? 'UNQUOTEABLE (uncapped stop widening)' : `${(beInfo.be * 100).toFixed(1)}%`;
const dirTxt = cfg.entries.direction === 'both' ? 'long + short' : cfg.entries.direction + ' only';
const skipTally = {};
for (const a of res.audit) skipTally[a.why] = (skipTally[a.why] || 0) + 1;

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `${String(flag('preset', 'quiet-eve-low')).replace(/[^a-z0-9.-]+/gi, '_')}.marks.html`);
fs.writeFileSync(
  file,
  `<!doctype html><html><head><meta charset="utf-8"><title>${cfg.name} — marked up</title><style>
body{font:13px/1.55 ui-monospace,Menlo,Consolas,monospace;background:#0d1117;color:#e6edf3;margin:20px}
h1{font-size:16px;margin:0 0 4px} .sub{color:#8b949e;margin-bottom:12px}
.legend span{display:inline-block;margin-right:14px;font-size:11px;color:#8b949e}
.sw{display:inline-block;width:9px;height:9px;margin-right:4px;vertical-align:middle;border-radius:2px}
.warn{background:#3a2d12;border:1px solid #d29922;border-radius:8px;padding:8px 10px;margin:12px 0;font-size:12px}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.stat{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:6px 10px;font-size:11px}
.stat b{display:block;font-size:15px;font-weight:600}
label{font-size:11px;color:#8b949e;cursor:pointer}
svg{background:#0d1117;border:1px solid #30363d;border-radius:8px}
</style></head><body>
<h1>${cfg.name}</h1>
<div class="sub">${cfg.symbol} ${cfg.timeframe} · ${dirTxt} · TP ${cfg.exits.tpPips}p / SL ${cfg.exits.slPips}p · window ${cfg.session.windows.map((w)=>w.start+'-'+w.end).join(', ')} GMT · ${s.trades} trades in view</div>
<div class="warn"><b>${dataset.source === 'SYNTHETIC' ? 'Synthetic candles — built to check that the markings land in the right places, not to show performance.' : 'Broker-exported bars — still demo-grade until forward tested.'}</b> The boxes are the levels the engine measured and acted on, so they are worth reading even here.</div>
<div class="legend">
<span><i class="sw" style="background:#e6edf3"></i>entry</span>
<span><i class="sw" style="background:#3fb950"></i>take profit / profit box</span>
<span><i class="sw" style="background:#f85149"></i>stop loss / risk box</span>
<span><i class="sw" style="background:#a371f7"></i>auto-detected range (hi / mid / lo)</span>
<span><i class="sw" style="background:#79c0ff"></i>trading window</span>
<span><i class="sw" style="background:#d29922"></i>bar skipped — hover for why</span>
</div>
<div class="stats">
<div class="stat"><b>${s.winRate ? (s.winRate * 100).toFixed(1) : '0.0'}%</b>win rate</div>
<div class="stat"><b>${beTxt}</b>break-even win rate${beInfo.widened ? ' (on the widened stop)' : ''}</div>
<div class="stat"><b>${s.profitFactor}</b>profit factor</div>
<div class="stat"><b>${s.netPnl}</b>net</div>
<div class="stat"><b>${s.maxDrawdownPct}%</b>max drawdown</div>
<div class="stat"><b>${res.trades.filter((t) => t.dir === 'long').length}/${res.trades.filter((t) => t.dir === 'short').length}</b>long/short taken</div>
<div class="stat"><b>${res.audit.length}</b>bars skipped by design</div>
</div>
<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">
${svg.join('\n')}
</svg>
<div class="sub" style="margin-top:10px">
Skip tally: ${Object.entries(skipTally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(' · ') || 'none'}<br>
A win rate below the break-even win rate is a losing bot regardless of how good the curve looks — that comparison is on every box for a reason.
</div>
</body></html>`
);
if (bad.length) console.log(`  ⛔ ${bad.length} position box(es) drawn on the wrong side of entry — a marking that lies is worse than none`);
const drawn = res.trades.filter((t) => idxOf.get(t.entryTime) != null).length;
console.log(`\n  ${drawn}/${res.trades.length} position(s) marked in view (the rest fall outside the viewport), ${res.audit.filter((a) => idxOf.get(a.t) != null).length} skipped bar(s) ticked, ${bars.length} bars drawn`);
console.log(`  → ${path.relative(process.cwd(), file)}\n`);
