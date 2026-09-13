'use strict';
/* vision.js — how the companion understands a screenshot of a chart.
 *
 * Two independent readers:
 *  1. localRead()  — offline, no AI, no key. The UI downsamples the screenshot
 *     into a compact colour signature (green-pixel map, red-pixel map, bright
 *     map). From that we reconstruct a rough price path column by column and
 *     measure trend, momentum, volatility and position in range. Crude, but
 *     real and instant — and it also *feeds the AI* as a hint so small models
 *     do far better on chart images.
 *  2. chartPrompt()/parseChartRead() — the vision-model route: a strict JSON
 *     contract describing what is on screen, with risk flags and a teach-me hook.
 */

const CHART_SYSTEM =
  'You are the live trading coach inside a floating desktop companion app. ' +
  'You are watching a screenshot of the trader\'s screen while they learn to trade. ' +
  'The trader is a BEGINNER. Be concrete, calm, and protective of their capital.\n' +
  'Rules for you:\n' +
  '- Describe only what is actually visible. Never invent prices, symbols, indicators or numbers you cannot see. ' +
  'If something is not readable, say "not visible".\n' +
  '- You are teaching, not signalling. Never say "buy now" or "sell now" as an instruction; say what a disciplined ' +
  'trader would be evaluating and what would invalidate the idea.\n' +
  '- Always include one risk-management point (position size, stop placement, or reason to stand aside).\n' +
  '- Keep it short and skimmable. This appears in a narrow side panel while they trade.\n' +
  '- This is education, not financial advice.\n' +
  'Return ONLY a single JSON object, no markdown fences, no commentary, in exactly this shape:\n' +
  '{\n' +
  '  "screen": "chart|order-ticket|watchlist|news|video|other",\n' +
  '  "symbol": "what is being traded, or null",\n' +
  '  "timeframe": "e.g. 5m, 1H, 4H, 1D, or null",\n' +
  '  "trend": "up|down|flat|mixed|unknown",\n' +
  '  "structure": "one line: where price is relative to recent highs/lows and key levels",\n' +
  '  "patterns": ["up to 3 patterns actually visible"],\n' +
  '  "levels": {"support": ["..."], "resistance": ["..."]},\n' +
  '  "indicators": ["only ones actually visible, with their visible state"],\n' +
  '  "momentum": "buyers|sellers|balanced|unknown",\n' +
  '  "riskFlags": ["0-3 real dangers visible, e.g. oversize position, no stop, news candle, chasing a spike"],\n' +
  '  "see": ["3-5 short bullet observations a beginner should notice"],\n' +
  '  "action": "the one disciplined next step (often: wait, mark a level, reduce size, journal it)",\n' +
  '  "teach": "the single most useful 1-2 sentence lesson this exact screen offers a beginner",\n' +
  '  "lessonTag": "one of: price action|support & resistance|trend trading|breakouts|risk management|chart patterns|indicators|volume|psychology|trading plan",\n' +
  '  "confidence": 0.0\n' +
  '}';

/**
 * Build the user-side prompt.
 * @param {{local?:object, question?:string, playbook?:string, kbContext?:string, journal?:string, skills?:string, previous?:string}} ctx
 */
