# FuryPlus — a working, better version of the "Forex Fury" class of bot

Same category as [Forex Fury](https://www.forexfury.com/): a **time-window, low-volatility range
scalper** for MetaTrader. One quiet hour a day, fade the edges of a compressed range, take a small
target, one position, one pair.

The research that drove this is in [`../research/forex-fury-teardown.md`](../research/forex-fury-teardown.md).
This folder is the build.

There are two halves, and they share one parameter vocabulary so they cannot drift apart:

| | what it is | status |
|---|---|---|
| `lib/engine.js` + `backtest.js` | the strategy as pure JS, with a backtester, Monte-Carlo, walk-forward and cost model | **runs here today**, 49 tests green |
| `live.js` | paper/live loop around the same engine, with idempotent orders, restart-safe state and a broker-vs-backtest replay test | mechanics verified; **exit path known-divergent, see below** |
| `mql5/FuryPlus.mq5` | the same state machine as a real MT5 Expert Advisor | needs compiling in MetaEditor — the sandbox has no MQL toolchain |

---

## Run it

```bash
node bot/test.js                     # 49 tests: safety rails, arithmetic, determinism, live/backtest parity
node bot/live.js --replay --days 60  # does the live loop agree with the backtest? (currently: entries yes, exits NO)
node bot/backtest.js --list          # available presets
node bot/backtest.js --all           # every preset side by side
node bot/backtest.js --preset quiet-eve-low --days 900
node bot/backtest.js --preset quiet-eve-low --csv GBPUSD_M15.csv --equity 10000
node bot/backtest.js --preset quiet-eve-low --sweep      # TP/SL grid, R:R reported per cell
node bot/backtest.js --preset quiet-eve-low --ablate all # turn the filters off: do they earn their keep?
node bot/tools/calibrate.js          # prove the synthetic feed has real-world magnitudes
node bot/tools/export-set.js         # regenerate .mt4.set / .mt5.set from the JSON presets
node bot/tools/mql-check.js          # static checks on the EA source (not a compiler)
```

Outputs land in `bot/out/`: JSON bundle, `*.trades.csv` (full trade list), `*.equity.csv`, and a
`*.report.html` equity/stats page.

`npm test` runs the app's own suite *and* the bot's.

## Deploy to MetaTrader

1. Copy `bot/mql5/FuryPlus.mq5` → `MQL5/Experts/`, compile in MetaEditor (0 errors expected; the
   static checker is not a substitute for it).
2. Attach to a **M15** chart of the preset's symbol. Keep `InpDryRun = true` for the first week.
3. Load `bot/out/<preset>.mt5.set` from the EA's Inputs dialog.
4. Read the on-chart panel before you touch anything: it prints the **auto-detected broker server
   offset**, current spread vs the gate, the regime read (ATR/ADX/z), halt state and last reject reason.
5. Demo account, 30+ days, then compare its CSV log against your own statements. Not against a widget.

There is deliberately **no licence check**. Username-bound activation protects nobody — the binaries
and `.set` files of every popular EA are on warez sites within days — while a config plus a track
record is what actually has value.

---

## Design deltas: every one is aimed at a documented failure

The point of studying this product is that its critics told us exactly what to fix.

| Documented problem | Ours |
|---|---|
| Default/legacy configs shipped **5-pip TP vs 29-pip SL or no stop**; you need >90% wins to break even; users who honoured the stop blew accounts ([ForexStore 0/5 backtests, ratios 0.6:1/0.4:1](https://forexstore.com/forex-fury); [Trustpilot](https://ie.trustpilot.com/review/forexfury.com?page=9)) | `assertSafe` **refuses to run** any preset whose cost-aware break-even win rate exceeds 72%, and prints the number. Try `--preset fury-legacy-5-29`. |
| A live user: *"opened May 12th, still not closed, $4–5k in drawdown, the TP shows 1.46 and GBPUSD was last at 1.46 in June 2016"* ([Trustpilot](https://www.trustpilot.com/review/forexfury.com)) | **Hard stop mandatory** + `hardTimeStopBars` + optional `closeAtWindowEnd`. A preset with no time guard is refused. Tested: no trade survives its time stop. |
| Martingale / `LotMultiplier` / `MaxOrders 7` shipped as inputs, admitted *"not used in any of our accounts"* | **Absent from the EA source entirely.** Not a switch, so no set file can smuggle it in. The checker fails the build if `artingale`/`otMultiplier` ever appears. |
| *"make sure to set the GMT correct, I just talked with AI to get the number right"* — wrong offset is the top user error | `TimeGMT() - TimeCurrent()` **auto-detected and printed**; `InpForceServerOffset` only as an override. |
| Advertised window is "4–5pm EST" / 22:00-ish — i.e. **on top of bank rollover**, where spreads blow out and 98% tester win rates become 88% live ([1](https://www.forexcracked.com/forex-ea/asian-session-scalper-ea-free-download-smart-owl-fx-2026-review/), [2](https://newyorkcityservers.com/blog/asian-session-forex-strategy)) | Spread gate in *points* like theirs, plus a spike kill-switch that **flattens open trades**, a rollover blackout, and a cost model with a rollover spread multiplier so the backtest sees it too. The `night-spread-trap` preset exists purely to demonstrate this: same strategy, wrong clock, zero trades. |
| No real news protection | MT5 **economic calendar** filter (high-impact, per-currency, before/after windows) with optional flatten-before-event. |
| *"Only Range Trading"* is a black box | ATR z-score vs its own trailing norm **plus** an ADX ceiling **plus** a range-width test, each individually switchable via `--ablate`, so you can measure whether the filter does anything instead of trusting it. |
| Backtests on the web show a curated demo curve; "no backtests" per ForexStore | Everything is derived from an exported trade list you can recompute: `*.trades.csv`, in-sample vs out-of-sample split, Monte-Carlo DD distribution and **chance of a ≥30% drawdown** — the number no vendor prints. |
| "93% win rate" quoted without the ratio | Every output puts **win rate next to the break-even win rate**, always. |
| The break-even promise was priced on the **advertised** stop, while the engine silently widens it to sit outside the range (`slBeyondRangePips`) | `breakEvenFor()` prices the **worst-case** stop the preset can reach, and refuses outright if the widening has no `slMaxPips` cap. This immediately disqualified two of our own presets that had been passing on fiction — the rail is worth more than the strategy when it catches the author. |
| A regime filter with 78 bars of history reporting "volatility is below its 400-bar norm" | `filters.requireFullHistory` (default on): an undefined z-score or ADX **blocks** entry. Absence of evidence used to be evidence of compliance, which made fresh charts — and the first days of any backtest — trade unfiltered. |
| Best independent numbers came from the *balanced* 16/16 London-open config (3.12%/mo, ~3% DD, PF ~4) | `london-open-balanced` encodes exactly that geometry — it is the honest starting point, not the legacy scalp. |

### Three rails I'd point at as the actual product
1. **Break-even win-rate refusal** — the whole category's reputational problem is one arithmetic
   sign, and it is enforceable at load time.
2. **Lookahead refusal** — a reference range that may include the trade's own hours is the most
   common *silent* structural bug in retail EA backtests. Mine is refused (`sessionRange.end` must
   not run past the window start). This one caught two of my own presets during development.
3. **Mandatory time protection** — an entry that fades a range with no stop and no deadline is not
   a strategy, it is an open-ended bet that mean reversion wins eventually. It usually does. Not on
   your account, in the hour before a rate decision.

---

## Live/backtest parity: how it got to zero

`node bot/live.js --replay --days 150` re-runs the live loop over the same bars the backtest judged,
and compares trade for trade. At 150 days it prints `backtest entries 17 / live-loop entries 17`, `extra 0`, `missed 0`,
`0/17 trades differ on pips/reason/lots`, and exits 0 under `--strict`. The cash numbers sit 0.78 apart
and *should*: two correct implementations on slightly different equity paths round lot size differently.

It did not start there. The replay test was written to be adversarial and it earned its keep by
finding seven bugs that no other check in this repo would have caught:

| Found by the replay test | Fix |
|---|---|
| Runner entered up to 3 bars late, reusing SL/TP derived from a different price — and the engine *allows* late entry because its window stays open, so "the model wanted it" was not a defence | Refuse entry unless the open event is on the current bar; journal `stale` |
| Broker and backtest used different cost models, so logic drift hid inside fee drift | One shared `roundTripCostPips(bar)` used by both, bar-aware |
| Wilder-smoothed ADX seeded from the start of the *passed array*: the same bar scored differently in a full-history backtest and a windowed live run | `adxTrailing()`, trailing-window only; note this silently invalidated a calibrated threshold (`adxMax` 18 → 34) — thresholds are properties of an implementation, not a concept |
| A `--window`-warm-up mismatch: the runner refused to trade before its indicators were warmed while the backtest happily traded, so day-scoped state (loss streak, one-per-day) diverged and *invented* a phantom "extra entry" | `minWarmupBars(cfg)` is now one function used by both the runner and the comparison; a boundary defined twice is a boundary that drifts |
| Comparing the two sides in **cash** made lot-size jitter look like a logic bug and hid a real risk question | Parity is asserted on pips, exit reason and **lot size** (± one `lotStep` of equity-cents jitter, counted and printed); cash is informational |
| **`closeAtWindowEnd` could never fire in live** — the runner returned early on "outside window" *before* reaching its own exit block, so positions sat open into the 22:00 rollover and died on the spread kill-switch instead | Exits are unconditional; only entries are window-gated. The engine already evaluated them in that order |

The lesson that generalises: **every rule the live path owns has to be tested against the model on the
same bars**, because a backtest-only bug is a bad strategy and a live-only bug is a bad Friday. The
last one is the instructive one — it was invisible in 900 days of backtest and only appeared when two
implementations were made to agree.

`--strict` gates invented entries, missed entries, exit-reason divergence and lot size. It deliberately
does **not** gate on cash — a 0.05 tolerance on a replay is theatre, and the per-trade numbers are the
ones logic controls.

Read the clean result for exactly what it is: the runner reproduces the model. It is **not** evidence
the strategy is profitable — on synthetic data the flagship is around break-even, and the parity test
would pass just as happily on a losing one.

## Marking the chart

Markings exist on **both** surfaces, from the same numbers the decision used:

- **`bot/tools/mark-chart.js`** (this repo) — regenerates a marked-up chart from a backtest; details below.
- **`InpDrawLevels`** in `mql5/FuryPlus.mq5` (default true) — draws the entry, TP and SL as trend
  lines anchored at the entry bar, a green rectangle on the profit side and a red one on the risk
  side, plus the measured range hi/lo in purple. The range is marked even when the bot **declines**
  to trade, which is the half that teaches you something: you can watch the filter reject a touch.
  Objects live under the `FP_` prefix `OnDeinit` already deletes, so removing the EA leaves nothing
  on the chart. Draw updates are throttled to once a second because a tick stream will otherwise
  have you calling `ChartRedraw()` hundreds of times a minute for an identical picture.

### The generator — `node bot/tools/mark-chart.js`

```bash
node bot/tools/mark-chart.js --preset quiet-eve-low --days 45     # → bot/out/<preset>.marks.html
node bot/tools/mark-chart.js --preset quiet-eve-low --dir short   # override entries.direction
node bot/tools/mark-chart.js --preset london-open-balanced --csv bars.csv --no-skips
```

Self-contained inline SVG (no CDN, no build step). For each trade
it draws the position box — profit rectangle on the take-profit side, risk rectangle on the stop-loss
side, mirrored for shorts — plus the **auto-detected range hi/mid/lo the engine actually measured**,
the session window, and a tick for every bar it *skipped*, hoverable with the reason.

That range overlay is the point. A fade entry without the levels looks arbitrary; with them you can see
in one glance whether the "range" was a range or a trend the filter failed to catch. The generator also
self-checks: if any box lands on the wrong side of entry it prints `⛔ ... drawn on the wrong side`,
because a lying marking is worse than none. It reports `N/M positions in view` rather than `M`, since
a viewport that silently drops trades is how you end up trusting a chart that is showing you nothing.

`entries.direction` (`both` / `long` / `short`) is enforced in the shared engine, so a long-only
preset is long-only in the backtest, in the live runner, in the marking view, and in the exported
`.set` (`InpTradeDirection` 1) — not a cosmetic filter in one surface.

## What this is not

- **Not evidence that the strategy makes money.** The default feed is synthetic. It has *calibrated
  magnitudes* (see `tools/calibrate.js`: daily range, Asian-session range, M15 ATR, 7× rollover
  spread blowout) so the gates are sane, and it reproduces hostile conditions — but it **embeds mean
  reversion**, which structurally favours fade presets and penalises breakout presets. Comparing two
  strategies on it is comparing them to an assumption. The tool says this in a banner on every run.
  On synthetic data the flagship loses: 103 trades over 900 days, 37.9% win rate against a 68.4%
  break-even, PF 0.67, −2.7%. That is a *mechanics* result, not a signal to fund it — and the number
  under it matters more than the number: **92% of its exits are the window closing, not the
  take-profit**. Same story on `propfirm-strict` (76%), nothing like it on the London breakout preset
  (23%). Which is the whole category in one statistic: inside a bounded quiet window on a
  deliberately low-volatility pair, a 5–9 pip target mostly does not arrive. A vendor who wants a 93%
  win rate does not need a better entry — he needs no stop, no clock, and the patience to hold until
  mean reversion rescues him. Ours fails the check out loud instead.
- **Not advice, not a money machine.** Real FX on margin can lose more than your deposit. If you wire
  this to a live account, that is your decision with your capital, and the correct order of ops is
  `--csv` on your own broker's exported bars → MT5 Strategy Tester on tick data → 30+ days demo →
  then micro lots.
- **Not a Fury clone in the ways that matter legally.** No copied `.ex4`, `.set`, images, testimonials,
  claims, or page copy. Inputs were matched to their **publicly documented** parameter list (their
  own About page) so the two are comparable; the logic here is written from the concept.
- **No marketing rails copied either** — no countdown coupons, no "#1 Rated", no curated stat
  widgets, no solicited five-star reviews to bury one-star ones. Not because I couldn't, but because
  that is the part that makes this category need a teardown.

## Layout

```
bot/
  lib/engine.js       strategy state machine, cost model, stats, Monte-Carlo, walk-forward, safety rails
  lib/presets.js      defaults + deep merge; presets ARE the strategy
  lib/data.js         synthetic generator + MT4/MT5 CSV loader
  backtest.js         CLI, honesty checks, skip-reason diagnosis, report writer
  presets/*.json      quiet-eve-low · london-open-balanced · propfirm-strict · night-spread-trap · fury-legacy-5-29(refused)
  mql5/FuryPlus.mq5   the MT5 Expert Advisor (63 inputs; marks entry/TP/SL + range on the chart)
  tools/              calibrate.js · export-set.js · mql-check.js · mark-chart.js
  out/                generated: reports, trade lists, .set files (gitignorable)
  test.js             49 tests
```
