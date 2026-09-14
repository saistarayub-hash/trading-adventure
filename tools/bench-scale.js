'use strict';
/* tools/bench-scale.js — how big can the companion's brain get?
 *
 *   node tools/bench-scale.js [sources] [queries]
 *
 * Synthesises realistic strategy-shaped documents (setup / entry /
 * invalidation / target / risk prose with varied vocabulary), feeds them
 * through the REAL ingestion path (chunk → embed → BM25 → hybrid search),
 * and reports ingest throughput, search latency and state latency, then
 * extrapolates to 1,000 and 10,000 strategies. Nothing is written to your
 * real knowledge base — everything happens in a temp dir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCore } = require('../companion-core');

const N_SOURCES = Number(process.argv[2] || 250);
const N_QUERIES = Number(process.argv[3] || 120);

const FAMILIES = ['trend pullback', 'breakout retest', 'liquidity sweep', 'range fade', 'divergence turn',
  'opening drive', 'vwap reclaim', 'session flip', 'channel edge', 'gap fill', 'flag continuation',
  'double bottom', 'head shoulder', 'wedge compress', 'mean reversion', 'momentum thrust'];
const REGIMES = ['trending up', 'trending down', 'ranging', 'high volatility', 'low volatility', 'post-news'];
const MARKETS = ['crypto perpetuals', 'index futures', 'forex majors', 'small-cap stocks', 'commodities'];
const TFS = ['5 minute', '15 minute', '1 hour', '4 hour', 'daily'];

function doc(i) {
  const fam = FAMILIES[i % FAMILIES.length];
  const reg = REGIMES[(i * 7) % REGIMES.length];
  const mkt = MARKETS[(i * 3) % MARKETS.length];
  const tf = TFS[(i * 5) % TFS.length];
  const n = 100 + (i % 60);
  return {
    title: 'Strategy ' + n + ': ' + fam + ' in ' + reg,
    text:
      'STRATEGY ' + n + ' — ' + fam.toUpperCase() + '\n\n' +
      'Context: works best on ' + mkt + ' when the ' + tf + ' chart is ' + reg + '. ' +
      'The edge comes from participants who are forced to exit at the wrong time.\n\n' +
      'SETUP: wait for structure label ' + (i % 4) + ' — a sequence of ' + (i % 2 ? 'higher lows' : 'lower highs') +
      ' into a zone tested ' + (2 + (i % 3)) + ' times. Volume must contract during the approach.\n\n' +
      'ENTRY: trigger on the ' + (i % 2 ? 'first close back through the zone' : 'rejection wick at the zone') +
      ' with a candle range above the ' + (10 + (i % 10)) + ' period average.\n\n' +
      'INVALIDATION: a close beyond the ' + (i % 3 ? 'zone far edge' : 'sweep low') +
      ' voids the idea. Move nothing, widen nothing.\n\n' +
      'TARGET: first partial at ' + (1 + (i % 2)) + 'R, runner to the opposite liquidity pool.\n\n' +
      'RISK: ' + (0.25 + (i % 4) * 0.25) + '% of equity, sized from the stop distance, halved when ' +
      reg + ' turns against the trade.\n\n' +
      'MISTAKES: entering before the trigger candle closes; taking the trade during ' +
      REGIMES[(i + 2) % REGIMES.length] + '; repeating after two consecutive stops.'
  };
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-bench-'));
  const core = createCore({ dataDir: dir });
  console.log('Feeding ' + N_SOURCES + ' synthetic strategies through the real pipeline…\n');

  const t0 = Date.now();
  let chunks = 0;
  for (let i = 0; i < N_SOURCES; i++) {
    const d = doc(i);
    const r = await core.ingestText(d.text, d.title);
    if (!r.ok) throw new Error('ingest failed: ' + r.error);
    chunks += r.chunks;
  }
  const ingestMs = Date.now() - t0;

  const queries = [];
  for (let q = 0; q < N_QUERIES; q++) {
    const fam = FAMILIES[(q * 11) % FAMILIES.length];
    const reg = REGIMES[(q * 5) % REGIMES.length];
    queries.push(['where is the stop on a ' + fam + ' when the market is ' + reg,
      'entry trigger for ' + fam + ' on ' + MARKETS[q % MARKETS.length],
      'risk sizing for ' + reg + ' conditions'][q % 3]);
  }
  const lats = [];
  const t1 = Date.now();
  for (const q of queries) {
    const a = Date.now();
    core.search(q, 5);
    lats.push(Date.now() - a);
  }
  const searchMs = Date.now() - t1;
  lats.sort((a, b) => a - b);

  const a0 = Date.now();
  const st = core.state('bench');
  const stateMs = Date.now() - a0;

  const p0 = Date.now();
  core.pack(queries[0], 'is this a valid setup?');
  const packMs = Date.now() - p0;

  core.kb.save();   // flush the debounced write so we can measure on-disk size
  const kbBytes = fs.statSync(path.join(dir, 'knowledge.json')).size;
  const per = ingestMs / N_SOURCES;

  console.log('  sources ingested      ' + N_SOURCES);
  console.log('  searchable chunks     ' + chunks);
  console.log('  knowledge base on disk ' + (kbBytes / 1024).toFixed(0) + ' KB');
  console.log('');
  console.log('  ingest throughput     ' + per.toFixed(1) + ' ms/strategy  (' + (1000 / per).toFixed(0) + ' strategies/sec)');
  console.log('  search latency        p50 ' + pct(lats, 0.5) + ' ms · p95 ' + pct(lats, 0.95) + ' ms · max ' + lats[lats.length - 1] + ' ms');
  console.log('  coach context pack    ' + packMs + ' ms');
  console.log('  full state load       ' + stateMs + ' ms');
  console.log('');
  console.log('  Extrapolation (linear, conservative):');
  for (const n of [1000, 5000, 10000]) {
    const k = n / N_SOURCES;
    console.log('    ' + String(n).padStart(5) + ' strategies ≈ ' +
      String(Math.round(chunks * k)).padStart(6) + ' chunks · ' +
      String((kbBytes * k / 1024 / 1024).toFixed(1)).padStart(5) + ' MB on disk · ' +
      'full reindex ' + (ingestMs * k / 1000).toFixed(0) + 's · search ~' +
      (pct(lats, 0.5) * Math.log2(k + 1) / 1 + pct(lats, 0.5)).toFixed(0) + ' ms');
  }
  console.log('');
  console.log('  Top hit sanity check for "where is the stop on a liquidity sweep…":');
  core.search('where is the stop on a liquidity sweep when the market is ranging', 3).hits
    .forEach((h, i) => console.log('    ' + (i + 1) + '. ' + h.source.title + '  (' + h.score.toFixed(2) + ')'));

  fs.rmSync(dir, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