function chartPrompt(ctx) {
  const c = ctx || {};
  const parts = [];

  if (c.local && c.local.looksLikeChart) {
    parts.push('OFFLINE PRE-READ of the same screenshot (measured from pixels, may be imprecise — use it as a hint, ' +
      'correct it if the image disagrees):\n' + describeLocal(c.local));
  } else if (c.local) {
    parts.push('OFFLINE PRE-READ: the screenshot does not look like a candlestick chart ' +
      '(confidence ' + (c.local.confidence || 0) + '). Decide what kind of screen it is.');
  }

  if (c.playbook) parts.push('THE TRADER\'S OWN PLAYBOOK (distilled from videos/links they fed me — prefer these rules):\n' + c.playbook);
  if (c.kbContext) parts.push('QUOTES FROM THE TRADER\'S KNOWLEDGE BASE (cite as [n] — these numbers match the quotes):\n' + c.kbContext);
  if (c.skills) parts.push('WHAT THEY ALREADY KNOW / STRUGGLE WITH:\n' + c.skills);
  if (c.journal) parts.push('RECENT JOURNAL (so you do not repeat yourself and can spot patterns in their mistakes):\n' + c.journal);
  if (c.previous) parts.push('WHAT YOU SAID LAST TIME (only speak up again if something changed or you have a new angle):\n' + c.previous);
  if (c.question) parts.push('THE TRADER ASKED:\n"' + c.question + '" — answer this first, then give the screen read.');

  parts.push('Now read the attached screenshot and return the JSON object only.');
  return parts.join('\n\n');
}

/** Plain-English description of the offline pixel read (used as an AI hint). */
function describeLocal(l) {
  if (!l) return '';
  const m = l.measures || {};
  return [
    'chartLikelihood=' + pct(l.confidence),
    'trend=' + l.trend + ' (slope ' + fmt(m.slope) + ' rows per column over the last ' + (m.span || 0) + ' columns)',
    'momentum=' + l.momentum + ' (greenShare right half ' + pct(m.greenRight) + ' vs left half ' + pct(m.greenLeft) + ')',
    'volatility=' + l.volatility + ' (price path range ' + pct(m.rangeRatio) + ' of the visible height, average column spread ' + pct(m.avgSpread) + ')',
    'positionInRange=' + l.positionInRange + ' (latest price proxy at ' + pct(m.lastPosition) + ' from the top)',
    'regime=' + l.regime,
    'candlesDetected≈' + (m.columns || 0) + ' columns with colour; image ' + (m.cols || 0) + 'x' + (m.rows || 0) + ' sample grid',
    l.observations && l.observations.length ? 'observations: ' + l.observations.join(' | ') : ''
  ].filter(Boolean).join('\n');
}

function pct(x) { return (Math.round((Number(x) || 0) * 1000) / 10) + '%'; }
function fmt(x) { return (Math.round((Number(x) || 0) * 1000) / 1000).toString(); }

/* --------------------------- offline pixel reader --------------------------- */

/**
 * Decode a colour signature produced by the UI.
 * Signature: { cols, rows, g, r, b } where g/r/b are base64 strings of
 * cols*rows bytes, each byte = how much green/red/bright ink is in that cell (0-255).
 */
function decodeSignature(sig) {
  if (!sig || !sig.cols || !sig.rows) return null;
  const n = sig.cols * sig.rows;
  const dec = (s) => {
    if (!s) return new Uint8Array(n);
    const buf = Buffer.from(String(s).replace(/^data:[^,]*,/, ''), 'base64');
    const out = new Uint8Array(n);
    for (let i = 0; i < Math.min(n, buf.length); i++) out[i] = buf[i];
    return out;
  };
  return { cols: sig.cols, rows: sig.rows, g: dec(sig.g), r: dec(sig.r), b: dec(sig.b) };
}

/**
 * Offline chart read from a decoded signature.
 * @param {object} sig raw signature (or already-decoded {cols,rows,g,r,b})
 */
