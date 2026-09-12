# Forex Fury — Full Extraction / Teardown

Source: [forexfury.com](https://www.forexfury.com/) + [About Us (settings list)](https://www.forexfury.com/about-us/)
(pulled 2026-09-11), plus independent reviews and the critical record. Every third-party
claim below is cited. **Sections marked ⚠️ are marketing claims, not verified facts.**

This doc is the research phase for building our own version. It separates
*what they say* from *what the evidence shows*, because the gap between the two
is the single most useful design input we have.

---

## 1. Product identity

| Field | Value |
|---|---|
| Name | Forex Fury (current generation: **"Fury CORE" / "CORE 26"**, plus "V4"/"V6" legacy refs) |
| Category | MetaTrader Expert Advisor (EA) — retail FX automation |
| Platforms | MT4 and MT5, "Build 600+" |
| Market claims | NFA, FIFO, ECN compatible |
| Founded | 2014 (site: "10+ years in business"; other listings say 2015) |
| Scale claims ⚠️ | "26,000+ traders", "46,625+ accounts", "1000+ configurations" |
| Company story | "a group of Forex traders with one mission" — no registered entity disclosed on the marketing pages |
| Named team | Patrick Ryan (CEO, also behind ForexRobotNation), Joe Damien (Head Analyst), Haroon Mir (Head Developer) |
| Distribution | Direct download from a members area, WooCommerce checkout, PayPal |
| Community | Discord |

### Key structural insight
Forex Fury is **a marketing site + a WordPress members area + a compiled `.ex4`/`.ex5` binary +
`.set` config files**. There is no dashboard, no cloud service, no API, no mobile app. The
"product" is: binary + preset files + PDFs/videos + support email + Discord. That is a very small
surface area to reproduce — and it's why this category is so crowded.

**Revenue model is two-stacked:**
1. License sales ($249.99 / $459.99 one-time).
2. **Broker IB (introducing broker) referral commissions** — the FAQ's broker recommendations are
   affiliate links (`bit.ly/aaafxtrade`, `bit.ly/fyntura`, `bit.ly/brokercx`, `paxforex.org/?refid=…`,
   `fxopen.com/?agent=212312`). This is the real long-tail business: every client they route to a
   broker pays the vendor rebate on the client's *volume*, forever, win or lose. Any version we build
   should understand that this second stream usually out-earns the license fee.

---

## 2. The strategy, in their own words

> "Our service uses a **range based trading method that works best in low volatility**. We have
> **filters** to ensure the robot trades during these conditions… **We trade 1 hour per day, and
> 1 pair per account** to ensure that we avoid volatility at all costs, and so that our accounts
> grow steadily."

> "Generally, we expect **0–7 trades per day**."

> "Once the software is installed… it will monitor the markets. When trades are available, the
> robot will place trades automatically, and then close those trades automatically based on the
> settings."

**Translation into an actual strategy:** a *time-window-restricted low-volatility range/mean-reversion
scalper*. It only looks for entries inside a configured hour, only when spread + volatility filters
say the market is quiet, takes 1 trade (or 1 "set" of trades) per day per symbol, and exits on
TP/SL/trailing/dynamic-retrace. Position sizing is fixed-lot or %-risk. Optional — and disabled in
their public accounts — martingale and grid recovery.

Trading window per their own About Us: "around the **late U.S. session (approximately 4–5pm EST)**".
Independent reviewers report different windows in the wild (London open 10:16–11:16 GMT, or 23:00–23:59
broker time) — see §6. Practically: **the window is a per-`.set`-file parameter**, not a fixed idea.

---

## 3. Complete input/parameter spec (the engineering gold)

Straight from [forexfury.com/about-us](https://www.forexfury.com/about-us/) — they document their own
EA inputs. This is the closest thing to a public spec sheet that exists for this product.

### Identity / plumbing
| Input | Type | Meaning |
|---|---|---|
| `Username` | string | license/member binding — **this is the activation lock** |
| `Magic Number` | int | per-chart trade ownership ID; must differ if you run 2 charts |
| `EA_Comment` | string | order comment (used by signal copiers to identify trades) |

### Direction & sizing
| Input | Type | Meaning |
|---|---|---|
| `Trade Direction` | both / longs only / shorts only | bias switch |
| `Fixed lot size` | double | used when `Use Incremental Lot Size = false` |
| `Use Incremental Lot Size` | bool | turns on %-of-equity sizing |
| `Risk per Trade, %` | double | lot size derived from this % when incremental is on |

### Order management / exits
| Input | Type | Meaning |
|---|---|---|
| `Stop Loss` | pips | hard SL |
| `Take Profit` | pips | hard TP |
| `Max Orders` | int | concurrent orders allowed (grid capacity) |
| `Trailing Stop` | pips | trail distance behind price |
| `Trailing Start` | pips | profit needed before trailing arms |
| `Trailing Step` | pips | granularity of trail moves |
| `Dynamic Retrace` | bool | V4 feature — replaces normal SL/trailing (they state **unused on their own accounts**) |
| `Retrace Trigger` | e.g. -300 | floating loss level that arms retrace logic |
| `Retrace Exit` | e.g. -50 | on arm: TP set to -50, SL set to 2× that → exits small-loss on recovery, or full SL if it runs 100 more pips |
| `Martingale` | bool | **they state it is not used on any public account yet** |
| `Lot Multiplier` | double | martingale step multiplier |
| `Max. Steps` | int | cap on martingale doublings |
| `Reverse Strategy` | bool | inverts the signal (their note: "haven't found much practical use") |

### Filters (where the real edge allegedly lives)
| Input | Type | Meaning |
|---|---|---|
| `Start time` / `Stop time` | hour | search window. Open trades **are not force-closed at Stop time** |
| `TimeRestriction` | bool | master switch for time filter |
| `CTHour1…CTHour6` | int | six explicit hour-slots; set 55 to disable a slot |
| `One Set Trade Per Day` | bool | 1 trade-set/day cap ("the robot often makes a mistake when it opens a second set") |
| `Only Range Trading` | bool | volatility/range filter — "excellent for low risk setups, but limits the amount of trades significantly" |
| `Max Spread` | **points** | default **5**; above that, no trades at all |
| `Max Slippage` | points | rejection threshold on fill deviation |
| `RolloverTimeFilter` | bool | suppress trading around server midnight |
| `MinutesBefore` / `MinutesAfter` | int | the rollover blackout window |
| `x_MaxSpreadFilter` / `x_MaxSpread` | bool / mult | spread spike kill-switch: cancels all ops if spread > MaxSpread × x_MaxSpread |
| `TicksTrade` | bool | true = act on tick; false = act on M1 bar open |
| `Trade on Monday…Friday` | bool ×5 | day-of-week gate (clients set Friday=false to avoid weekend holds) |
| `Avoid Economic News` | off / high-impact only | third-party sources report this exists on newer builds; **their own FAQ page advertises no built-in news filter historically** — verify before assuming |

### Cosmetic / diagnostics
`Display Panel`, `BG Color`, `Text Color`, `Text Font Size`, `Offset X`, `Offset Y` — an on-chart
readout showing e.g. current spread. Cheap to build, and the on-chart spread/max-spread readout is
genuinely load-bearing for support ("your spread is too high" resolves 80% of tickets).

### Packaging of those parameters
Members-area ZIP → **4 folders**, each with MT4 + MT5 `.set` files, **plus a PDF of "Monte Carlo testing"
to "predict the most likely outcome of using the new settings"**. Risk tiers: **Low / Medium / High**.
So: strategy code is one binary; *differentiation and upsell live entirely in the config files*.

---

## 4. Pricing & licensing (as observed)

| Tier | Price | Live accounts | Notes |
|---|---|---|---|
| Gold | $249.99 | 1 | "★ Most Popular" |
| Diamond | $459.99 | 2 | "Best Value" |
| Both | — | unlimited **demo** licenses | lifetime membership, free updates for life, install videos, custom strategy settings, Discord |

- One-time payment. "There are NO updates, upsells or extra charges."
- No trial, no refund-by-default (third parties describe refund terms as conditional).
- Instant delivery by email with members-area registration link.
- Minimum deposit: **$0 on demo**, "as low as $100 on a micro account" live. Works on any account size.
- "FALL 🍂" coupon code `FALL` applied at checkout — a **fake-limited-time** discount device. ⚠️
- Historical listings show $229.99/$439.99 — so ~$20 price creep, no subscription.

### Lock mechanism
Username-bound activation + Magic Number + broker-account binding. Classic EA licensing is
"we register your MT4 account number + broker server to your username." Weak, easily pirated
(the internet has their `.ex4` on warez EA sites), which is why the *real* product is the
`.set` files + updates, not the binary.

---

## 5. Features list (marketing copy → what it maps to technically)

| Marketing claim | Technical reality |
|---|---|
| "24/7 Automated Operation" | EA is loaded 24/7; **actually trades ~1 hour/day** |
| "Automated EA used by 26,000+ traders" | not auditable |
| "Easy 5-minute installation" | drag `.ex4` into `MQL4/Experts`, drop on chart, accept, load `.set`. VPS needed to be useful |
| "Optimized SET files" | the whole moat — parameter presets |
| "Low/Medium/High risk strategies" | lot size + SL/TP ratio + Max Orders per preset |
| "Structured risk management" | SL exists but defaults are loose (see §7) |
| "#1 Rated by Benzinga, WikiJob, Forex Robot Nation, SourceForge, BizReport, LearnBonds" | **Forex Robot Nation is the founder's own site**; the rest are affiliate-listicle placements, not independent ratings ⚠️ |
| "Verified third-party tracking (Myfxbook)" | real integration, but *which* accounts are shown is curated; see §6 |
| "Over 90% positive client feedback" | Trustpilot aggregate is **3.8/5 across ~216–220 reviews** as of the reviews page — not 90%+ ⚠️ |

---

## 6. Performance evidence: what's actually public

### Their showcased accounts (from the homepage widget links)
| Label | Myfxbook account | ID |
|---|---|---|
| Forex Fury 7 Years (Withdrawal) — **REAL** | `forexfuryreal/forex-fury-live-gbpusd-low` | 2509034 |
| Fury Member CORE | `r34godzila/fury-live` | 12170101 |
| Fury Member Core | `r34godzila/forex-fury-live` | 12170102 |
| Forex Fury 200% | `forexfuryreal/forex-fury-au` | 11171494 |
| USDCAD 50K | `forexfuryreal/forex-fury-usdcad-50k` | 9421542 |
| EURUSD (NEW) / "Fury 2026" | `forexfuryreal/forex-fury-2026` | 11877427 |
| EU RANGE | `forexfuryreal/forex-fury-eurusd` | 11708187 |
| 500% AGGRESSIVE | `forexfuryreal/forex-fury-26amp39` | 11975493 |

Note the tell: the two "Member CORE" widgets are hosted under a **vendor-affiliated** member
(`r34godzila`), and the flagship labels are marketing names ("200%", "500% AGGRESSIVE") rather
than risk-adjusted metrics. The "7 Years" account exists (good) — that long-lived real GBPUSD-low
record is the strongest thing in the whole pitch.

### Third-party numbers
- ForexStore: gain 154.62%, **monthly 2.46%, drawdown 8.6%, 1662 days live**; scored **3/5**
  on price-vs-quality, **3.5/5** on profitability/drawdown, and **0/5 for backtests** — "no backtests"
  published at all. Ratios described as 0.01 / 0.6:1 / 0.4:1 — i.e. **negative risk:reward**.
  [source](https://forexstore.com/forex-fury)
- Algotradingspace (self-described unaffiliated, paid $459, 216 days, GBPUSD, funded+live $1k account):
  22% total gain, **3.12%/mo**, **max floating DD ~3%**, **PF ~4.0**, **TP 16 pips / SL 16 pips**,
  **no grid, no martingale**, 1 trade/day, window 10:16–11:16 GMT (London open).
  [source](https://algotradingspace.com/forex-fury-review)
- Set-and-forget roundup: **93% claimed win rate, ~91% independently verified**, ~1–2%/mo,
  **"high drawdown relative to returns"**, and one max-DD figure of **~42%**; 5-pip TPs;
  calm window "typically 4–5 PM EST". [source](https://newyorkcityservers.com/blog/best-set-and-forget-eas)
- Trustpilot aggregate **3.8/5 (~216 reviews)**. [source](https://www.trustpilot.com/review/forexfury.com)

### The internal contradiction to learn from
TP/SL geometry is reported as *16/16*, *5/29*, and *5/60* by different sources, and the window as
*London open* vs *4–5pm EST* vs *23:00–23:59 broker time*. Both are consistent with **one binary +
many `.set` files**: aggressive scalping presets (tiny TP, huge/absent SL) vs the newer
balanced presets (equal TP/SL, real stop). The "Fury strategy" isn't one thing — **the preset is
the strategy.** That's the core architectural decision for our build.

### Known criticism (the failure modes we must design against)
- **Negative R:R asymmetry.** A long-running Trustpilot critic: default risk-reward ~29/5, so
  "you have to maintain over 90% win ratio throughout the year to be profitable"; users who
  actually cut at 29–30 pips report blown accounts. [source](https://ie.trustpilot.com/review/forexfury.com?page=9)
- **Track-record curation.** Same reviewer alleges: no real USD account featured, no leverage → no
  margin-call risk, **no stop loss placed and trades run until profitable**, open trades hidden by
  making them private, and the EA stopped during major news — producing a "beautiful 100% win
  graph". Whether or not each allegation is true, **the mechanism is possible on Myfxbook**, so any
  honest version of ours must foreclose it structurally (see §8).
- **Drawdowns that erase months of profit.** QuantVPS: critics cite "significant drawdowns which can
  erase several days' profits"; one user: **29.1% DD against 18% total return**.
  [source](https://www.quantvps.com/blog/top-10-forex-robots)
- **2015 Myfxbook thread:** "TP 5 pips. SL as high as 60 pips. Do the math" + "almost blew their own
  account in 1 week". [source](https://www.myfxbook.com/community/trading-systems/forex-fury-live/978330,1)
- **Live user, May–Jun 2026** (Trustpilot, after they rewrote their review): profitable ~$200, but
  *"deep drawdown… trades opened May 12th still haven't closed, $4–5k in drawdown at times. The TP
  shows 1.46 — the last time GBPUSD was at 1.46 was June 2016."* → **stuck open trade with a far-away
  TP, no protective stop.** This is the canonical way a no-hard-SL scalper dies.
  Vendor reply: "we've released 6 new scalping set files… different risk profile."
- **Backtest-vs-live decay** (general to this whole class): win rate **98% in tester → 88% live**,
  because entries cluster in the **bank-rollover window when spreads widen and slippage spikes**; a
  clean tester scores those as small wins, a live feed turns them into small losses.
  [source](https://www.forexcracked.com/forex-ea/asian-session-scalper-ea-free-download-smart-owl-fx-2026-review/)

---

## 7. What the marketing machine is (for building our own version honestly)

Structural playbook, observed on the page:
- Headline literally a keyword-stuffed title: *"Forex Fury » Top-Rated Forex Robot 2026"*.
- Hero trust stats (26K+ users / 10+ years / 24-7) with no audit trail.
- **"Limited Time Coupon FALL 🍂"** + "Core update available — new scalping set files NOW" = urgency.
- `#` dead links where "verified third-party tracking", "walkthrough videos", and "email us" CTAs
  should go — three of the credibility anchors on the page link to nothing but `#`.
- Ranking logos that open a **lightbox screenshot** ("✕ CLOSE / Ranking Screenshot"), not real citations.
- Testimonials: 6 cards, all "via Trustpilot · Verified", short, vague, uniformly positive, one
  ("Only robot that handled it… trump mania") doing political reassurance. Note the *other* Trustpilot
  reviews for the same product are 1-star "blew my demo account three times over".
- "Internal Rankings" self-scores on the About page (Strategy 90%, Coding 95%, Support 80%…) — a
  clever fake-transparency device: it *admits* weaknesses (Technological Advances 77%) to buy
  credibility for the rest.
- FAQ that quietly walks back the money claim: "There is **no fixed monthly return**" + the
  mandatory "past performance is not indicative of future results".
- Affiliate broker links dressed up as "#1 Choice / #2 Choice / #3 Choice".

**Design consequence for us:** the marketing above is why this product converts, and the
*deceptive parts* are why Trustpilot sits at 3.8 and why EA sellers get lawsuits. We get to keep the
good parts — specificity, live third-party tracking, downloadable configs, honest self-scores,
fast support, on-chart diagnostics — and drop the fake scarcity, the curated-only-winners stat
widgets, the "Top-Rated" self-title, and unqualified "90% positive" claims. See §8.

---

## 8. Spec for our version (derived, not copied)

### Must-have engine modules
1. **Config-first architecture.** One engine, N presets. Preset = symbol, session window, TP/SL,
   filters, sizing mode, risk tier, version + author notes. Ship presets as data (`.set`-compatible
   text or JSON) so updates don't require a new binary.
2. **Session/time filter** — explicit hour slots + day-of-week gates + rollover blackout window,
   all normalized to a **GMT offset setting** (this is the #1 real-world user error: their own
   reviewers say *"make sure to set the GMT correct"*). Auto-detect broker server offset and show it.
3. **Spread & slippage gates** — refuse entry above `MaxSpread` (points), kill-switch on spike
   (`spread > MaxSpread × mult` cancels operations). Show current spread on the chart.
4. **Volatility/range filter** ("Only Range Trading") — e.g. ATR-vs-average and range-width test on
   the recent window, plus ADX ceiling. This filter is the claimed edge; ours must be
   **backtestable in isolation** so we know if it does anything.
5. **Trade-count governor** — 1 trade-set per symbol per day; hard daily loss cap; consecutive-loss
   halt (best practice from the Asian-session literature: stop after ~3 losses / 1.5–2% session loss).
6. **Exits** — fixed TP/SL, trailing (start/step/dist), break-even, and an optional
   time-based close-at-window-end variant (which fixes the "trade stuck open since May 12" failure).
7. **Sizing** — fixed lot | cash-per-trade | %equity. **Never ship martingale/grid on by default.**
   If present at all, gate it behind an explicit acknowledgement and a hard `MaxSteps` +
   basket-stop-loss, and make the *worst case* print in the UI before it can be enabled.
8. **News filter** — their FAQ implies weak/absent news protection; several reviews call it out as a
   gap. High-impact-only suppression is cheap via a calendar feed. This is our easiest real
   differentiator.
9. **Cost realism** — model spread + commission + slippage distribution in the backtest, and test
   the *rollover-minute* behavior separately. This is where 98%→88% win rate goes to die; a
   tester-only backtest is the #1 way EAs lie.
10. **Honest reporting layer** — every equity curve we show must carry: window start/end, real vs
    demo flag, broker + server time, DD method (floating vs balance), max open-trade age, and
    a full trade list export. If we can't publish that, we don't publish the curve.

### Explicit non-goals / ethics rails for our build
- No fabricated testimonials, no paid-review solicitation to bury negatives, no "limited time"
  countdowns, no self-bestowed "#1 Rated" titles, no "top-rated" in the page `<title>`.
- No performance guarantees, no "set and forget", no income promises. Required disclosure language
  on any figure we show, plus the honest expected-value framing (1–3%/mo *at best*, with 10–40% DD
  possible on this strategy family).
- Never advertise a win rate without the R:R and the DD next to it (a 93% win rate on 5/60 TP/SL is
  the single most misleading-but-technically-true statistic in this category).
- If this is used on real money at all: demo → then micro lots, capped risk, and no broker-affiliate
  links hidden inside "recommendations" without disclosure.
- Distribution note: reselling/copying their `.ex4`, `.set` files, images, or copy is infringement —
  and their leaked builds circulate on warez EA sites. We write everything from the *concept*, and the
  concept (time-filtered low-vol range scalping with spread/volatility gates) is not ownable.

### Platform note
Target: MT4/MT5 MQL4/MQL5 EA (for real use) — but this repo is a **dependency-free Node/browser
educational app**, so the natural first deliverable is the same logic implemented as
**plain-JS engine + simulator/backtester + a lesson module**, which is: runnable here today,
testable, and ports to MQL near 1:1 later (all §8 modules map to MQL functions).

---

## 9. Open questions to answer before/while building
1. Data source for the simulator/backtest: free M1/H1 FX feed vs synthetic series vs uploaded CSV?
2. Do we want real MT4/MT5 MQL output eventually, or is a browser simulator + lesson the goal?
3. Risk philosophy: do we ship martingale/grid at all (my recommendation: no, or opt-in + gated)?
4. Who is this for — learners in the Professor Fox app, or a genuinely deployable bot?
5. Preset format: MT4 `.set` text compatibility (nice if a user copies it into MT5 later) vs JSON?

---

## 10. What building the replica proved (added after the engine worked)

One statistic from our own implementation explains the vendor's design better than any review:

> On calibrated synthetic bars, the honest flagship (7p target, bounded 10–12p stop, flat before the
> rollover) closed **92% of its trades because the window ended**, not because price reached a level.
> The 2-hour variant on the London open — a breakout, not a fade — was forced on only 23% of trades.

Consequence: inside a deliberately compressed hour on a deliberately quiet pair, a 5–9 pip target
mostly does not arrive. So the only way to sell "93% win rate, TP reached" on this geometry is to remove
the constraints that make the number mean anything:

- no stop loss (or one far enough away to be unreachable),
- no clock, so a loser can be held for weeks until mean reversion rescues it — the documented Trustpilot
  complaint (open since May 12, targeting 1.46, GBPUSD last at 1.46 in June 2016) is exactly this
  mechanism working as designed, then meeting a regime that never returns,
- a "one trade per day" claim that quietly becomes "one trade per day *until one is losing*".

Both halves of that story are consistent with the marketing: TP-based success rates, curated Myfxbook
widgets where drawdown is capped by the demo account's leverage rather than by the EA, and set files
whose martingale/retrace inputs the vendor says he does not use on his own accounts.

The rail this repo added because of it: the break-even check prices the **widened** stop (`slMaxPips`),
not the advertised one, and refuses an uncapped widening outright — otherwise a preset can advertise
SL 9 and risk 45, which is the legacy shape wearing a new number.
