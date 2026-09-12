#!/usr/bin/env node
'use strict';
/**
 * Static checks for the MQL5 source. This is NOT a compiler — MetaEditor is the only real check and
 * you must compile there. What this catches is the class of mistakes that a compiler would also
 * catch but that are easy to make when nobody in the loop has MetaTrader installed: MQL4-isms,
 * unbalanced blocks, calls to functions that do not exist in MQL5, `input` lines with inline enum
 * bodies, FileOpen modes that silently truncate an append, and reads of a CPositionInfo after close.
 *
 *   node bot/tools/mql-check.js [path.mq5]
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, '..', 'mql5', 'FuryPlus.mq5');
const src = fs.readFileSync(file, 'utf8');
const lines = src.split('\n');

const results = [];
const add = (level, msg, lineNo) => results.push({ level, msg, lineNo: lineNo || 0 });

// strip comments + strings so brace counting is honest
function strip(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}
const code = strip(src);

// ---- 1. block balance ----
let depth = 0;
let minDepth = 0;
for (const ch of code) {
  if (ch === '{') depth++;
  if (ch === '}') depth--;
  minDepth = Math.min(minDepth, depth);
}
if (depth !== 0) add('error', `unbalanced braces: net ${depth}`);
else if (minDepth < 0) add('error', 'a closing brace appears before its opener');
else add('ok', `braces balanced (${(code.match(/\{/g) || []).length} blocks)`);

// ---- 2. MQL4-only constructs that do not compile in MQL5 ----
const MQL4_ONLY = [
  [/#property\s+strict/, "'#property strict' is MQL4-only"],
  [/\bOrderSend\s*\(\s*_Symbol/, "raw OrderSend(...) with _Symbol is MQL4 style; use CTrade"],
  [/\bMarketInfo\s*\(/, "MarketInfo() is MQL4; MQL5 uses SymbolInfoDouble/Integer"],
  [/\bOrderSelect\s*\(/, "OrderSelect() is MQL4; MQL5 uses OrderSelect(ticket) semantics + CPositionInfo"],
  // bare global RefreshRates() is MQL4; CSymbolInfo::RefreshRates() is valid MQL5, so the
  // negative lookbehind on `.` keeps this from firing on legitimate code (a linter that cries
  // wolf gets ignored, which is worse than no linter).
  [/(^|[^.\w>])RefreshRates\s*\(\s*\)/m, "bare global RefreshRates() is MQL4; use syminf.RefreshRates() (CSymbolInfo) or re-read prices"],
  [/\bWindowIncludeBars\b|\bBars\s*\(\s*\)/, "old Bars() forms are MQL4"],
  [/\bPoint\b(?!\s*\))/, "bare `Point` exists in MQL5 but `Digits` as a variable does not; prefer SymbolInfoInteger"],
];
for (const [re, msg] of MQL4_ONLY) {
  const m = src.match(re);
  if (m) add('warn', `${msg} — found "${m[0].trim()}" at line ${src.slice(0, m.index).split('\n').length}`);
}

// ---- 3. functions that do not exist in the MQL5 standard library ----
const FAKE = [
  'HistorySelectLastDealPosition', 'OrderClose', 'OrderModify(', 'iCustom(_Symbol, _Symbol',
  'AccountDouble(', 'AccountInteger(', 'OrderPrint(',
];
for (const f of FAKE) if (src.includes(f)) add('error', `call to non-existent MQL5 symbol: ${f}`);

// ---- 4. input declarations must not embed an enum body ----
lines.forEach((l, i) => {
  if (/^\s*input\s+enum\b/.test(l) || /^\s*input\s+[A-Z_]+\s*\{/.test(l)) add('error', `line ${i + 1}: 'input' cannot declare an inline enum body; declare "enum X {...};" above and use "input X name;"`, i + 1);
});

// ---- 5. dangerous FileOpen mode when appending ----
lines.forEach((l, i) => {
  if (/FileOpen\s*\([^)]*\bFILE_WRITE\b/.test(l) && !/FILE_READ/.test(l)) {
    const before = lines.slice(Math.max(0, i - 4), i).join('\n');
    if (/SEEK_END|append|_trades|log/i.test(before + l)) add('error', `line ${i + 1}: FILE_WRITE without FILE_READ truncates the file (an "append" log that keeps only the last row)`);
  }
});

// ---- 6. reading a position object after closing it ----
lines.forEach((l, i) => {
  if (/PositionClose\s*\(/.test(l)) {
    const after = lines.slice(i, i + 3).join('\n');
    if (/pos\.(Profit|PriceOpen|PriceCurrent|StopLoss|TakeProfit)\(\)/.test(after)) add('warn', `line ${i + 1}: position fields read right after PositionClose — they are stale/unreliable`);
  }
});

// ---- 7. CopyRates/CopyBuffer must be range-checked ----
const copyCalls = (code.match(/\bCopy(Rates|Buffer|Ticks)\s*\(/g) || []).length;
const guards = (code.match(/if\s*\(\s*got|<\s*1|!=\s*count|EMPTY_VALUE/g) || []).length;
if (copyCalls && guards === 0) add('warn', `${copyCalls} data-copy calls with no visible return-count guard — CopyRates can legitimately return fewer bars`);
else add('ok', `${copyCalls} data-copy calls, ${guards} guard(s) present`);

// ---- 8. safety rails must still be in the source ----
const REQUIRED = [
  [/InpRequireHardStop/, 'hard-stop refusal'],
  [/Refuse[sd]? to start[\s\S]{0,400}time-protected|time-protected/, 'time-protection refusal'],
  [/InpMaxBreakEvenWinRate/, 'negative-R:R refusal'],
  [/LOOKAHEAD|lookahead/, 'lookahead refusal'],
  [/TimeGMT\s*\(\s*\)\s*-\s*TimeCurrent\s*\(\s*\)|auto-detect/, 'server-offset auto-detect'],
];
for (const [re, label] of REQUIRED) add(re.test(src) ? 'ok' : 'error', `safety rail present: ${label}`);

// ---- 9. no grid / martingale anywhere ----
for (const bad of [/[Mm]artingale/, /[Ll]otMultiplier/, /[Mm]axOrders\s*=\s*[2-9]/, /[Gg]rid[A-Z]/]) {
  if (bad.test(code)) add('error', `recovery logic found in the EA source (${bad}) — this engine is supposed to be incapable of it`);
}
add('ok', 'no martingale/grid/lot-multiplier logic in source');

// ---- 10. globals used before declared ----
// MetaEditor catches this; we have no compiler, so the checker has to. MQL5 resolves file-scope
// names in source order, so a global declared *below* the function that touches it is a hard compile
// error - and it is exactly what you get when state is added in one patch and the code using it in
// another. Comma-separated declarators (`datetime a = 0, b = 0;`) all count as declared on that line.
{
  const TYPE = /^(?:const\s+)?(?:datetime|double|float|int|long|ulong|uint|bool|string|color|uchar|short|ushort)\b/;
  const depthAt = [];
  let d = 0;
  for (const raw of lines) {
    depthAt.push(d);
    for (const ch of raw) { if (ch === '{') d++; if (ch === '}') d--; }
  }
  const declared = new Map();
  lines.forEach((raw, i) => {
    if (depthAt[i] !== 0) return;
    const t = raw.trim();
    if (!TYPE.test(t) || t.startsWith('input') || t.startsWith('extern')) return;
    for (const part of t.replace(TYPE, '').split(',')) {
      const m = part.match(/^\s*\**([A-Za-z_]\w*)\s*(?:=|;|\(|,|$)/);
      if (m && !declared.has(m[1])) declared.set(m[1], i);
    }
  });
  const offenders = new Map();
  lines.forEach((raw, i) => {
    const t = raw.trim();
    const isOwnDecl = TYPE.test(t) && depthAt[i] === 0;
    for (const m of raw.matchAll(/\b(g_[A-Za-z]\w*)\b/g)) {
      const name = m[1];
      if (!declared.has(name)) {
        if (!offenders.has(name)) offenders.set(name, { line: i + 1, why: 'never declared at file scope' });
      } else if (i < declared.get(name) && !isOwnDecl && !offenders.has(name)) {
        offenders.set(name, { line: i + 1, why: `used before its declaration on line ${declared.get(name) + 1}` });
      }
    }
  });
  for (const [name, o] of offenders) add('error', `global ${name} ${o.why} (line ${o.line})`, o.line);
  if (!offenders.size) add('ok', `${declared.size} file-scope globals declared before use`);
}

// ---- report ----
const counts = { ok: 0, warn: 0, error: 0 };
console.log(`\n  static check of ${path.basename(file)} (${lines.length} lines)\n`);
for (const r of results) {
  counts[r.level]++;
  const tag = r.level === 'ok' ? ' ✓' : r.level === 'warn' ? ' ⚠' : ' ✗';
  console.log(`  ${tag} ${r.msg}`);
}
console.log(`\n  ${counts.error} error(s), ${counts.warn} warning(s). Compile in MetaEditor before use — this is not a substitute.\n`);
process.exit(counts.error ? 1 : 0);