function localRead(sig) {
  const s = sig && sig.g instanceof Uint8Array ? sig : decodeSignature(sig);
  if (!s) return emptyRead('No image data was captured.');

  const { cols, rows, g, r, b } = s;
  const INK = 26; // minimum ink in a cell to count as "something drawn here"

  // Per-column statistics over the coloured (candle-ish) ink.
  const colStats = [];
  let totalGreen = 0, totalRed = 0, totalBright = 0, colouredCells = 0;

  for (let x = 0; x < cols; x++) {
    let wSum = 0, wTotal = 0, top = -1, bottom = -1, greenInk = 0, redInk = 0;
    for (let y = 0; y < rows; y++) {
      const i = y * cols + x;
      const gi = g[i], ri = r[i], bi = b[i];
      totalGreen += gi; totalRed += ri; totalBright += bi;
      const ink = Math.max(gi, ri);
      if (ink >= INK) {
        colouredCells++;
        if (top < 0) top = y;
        bottom = y;
        const w = gi + ri;
        wSum += y * w;
        wTotal += w;
        greenInk += gi; redInk += ri;
      }
    }
    colStats.push({
      x, top, bottom,
      center: wTotal > 0 ? wSum / wTotal : -1,
      spread: (top >= 0 && bottom >= 0) ? (bottom - top + 1) / rows : 0,
      green: greenInk, red: redInk,
      ink: greenInk + redInk
    });
  }

  const totalInk = totalGreen + totalRed;
  const inkRatio = totalInk / Math.max(1, cols * rows * 255);
  const brightRatio = totalBright / Math.max(1, cols * rows * 255);
  const greenShareAll = totalInk > 0 ? totalGreen / totalInk : 0;

  // A chart usually has: some coloured ink, in most columns, not everywhere.
  const activeCols = colStats.filter((c) => c.ink > 0);
  const looksLikeChart = inkRatio > 0.004 && activeCols.length >= Math.max(4, cols * 0.3) && inkRatio < 0.45;

  if (!looksLikeChart) {
    const observations = [];
    if (brightRatio > 0.12) observations.push('Mostly bright/white screen — probably text, a document or a light-theme page rather than a candlestick chart.');
    if (inkRatio <= 0.004) observations.push('Almost no green/red ink — could be a watchlist, an order ticket, a video, or a chart with no candles visible.');
    if (activeCols.length && activeCols.length < cols * 0.3) observations.push('Coloured ink only in a few columns — possibly one small chart widget or coloured buttons.');
    return {
      looksLikeChart: false,
      trend: 'unknown', momentum: 'unknown', volatility: 'unknown',
      positionInRange: 'unknown', regime: 'not-a-chart',
      confidence: Math.round(Math.min(0.9, 0.2 + brightRatio * 2 + (1 - inkRatio)) * 100) / 100,
      observations: observations.length ? observations : ['This screen does not look like a candlestick chart to the offline reader.'],
      measures: { cols, rows, inkRatio, brightRatio, greenShareAll, activeCols: activeCols.length }
    };
  }

  // Trim the left/right edges where chart UI (axes, labels) lives, then use the
  // ink-weighted centre as a price proxy per column.
  const usable = activeCols.filter((c) => c.center >= 0 && c.ink > INK);
  const series = usable.map((c) => c.center);
  const n = series.length;
  const half = Math.max(1, Math.floor(n / 2));

  const firstHalfMean = mean(series.slice(0, half));
  const secondHalfMean = mean(series.slice(half));
  const minC = Math.min.apply(null, series);
  const maxC = Math.max.apply(null, series);
  const rangeRatio = (maxC - minC) / rows;
  const lastPosition = (series[n - 1] - minC) / Math.max(1, maxC - minC);

  // Linear regression slope in rows-per-column (negative = price rising, since
  // screen y grows downwards).
  const slope = regressionSlope(series);
  const rising = -slope;

  const greenRight = shareRight(g, r, cols, rows, INK);
  const greenLeft = shareLeft(g, r, cols, rows, INK);

  const avgSpread = mean(usable.map((c) => c.spread));
  const spikes = usable.filter((c) => c.spread > avgSpread * 2.2 && avgSpread > 0).length;

  let trend = 'flat';
  const trendStrength = Math.min(1, Math.abs(rising) / Math.max(0.06, rows * 0.012));
  if (rising > 0.06 && rangeRatio > 0.12) trend = 'up';
  else if (rising < -0.06 && rangeRatio > 0.12) trend = 'down';
  else if (rangeRatio <= 0.12) trend = 'flat';
  else trend = 'mixed';

  let momentum = 'balanced';
  if (greenRight - greenLeft > 0.1) momentum = 'buyers';
  else if (greenLeft - greenRight > 0.1) momentum = 'sellers';
  if (trend === 'up' && momentum === 'sellers') momentum = 'mixed';
  if (trend === 'down' && momentum === 'buyers') momentum = 'mixed';

  let volatility = 'normal';
  if (rangeRatio > 0.55 || avgSpread > 0.45) volatility = 'high';
  else if (rangeRatio < 0.22 && avgSpread < 0.16) volatility = 'low';

  let positionInRange = 'middle';
  if (lastPosition > 0.72) positionInRange = 'top';
  else if (lastPosition < 0.28) positionInRange = 'bottom';

  let regime = trend === 'flat' ? (volatility === 'low' ? 'tight consolidation' : 'ranging') : (trend + 'trend');
  if (spikes >= 2) regime += ' with expansion candles (possible news)';

  const observations = [];
  observations.push('Price proxy moved ' + (rising > 0 ? 'UP' : rising < 0 ? 'DOWN' : 'SIDEWAYS') +
    ' across the visible candles (slope ' + fmt(rising) + ' rows/column, range ' + pct(rangeRatio) + ' of the pane).');
  observations.push('Green ink share: ' + pct(greenShareAll) + ' overall; right half ' + pct(greenRight) + ' vs left half ' + pct(greenLeft) +
    ' → momentum favours ' + momentum + '.');
  observations.push('Average candle spread ' + pct(avgSpread) + ' → volatility reads ' + volatility + '.');
  observations.push('Latest candles sit near the ' + positionInRange + ' of the visible range.');
  if (spikes) observations.push(spikes + ' column(s) are 2x+ the average range — expansion or news candle; that is where beginners get hurt.');
  if (volatility === 'low') observations.push('Tight range: breakouts from here often fake out first. Wait for a close outside the range.');
  if (positionInRange === 'top' && trend === 'up') observations.push('Extended near the top of the range — chasing here usually means a bad risk:reward.');
  if (positionInRange === 'bottom' && trend === 'down') observations.push('Extended near the bottom — knife-catching territory unless a higher low forms.');

  return {
    looksLikeChart: true,
    trend,
    trendStrength: Math.round(trendStrength * 100) / 100,
    momentum,
    volatility,
    positionInRange,
    regime,
    confidence: Math.round(Math.min(0.85, 0.35 + inkRatio * 8 + (activeCols.length / cols) * 0.3) * 100) / 100,
    observations,
    measures: {
      cols, rows, columns: n, inkRatio: round(inkRatio), brightRatio: round(brightRatio),
      greenShareAll: round(greenShareAll), greenLeft: round(greenLeft), greenRight: round(greenRight),
      rangeRatio: round(rangeRatio), avgSpread: round(avgSpread), slope: round(slope),
      span: n, lastPosition: round(lastPosition), spikes
    }
  };
}

