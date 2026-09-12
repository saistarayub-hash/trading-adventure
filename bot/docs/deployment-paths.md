# Running this bot without MetaTrader

MT5 is one of about six ways to get orders into the market. It is the *default* in this product
category only because the retail forex industry grew around MetaQuotes, not because it's good.

Here's the honest map for a bot that trades **one position, once a day, inside a one-hour window**
— a workload with almost no latency requirement, which changes what's worth picking.

---

## The decision in one table

| Path | Language | Cost | Real money? | Fits *this* bot? | Main pain |
|---|---|---|---|---|---|
| **MT4/MT5 EA** | MQL5 | VPS ~$10/mo | yes | ✅ native | Windows box, compiled black box, `OnTick` only when a tick arrives, no real concurrency, no tests, no git-diffable logic |
| **OANDA REST v20** | anything | free (spread only) | ✅ live + practice | ✅ best general choice | US accounts: NFA/FIFO + 50:1, wider spreads, no true ECN |
| **cTrader Automate / Open API** | C# (or gRPC from any) | free | ✅ | ✅ cleanest API of the retail bunch | Smaller broker pool, C# if you use their SDK |
| **IG Labs REST/Streaming** | anything | free API | ✅ | ✅ good fills, tight majors | API approval friction, docs are terse |
| **Interactive Brokers (TWS/Gateway/FIX)** | Python/Java/… | commission | ✅ | ⚠️ works, ugly for spot FX | IBKR spot FX spread + commission eats a 9-pip target; overkill |
| **FIX / LMAX / Currenex / institutional** | anything | high min. | ✅ | ❌ not for this | Onboarding, volume commitments, infra |
| **TradingView webhook → bridge** | Pine + webhook | ~$15–60/mo | via broker | ⚠️ for signals only | You lose the state machine; a webhook is not an order-management system |
| **Broker copy-trading bridges** (Myfxbook/mambetou, Duplilike, Signal Stack) | — | $20–50/mo | ✅ | ⚠️ hacky | Signal lag, slippage, another failure surface — and MT5 is still on one end anyway |
| **Crypto (Alpaca/Binance/Bybit/OKX)** | anything | free API | ✅ | ✅ *as a rehearsal* | Different market: 24/7, no rollover, no session edge — the strategy's premise doesn't transfer |
| **Paper only (this repo)** | JS | $0 | no | ✅ **start here** | none — that's the point |

---

## What I'd actually do, in order

### 0. Keep the strategy where it is
`lib/engine.js` has no I/O, no dependencies and no market access. Every option below stays a
**thin adapter** around it: `fetchCandles()`, `positions()`, `place()`, `close()`. If you ever
switch brokers or platforms, only the adapter changes. That is the single most valuable property
of how this is built, so don't let it rot into "the MT5 EA is the real one".

### 1. Paper loop on the machine you already have → then a $5/mo VPS
`node bot/live.js --replay` (done) and `--broker paper` exercise the *whole* loop — clock, gates,
sizing, reconciliation, journal — with no broker account. Then move the same process to a VPS.
Nothing about the strategy code changes when you go live; only the adapter and one env var.

### 2. Pick a broker by API quality, not by spread advertising
For a 9-pip target, **cost realism beats marketing**. What to check before you sign up:
- REST API with **attached stop/take-profit** on the order (so protection survives your bot dying) — OANDA ✅, cTrader ✅, IG ✅, MT5 ✅ (server-side SL/TP).
- **Historical candle endpoint** you can pull from directly (OANDA ✅) — this is how you get real
  bars into `--csv` without buying a data feed.
- Actual live spread **in your trade hour**, not on the homepage. Measure it for a week. Our
  `night-spread-trap` preset exists to show this is the whole ballgame.
- Account currency, leverage rules (US = NFA/FIFO: no hedging, first-in-first-out — the reference
  `MaxSpread`/FIFO compatibility claim in the teardown matters here), swap rates at 22:00, and
  whether they allow scalping/automated trading at all.
- Server location, so you can put the VPS next to it (London LD4 / NY4 / Tokyo / Zurich).