function emptyRead(why) {
  return {
    looksLikeChart: false, trend: 'unknown', momentum: 'unknown', volatility: 'unknown',
    positionInRange: 'unknown', regime: 'unknown', confidence: 0,
    observations: [why], measures: {}
  };
}

function shareRight(g, r, cols, rows, INK) { return sideShare(g, r, cols, rows, INK, Math.floor(cols / 2), cols); }
function shareLeft(g, r, cols, rows, INK) { return sideShare(g, r, cols, rows, INK, 0, Math.floor(cols / 2)); }

function sideShare(g, r, cols, rows, INK, x0, x1) {
  let gi = 0, ri = 0;
  for (let x = x0; x < x1; x++) {
    for (let y = 0; y < rows; y++) {
      const i = y * cols + x;
      if (g[i] >= INK || r[i] >= INK) { gi += g[i]; ri += r[i]; }
    }
  }
  return gi + ri > 0 ? gi / (gi + ri) : 0;
}

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function round(x) { return Math.round((Number(x) || 0) * 10000) / 10000; }

function regressionSlope(ys) {
  const n = ys.length;
  if (n < 3) return 0;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxy += i * ys[i]; sxx += i * i; }
  const den = n * sxx - sx * sx;
  return den === 0 ? 0 : (n * sxy - sx * sy) / den;
}

/* ------------------------------ AI read parsing ----------------------------- */

const VALID_SCREEN = ['chart', 'order-ticket', 'watchlist', 'news', 'video', 'other'];
const VALID_TREND = ['up', 'down', 'flat', 'mixed', 'unknown'];
const VALID_MOMENTUM = ['buyers', 'sellers', 'balanced', 'unknown'];
const VALID_TAGS = ['price action', 'support & resistance', 'trend trading', 'breakouts', 'risk management',
  'chart patterns', 'indicators', 'volume', 'psychology', 'trading plan'];

function extractJson(raw) {
  let t = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
    // Trailing commas / smart quotes are the usual offenders.
    try {
      return JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1').replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));
    } catch {}
  }
  return null;
}

function listOf(x, limit) {
  if (!x) return [];
  const arr = Array.isArray(x) ? x : String(x).split(/[;,]\s*/);
  return arr.map((s) => String(s == null ? '' : s).trim()).filter(Boolean).slice(0, limit || 5);
}

/** Validate + normalise the model's JSON so the UI never renders garbage. */
function parseChartRead(raw) {
  const j = extractJson(raw);
  if (!j || typeof j !== 'object') return { ok: false, error: 'The brain did not return readable JSON.' };

  const levels = j.levels && typeof j.levels === 'object' ? j.levels : {};
  const read = {
    ok: true,
    screen: VALID_SCREEN.includes(String(j.screen)) ? String(j.screen) : 'other',
    symbol: (j.symbol == null || j.symbol === 'null') ? null : String(j.symbol).slice(0, 40),
    timeframe: (j.timeframe == null || j.timeframe === 'null') ? null : String(j.timeframe).slice(0, 12),
    trend: VALID_TREND.includes(String(j.trend)) ? String(j.trend) : 'unknown',
    structure: String(j.structure || '').slice(0, 400),
    patterns: listOf(j.patterns, 3),
    levels: {
      support: listOf(levels.support, 4).map((s) => s.slice(0, 60)),
      resistance: listOf(levels.resistance, 4).map((s) => s.slice(0, 60))
    },
    indicators: listOf(j.indicators, 5),
    momentum: VALID_MOMENTUM.includes(String(j.momentum)) ? String(j.momentum) : 'unknown',
    riskFlags: listOf(j.riskFlags, 3),
    see: listOf(j.see, 5),
    action: String(j.action || '').slice(0, 400),
    teach: String(j.teach || '').slice(0, 500),
    lessonTag: VALID_TAGS.includes(String(j.lessonTag)) ? String(j.lessonTag) : null,
    confidence: clamp01(j.confidence)
  };
  return read;
}

function clamp01(x) {
  if (x == null || x === '' || x === 'null' || x === 'undefined') return 0.5;
  const n = Number(x);
  if (!isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

/** Turn any read (AI or offline) into one comparable "scene key" so the coach
 *  does not repeat itself every few seconds. */
function sceneKey(read) {
  if (!read) return '';
  const r = read;
  return [r.screen || r.regime, r.symbol, r.timeframe, r.trend, r.momentum, r.volatility,
    (r.patterns || []).slice(0, 2).join('+'), (r.levels && r.levels.resistance || []).slice(0, 1).join(''),
    (r.riskFlags || []).slice(0, 1).join('')].filter(Boolean).join('|').toLowerCase();
}

const __exports = {
  CHART_SYSTEM, chartPrompt, describeLocal, localRead, decodeSignature,
  parseChartRead, extractJson, sceneKey, VALID_TAGS, clamp01
};
// Works in Node (require) and in the browser/Electron renderer (<script> tag).
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
if (typeof globalThis !== 'undefined') { globalThis.TCEngine = globalThis.TCEngine || {}; globalThis.TCEngine.vision = __exports; }