### 3. Only consider MT5 if something *forces* it
MT5 wins in exactly three cases: (a) you want a **prop-firm funded account** — they overwhelmingly
require MT4/MT5 and their bridge is the rule; (b) you want **their tick-level strategy tester** and
99% modelling; (c) you need to trade a broker that only offers MetaTrader. Otherwise the
operational cost — Windows, RDP, a black-box `.ex5`, no tests, no debugger, a terminal GUI that
must not be closed — buys you nothing at one trade a day.

### 4. If you do go the MT5 route anyway
Do it as **MT5 for execution + Node for research**, not "MQL for everything". Keep the preset JSONs
as the source of truth (already true: `tools/export-set.js` generates the `.set` files and refuses to
emit an input name the EA doesn't declare), keep the backtester as the judge, and use MT5's tester
only to confirm on real tick data. The failure mode of EA-first projects is that the only
implementation of the strategy is a compiled file nobody can test.

---

## Ops checklist (this is where live bots actually die, not in the strategy)

**Order safety**
- [ ] Stop-loss and take-profit are **attached to the order at the broker**, not held in your process. If your bot crashes, the market must still be safe.
- [ ] Idempotent orders: a client order ID per intended entry (`FuryPlus-<symbol>-<dayKey>`), so a retry after a timeout cannot double up.
- [ ] Reconcile on every cycle: broker positions are truth, your state file is a cache. Never assume an order exists because you sent it.
- [ ] Handle `PARTIALLY_FILLED`, requotes, market-closed, and "position closed by broker stop-out" explicitly.

**Runtime**
- [ ] VPS in the same datacentre region as the broker; **NTP-synced clock** (session windows are time-gated — a drifting clock silently moves your hour, which is the same bug as a wrong GMT offset).
- [ ] Wake on new bar (poll the candle timestamp) rather than `setInterval` — an interval that fires at :14:59.8 sees an incomplete bar.
- [ ] Persist state (day journal, halt flags, consec-loss count) to disk; a restart must not reset a halt and start trading again.
- [ ] Watchdog: alert if no heartbeat in N minutes, if data feed stalls, if spread > gate for > X, if broker position count ≠ expected.
- [ ] Alerting to ntfy/Telegram on every fill and every halt. Silent failure is the expensive one.

**Kill switches, in order of bluntness**
- [ ] `dailyLossCapPct` (engine has it) → halts the day
- [ ] `equityStopPct` (engine has it) → stops until a human restarts
- [ ] broker-side account-level max drawdown alert
- [ ] a `STOP` file / env flag you can flip from your phone that makes the loop flatten and idle
- [ ] manual "close all + disable" script, tested before you need it

**Data & records**
- [ ] Append every decision to a journal (fills, skips, reasons) — `bot/live.js` writes `live-journal.csv`.
- [ ] Weekly: diff your journal against broker statements. Divergence between "what the model said"
      and "what I got" is the only reliable early warning of decay. That gap (98% → 88%) is the
      documented graveyard of this strategy family.
- [ ] Never let the backtest read the same file the live loop writes.

---

## Concrete stack I'd pick on this repo today

```
strategy        bot/lib/engine.js                       (exists, 45 tests)
backtest/judge  bot/backtest.js --csv real_bars.csv     (exists)
live loop       bot/live.js                             (exists: paper + replay, adapter-shaped)
broker          OANDA v20 REST  — Node 22 fetch, zero deps, practice env first
data            OANDA candles endpoint -> bot/tools/fetch-data.js -> CSV
host            $5/mo Hetzner/DO VPS (Debian), systemd unit, NTP
alerts          ntfy.sh topic (1 line, no account)
storage         the journal CSV + a state JSON on the box
```
≈ $5/month, no Windows, everything inspectable, and the strategy file is the same one that's tested.

### What I did *not* build yet, and why
- **A live OANDA/cTrader adapter you can point at real money.** I wrote the contract and a paper
  implementation, plus a documented adapter skeleton — because an untested order-placement path is
  the kind of thing that loses money while you read the README, and I can't reach the network from
  this sandbox to verify a single call against the real API. It needs your key and a practice
  account before it's worth trusting.
- **Any claim that this version is profitable.** See the banner in `backtest.js`: the default feed
  is synthetic and embeds mean reversion, so it favours fade presets by construction. The numbers
  here prove mechanics only.
