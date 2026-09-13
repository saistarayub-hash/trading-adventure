'use strict';
/* curriculum.js — the built-in trading curriculum and adaptive study plan.
 *
 * This is what makes the companion a *teacher* rather than a chat box: a
 * structured library of universal strategies (they apply to crypto, stocks and
 * forex alike), a skill profile that tracks what the trader has actually been
 * exposed to and where they keep failing, and a planner that picks the next
 * most valuable thing to teach — biased toward gaps in their own fed library.
 */

/* Level 1 = foundation · 2 = reading charts · 3 = playbooks · 4 = execution & mind */

const LIBRARY = [
  {
    id: 'what-moves-price', level: 1, emoji: '🌊', name: 'What actually moves price',
    tags: ['price action', 'psychology'], minutes: 4,
    summary: 'Price only moves when someone is willing to cross the spread. Everything else — news, indicators, feelings — is just a reason people decide to do that.',
    rules: [
      'Every tick is an agreement between one buyer and one seller. Price moves toward the side that is more urgent.',
      'Urgency beats size: a small market order that must fill now moves price more than a huge limit order that waits.',
      'News does not move markets — the difference between what was expected and what happened does.',
      'If price is not moving, nobody is urgent. That is information too (it means low participation).'
    ],
    entry: 'n/a — this is a concept, not a setup.',
    invalidation: 'n/a',
    target: 'n/a',
    risk: 'The biggest beginner loss is assuming price "should" go somewhere because it is cheap, expensive, or fair.',
    drill: 'Open any chart on the 1-minute timeframe for 5 minutes and just watch. Every time price jumps, ask: "who was in a hurry?" Do not trade.',
    screenHooks: ['A sudden single-candle expansion', 'Price sitting perfectly still for many candles', 'A news headline and the reaction to it'],
    mistakes: ['Thinking price moves because of an indicator', 'Assuming a big move must continue because it was big'],
    quiz: [
      { q: 'Price moves toward a level mainly because…', options: ['One side is more urgent to fill', 'An indicator crossed', 'The candle was green', 'Volume was low'], answer: 0, why: 'Urgency (marketable orders) is what consumes the other side and pushes price.' },
      { q: 'A news number comes out exactly as forecast. Price usually…', options: ['Barely moves', 'Crashes', 'Doubles', 'Always reverses'], answer: 0, why: 'Markets price in expectations. No surprise = no urgency = little movement.' }
    ]
  },
  {
    id: 'market-structure', level: 1, emoji: '🪜', name: 'Market structure: the only map you need',
    tags: ['trend trading', 'price action', 'support & resistance'], minutes: 6,
    summary: 'An uptrend is higher highs AND higher lows. A downtrend is lower highs AND lower lows. Everything else is a range. That single sentence filters most bad trades.',
    rules: [
      'Label the last two swing highs and two swing lows before you form any opinion.',
      'HH + HL = uptrend: only look for longs, ideally at the higher low.',
      'LH + LL = downtrend: only look for shorts, ideally at the lower high.',
      'No clear sequence = range: trade the edges or stand aside. Ranges are where trend traders bleed.',
      'Structure breaks when the most recent HL (in an uptrend) or LH (in a downtrend) is taken out on a closing basis.',
      'A wick that pokes through is not a break. Wait for a body to close beyond it.'
    ],
    entry: 'With the trend, at the pullback that forms the next higher low (uptrend) or lower high (downtrend).',
    invalidation: 'The swing point you are trading from gets closed through.',
    target: 'The prior swing high/low first; extend only if structure keeps printing.',
    risk: 'Never trade against a structure you have not labelled. If you cannot name the last HL, you have no stop location.',
    drill: 'On a daily chart, mark the last 6 swing points with horizontal lines and label HH/HL/LH/LL out loud. Do this for 10 different instruments. 15 minutes a day for a week changes how you see charts.',
    screenHooks: ['The last two swing highs and lows', 'A close beyond a swing point', 'A wick that pokes through but does not hold'],
    mistakes: ['Calling a reversal because one candle went the other way', 'Trading a pullback in a range as if it were a trend', 'Using intraday wicks instead of closes to judge breaks'],
    quiz: [
      { q: 'In an uptrend, which event actually breaks the trend?', options: ['A close below the most recent higher low', 'A single red candle', 'A long lower wick', 'RSI going below 70'], answer: 0, why: 'Structure is defined by swing points on a closing basis, not by single candles or wicks.' },
      { q: 'Price makes a new high but the previous low was higher than the one before it. That is…', options: ['Still an uptrend (HH + HL)', 'A downtrend', 'A reversal', 'Impossible'], answer: 0, why: 'Higher high plus higher low is the definition of an uptrend, regardless of colour.' }
    ]
  },
  {
    id: 'candle-anatomy', level: 1, emoji: '🕯️', name: 'Reading one candle properly',
    tags: ['price action'], minutes: 4,
    summary: 'A candle is a story of a fight: open, high, low, close. Where the close sits inside the range matters far more than the colour.',
    rules: [
      'Body = who won the period. Long body = conviction; tiny body = indecision.',
      'Wicks = where price was rejected. A long lower wick means sellers pushed down and lost.',
      'Close in the top third of the range = buyers in control at the end, even if the candle is red.',
      'A candle is only meaningful in context: the same doji at a range low vs mid-range means different things.',
      'One candle is a hint, two is a signal, three is a pattern. Never act on one alone.',
      'Higher timeframes outweigh lower ones. A 4H close beats twenty 1m candles.'
    ],
    entry: 'Only at a level you already marked, and only with a rejection candle that closes back in your favour.',
    invalidation: 'Beyond the wick of the rejection candle (that is where the rejection failed).',
    target: 'The next level of interest, not a fixed percentage.',
    risk: 'Candle patterns in the middle of nowhere have close to random odds. Location is the edge; the candle is the trigger.',
    drill: 'Find 5 long-wick candles on a chart. For each, write one line: where it happened, which side lost, and what price did next. No trading.',
    screenHooks: ['A long wick at a marked level', 'A tiny body after a big run', 'A candle that closes back inside the previous range'],
    mistakes: ['Memorising pattern names without location', 'Acting on a candle before it closes', 'Ignoring which timeframe the candle is on'],
    quiz: [
      { q: 'A candle has a small red body and a very long lower wick at support. What does it say?', options: ['Sellers pushed down and were rejected', 'Sellers won the period', 'Nothing, it is red', 'Volatility is low'], answer: 0, why: 'The wick shows where price was rejected; the small body shows neither side closed far from the open.' },
      { q: 'What makes a candle pattern worth acting on?', options: ['Its location at a level', 'Its name', 'Its colour', 'Its size'], answer: 0, why: 'Context (location) is the edge. The same pattern mid-range is close to noise.' }
    ]
  },
  {
    id: 'support-resistance', level: 1, emoji: '🧱', name: 'Support, resistance and zones',
    tags: ['support & resistance', 'price action'], minutes: 5,
    summary: 'Levels are not lines, they are zones where orders clustered before. Price remembers them because the people who missed the move are still waiting there.',
    rules: [
      'Draw zones from at least 2-3 touches, not from one dramatic spike.',
      'Wicks define the zone edges; bodies define its heart.',
      'The more times a level is tested, the weaker it gets (orders get consumed). Fresh levels are stronger.',
      'A broken resistance becomes support (and vice versa) — the "retest" is the highest-quality entry.',
      'Round numbers, previous day high/low, and prior week levels attract orders.',
      'If price approaches a level slowly with small candles, it often breaks. If it arrives fast and wicks, it often rejects.'
    ],
    entry: 'A rejection at a fresh zone, or a retest of a level that just flipped.',
    invalidation: 'A close beyond the far edge of the zone (not a wick).',
    target: 'The next zone on the map. If there is no next zone, the trade has no target and no reason to exist.',
    risk: 'Trading inside a zone (mid-range) is the single most common beginner loss. Either trade the edge or do not trade.',
    drill: 'Mark only 3 zones on a daily chart — the ones with the most touches. Then drop to the 1H and watch how price behaves in each. Do not add more zones; fewer is better.',
    screenHooks: ['Price sitting exactly at a marked zone', 'A level touched 3+ times', 'A retest of a level that just broke'],
    mistakes: ['Chart spam — 20 lines makes zero of them meaningful', 'Using exact prices instead of zones', 'Assuming a level holds because it held before'],
    quiz: [
      { q: 'Resistance breaks and price comes back down to it. That level is now…', options: ['Potential support (a retest)', 'Still resistance', 'Meaningless', 'A short signal'], answer: 0, why: 'Role flip: old resistance becomes support, and the retest is the classic entry.' },
      { q: 'A level has been tested 5 times in two days. It is probably…', options: ['Getting weaker', 'Getting stronger', 'Unchanged', 'Only valid on the daily chart'], answer: 0, why: 'Each test consumes resting orders. Frequently hit levels tend to break.' }
    ]
  },
  {
    id: 'risk-1-percent', level: 1, emoji: '🛡️', name: 'The 1% rule and position sizing',
    tags: ['risk management'], minutes: 7,
    summary: 'You decide your loss BEFORE you enter. Position size is the output of that decision, not a feeling.',
    rules: [
      'Risk per trade = 0.5% to 1% of account equity. At 1%, you can be wrong 10 times in a row and still have ~90% of your capital.',
      'Position size = (account × risk%) ÷ (entry − stop distance). The stop distance decides the size, never the reverse.',
      'No stop = no trade. "Mental stops" are hopes.',
      'Risk:reward below 1:1.5 needs a win rate above 40% just to break even. Know both numbers.',
      'Expectancy = (win% × average win) − (loss% × average loss). Positive expectancy is the only real edge.',
      'Cut size in half after 2 losses in a day. Cut to zero after 3. This is a rule, not a suggestion.',
      'Leverage does not change risk — position size and stop distance do.'
    ],
    entry: 'Only where the stop has a logical place (beyond the level or the rejection wick).',
    invalidation: 'The logical stop level. If that level is too far for 1% risk, the answer is smaller size or no trade.',
    target: 'Defined by the next level, then checked against at least 1.5R.',
    risk: 'This module IS the risk module. Everything else is optional; this is not.',
    drill: 'Take your account size (or a paper number). Calculate the position size for 3 different stop distances at 1% risk. Write them down. Do this until it takes you 20 seconds.',
    screenHooks: ['The order ticket with a size but no stop', 'A stop placed at a round number instead of beyond structure', 'Position size that makes the P&L swing wildly'],
    mistakes: ['Sizing first, stop second', 'Widening a stop because "it will come back"', 'Revenge-sizing after a loss', 'Confusing leverage with risk'],
    quiz: [
      { q: 'Account $2,000, risking 1%, stop is $4 away from entry. Position size?', options: ['5 units', '50 units', '500 units', '20 units'], answer: 0, why: '$20 risk ÷ $4 stop distance = 5 units. The stop sets the size.' },
      { q: 'You lose 3 trades in a row at 1% risk each. Your account is down about…', options: ['3%', '30%', '10%', '1%'], answer: 0, why: 'Roughly 3% (slightly less with compounding). That is survivable — which is the point.' },
      { q: 'Which decides your risk on a trade?', options: ['Position size × stop distance', 'Leverage', 'The exchange', 'Your confidence'], answer: 0, why: 'Leverage only affects margin. Risk is size times the distance to your stop.' }
    ]
  },
  {
    id: 'trend-pullback', level: 2, emoji: '📈', name: 'Trend + pullback (the bread and butter)',
    tags: ['trend trading', 'price action'], minutes: 6,
    summary: 'Wait for a trend, wait for it to breathe, then join it at a discount with a stop behind the structure.',
    rules: [
      'Confirm the trend on a higher timeframe than the one you enter on (e.g. 4H trend, 15m entry).',
      'A pullback should retrace roughly 38-62% of the last impulse, or reach the prior breakout point / a moving average / a level.',
      'The pullback must show slowing momentum: smaller candles, lower volume, overlapping bars.',
      'Enter on the first sign of the trend resuming (a close back in the trend direction, a higher low forming).',
      'Stop goes beyond the pullback extreme, not beyond your feelings.',
      'Skip it if the pullback is a single huge counter-trend candle — that is a reversal attempt, not a pullback.'
    ],
    entry: 'First candle closing back in the trend direction after a shallow, slow pullback into a level.',
    invalidation: 'A close beyond the pullback extreme.',
    target: 'Prior swing extreme first (usually 1.5-2.5R); trail behind new swing points after that.',
    risk: '1% max. If the stop is wide, reduce size rather than skipping the stop.',
    drill: 'Find 10 completed pullbacks on a historical chart. Mark entry, stop, target. Count how many reached 1.5R before hitting the stop. That is your own backtest — do it before risking anything.',
    screenHooks: ['A series of HH/HL with a small counter-move', 'Shrinking candles against the trend', 'Price touching a moving average or prior breakout level'],
    mistakes: ['Buying the top of the impulse because "the trend is strong"', 'Entering mid-pullback before it slows', 'Placing the stop inside the pullback where noise will find it'],
    quiz: [
      { q: 'Best place to stop out on a long pullback entry?', options: ['Below the pullback low', 'A random 1% away', 'Above the entry', 'At the nearest round number'], answer: 0, why: 'Beyond the structure that made the trade valid. If that low goes, the idea is wrong.' },
      { q: 'Which pullback is highest quality?', options: ['Slow, small candles into a level', 'One huge red candle', 'A vertical drop', 'A gap down'], answer: 0, why: 'Slowing momentum on the counter-move means it is profit-taking, not a reversal.' }
    ]
  },
  {
    id: 'breakouts-fakeouts', level: 2, emoji: '🚪', name: 'Breakouts and the fakeout tax',
    tags: ['breakouts', 'support & resistance', 'volume'], minutes: 6,
    summary: 'Most breakouts fail. Pros trade them anyway — with confirmation, or they trade the failure instead.',
    rules: [
      'A breakout needs: a real level, a close beyond it, and preferably expansion (bigger candle, more volume).',
      'The safer entry is the retest, not the break. You miss some moves; you skip most traps.',
      'Breakouts from long, tight consolidation are more reliable than breakouts from an already-extended move.',
      'If price breaks a level and immediately snaps back inside, that is a failed breakout — often a strong signal in the opposite direction.',
      'Never enter a breakout because you are bored of waiting. Boredom is the most expensive emotion in trading.',
      'News-driven breaks often retrace fully. Wait for the second attempt.'
    ],
    entry: 'Either a close beyond the level with expansion, or the retest of the level from the new side.',
    invalidation: 'A close back inside the old range (that IS the fakeout signal).',
    target: 'Measured move: the height of the range projected from the breakout point — as a guideline, not a promise.',
    risk: 'Fakeout entries get stopped at breakeven often. Accept that; the winners pay for it. 1% risk, and half size on the aggressive break entry.',
    drill: 'Log the next 10 breakouts you see (no money). Mark: break, retest, and whether the retest held. Your own hit-rate data beats any guru.',
    screenHooks: ['A candle closing outside a long range', 'An immediate snap back inside', 'A retest with shrinking volume'],
    mistakes: ['Chasing the first candle out of a range', 'Ignoring the snap-back (which is itself a signal)', 'Assuming bigger breakout = bigger move'],
    quiz: [
      { q: 'Price breaks above resistance, then closes back inside the range on the next candle. That is…', options: ['A failed breakout — often bearish', 'A confirmed breakout', 'Nothing', 'A reason to buy more'], answer: 0, why: 'Trapped breakout buyers have to exit, which fuels the move the other way.' },
      { q: 'Lower-risk breakout entry?', options: ['The retest of the broken level', 'The first green candle', 'Market order at the break', 'Before the break'], answer: 0, why: 'Waiting for the retest gives you confirmation and a tighter, more logical stop.' }
    ]
  },
  {
    id: 'chart-patterns', level: 2, emoji: '🔺', name: 'Chart patterns that are worth knowing',
    tags: ['chart patterns', 'breakouts'], minutes: 6,
    summary: 'Patterns are just structure + psychology with a name. Learn what each one is telling you about trapped traders.',
    rules: [
      'Continuation patterns (flags, pennants, triangles in a trend) resume the prior move most of the time.',
      'Reversal patterns (double top/bottom, head & shoulders) only count at the END of a real trend.',
      'A pattern needs a clear neckline/trigger line. No line, no pattern.',
      'The more symmetrical and clean, the more people see it — and the more likely it gets traded (or hunted).',
      'Patterns on higher timeframes matter more. A 5-minute head and shoulders is mostly noise.',
      'Measure the target from the pattern height, but take partials at the first logical level.'
    ],
    entry: 'On the break of the trigger line, or the retest of it.',
    invalidation: 'Back inside the pattern beyond the midpoint.',
    target: 'Pattern height projected from the break.',
    risk: 'Patterns fail constantly. Size them like any other trade: 1%, stop beyond the pattern.',
    drill: 'Pick ONE pattern (a flag is a good start). Find 15 historical examples. Mark the break and measure whether the projection was hit. Ignore every other pattern this week.',
    screenHooks: ['A tight triangle after a strong impulse', 'Two peaks at almost the same level', 'A neckline being tested a third time'],
    mistakes: ['Seeing patterns in random noise', 'Trading a reversal pattern with no prior trend to reverse', 'Ignoring the volume story behind the shape'],
    quiz: [
      { q: 'A flag pattern forms after a strong rally. It is usually…', options: ['Continuation — expecting the rally to resume', 'A reversal', 'A range trade', 'Meaningless'], answer: 0, why: 'Flags are pauses (profit-taking) inside a trend, not reversals.' },
      { q: 'A double top only counts as a reversal when…', options: ['It appears after a real uptrend and breaks the neckline', 'It looks symmetrical', 'Volume is high', 'RSI is overbought'], answer: 0, why: 'Without a prior trend there is nothing to reverse, and without the neckline break it has not failed yet.' }
    ]
  },
  {
    id: 'volume', level: 2, emoji: '📊', name: 'Volume: the lie detector',
    tags: ['volume', 'breakouts', 'trend trading'], minutes: 5,
    summary: 'Volume tells you how many people agreed with a move. Price says what happened; volume says how much conviction was behind it.',
    rules: [
      'A breakout on low volume is suspect. Expansion moves should come with expansion participation.',
      'Rising price + rising volume = healthy trend. Rising price + falling volume = running out of fuel.',
      'A huge volume spike at the end of a long move is often exhaustion (climax), not continuation.',
      'In a pullback you want to see volume DRY UP — that means sellers are not serious.',
      'Volume at a level tells you whether it will hold: heavy volume rejection = real interest.',
      'Forex has no centralised volume; use tick volume or the currency futures equivalent, and treat it as approximate.'
    ],
    entry: 'A break with a clear volume expansion, or a pullback with visible volume contraction.',
    invalidation: 'Structure — volume confirms, it does not replace your stop.',
    target: 'Unchanged by volume; volume only affects your confidence in getting there.',
    risk: 'Never add to a position because volume is high. High volume at the wrong place is a climax, and climaxes reverse.',
    drill: 'Turn on volume and watch 3 breakouts live without trading. Say out loud whether volume confirmed. Check what happened next.',
    screenHooks: ['A break with a tiny volume bar', 'A volume spike twice the recent average', 'A pullback on shrinking volume'],
    mistakes: ['Reading volume as "more volume = more direction"', 'Ignoring volume divergence at the end of trends', 'Using volume on instruments where it is not meaningful'],
    quiz: [
      { q: 'Price breaks resistance but volume is below average. This suggests…', options: ['Weak conviction — higher fakeout risk', 'A strong breakout', 'Nothing', 'You should buy immediately'], answer: 0, why: 'Breaks need participation. Low volume means few traders committed.' },
      { q: 'In a healthy pullback inside an uptrend you want volume to…', options: ['Decrease', 'Double', 'Stay at climax levels', 'Not matter'], answer: 0, why: 'Drying volume on the counter-move means profit-taking, not real selling pressure.' }
    ]
  },
  {
    id: 'multi-timeframe', level: 2, emoji: '🔭', name: 'Multi-timeframe: zoom out first',
    tags: ['trend trading', 'trading plan'], minutes: 5,
    summary: 'The higher timeframe decides direction; the lower timeframe decides timing. Reverse that and you will fight the tide all day.',
    rules: [
      'Pick exactly 3 timeframes: one for context (e.g. daily), one for setup (4H/1H), one for entry (15m/5m).',
      'Never take an entry-timeframe signal that contradicts the context timeframe — unless you are deliberately trading a reversal, which beginners should not.',
      'A "clear" 5m trend can be a single candle on the 4H. Know which one you are in.',
      'Your stop belongs to the timeframe you entered on. Your target belongs to the higher one.',
      'If the higher timeframe is mid-range, the best trade is often no trade.',
      'Reduce timeframe count as a beginner. Three is plenty; six is confusion.'
    ],
    entry: 'Entry-timeframe trigger, in the direction of the context timeframe, at a setup-timeframe level.',
    invalidation: 'Entry-timeframe structure.',
    target: 'Setup-timeframe or context-timeframe level.',
    risk: 'The classic over-leveraged mistake is entering on the 1m with a stop that only makes sense on the 1m, in a market whose real direction is on the 4H.',
    drill: 'For one week, write the higher-timeframe bias in one word (up/down/range) BEFORE opening the lower timeframe. Compare your trades against that word.',
    screenHooks: ['A chart opened on 1m/5m during a fast session', 'Two charts of the same instrument side by side'],
    mistakes: ['Analysing the 5m first and looking for confirmation bias', 'Using too many timeframes', 'Putting a 5m stop on a 4H idea'],
    quiz: [
      { q: 'Daily trend is up, 15m shows a strong move down. A beginner should mostly…', options: ['Wait for the 15m to turn back up', 'Short immediately', 'Ignore the daily', 'Double the position'], answer: 0, why: 'The higher timeframe sets direction; the lower one sets timing. Counter-trend scalps are advanced.' },
      { q: 'Where should your target come from?', options: ['The higher timeframe', 'The entry timeframe', 'A fixed percentage', 'Your feelings'], answer: 0, why: 'You enter on the small timeframe but the move you want plays out on the bigger one.' }
    ]
  },
  {
    id: 'supply-demand', level: 3, emoji: '🏦', name: 'Supply, demand and order blocks',
    tags: ['smart money / ICT', 'support & resistance'], minutes: 7,
    summary: 'Institutions cannot fill big orders at one price. They leave footprints — zones where price moved away so fast that orders were left unfilled. Price often returns there.',
    rules: [
      'A demand zone: the last down-close (or tight consolidation) before a strong move UP that broke structure.',
      'A supply zone: the last up-close before a strong move DOWN that broke structure.',
      'The best zones: fresh (never retested), caused a clear structure break, and left quickly (imbalance).',
      'An imbalance / fair value gap is a 3-candle pattern where candle 1\'s wick and candle 3\'s wick do not overlap — price often fills it.',
      'Zones degrade with each touch, like any level. First touch is the trade.',
      'A liquidity sweep (a wick that takes out an obvious high/low then reverses) is often the real entry signal.'
    ],
    entry: 'First return into a fresh zone, ideally after a sweep and a lower-timeframe structure shift.',
    invalidation: 'A close through the far side of the zone.',
    target: 'The opposing zone, or the liquidity pool above the last high / below the last low.',
    risk: 'This vocabulary is heavily marketed. It is useful, not magic. Trade it exactly like any level-based setup with 1% risk.',
    drill: 'Mark only 2 zones on a 4H chart: the origin of the last strong impulse up and down. Watch what happens when price returns. Repeat on 5 charts.',
    screenHooks: ['A gap between candle wicks (imbalance)', 'A sharp move away from a tight base', 'A wick that sweeps an obvious high then closes back down'],
    mistakes: ['Marking every candle as an order block', 'Ignoring that the zone has already been touched twice', 'Treating the concept as certainty instead of probability'],
    quiz: [
      { q: 'A demand zone is best described as…', options: ['The origin of a strong move up that broke structure', 'Any green candle', 'The lowest price today', 'A moving average'], answer: 0, why: 'It is where buying was aggressive enough to leave unfilled interest behind.' },
      { q: 'What happens to a zone after several touches?', options: ['It weakens as resting orders get filled', 'It strengthens', 'Nothing changes', 'It becomes a trendline'], answer: 0, why: 'Each touch consumes the orders that created the reaction.' }
    ]
  },
  {
    id: 'moving-average-system', level: 3, emoji: '〰️', name: 'A simple moving-average trend system',
    tags: ['indicators', 'trend trading'], minutes: 6,
    summary: 'One complete, mechanical system you can actually backtest: trend filter + pullback trigger + fixed risk. Not the "best" system — a real one.',
    rules: [
      'Trend filter: price above the 50 EMA and the 50 above the 200 = look for longs only. Below = shorts only.',
      'Setup: wait for a pullback that touches or comes within ~0.3×ATR of the 20 EMA.',
      'Trigger: first candle closing back in the trend direction after that touch.',
      'Stop: 1.5×ATR below the trigger candle low (longs).',
      'Target: 2R fixed, or trail behind the 20 EMA and exit on a close below it.',
      'Filter: skip if the EMAs are flat and tangled — that is a range and the system has no edge there.',
      'Backtest 100 occurrences before you trade it. Write down the win rate and average R.'
    ],
    entry: 'Trigger candle close, in the direction of the EMA stack.',
    invalidation: '1.5×ATR beyond the trigger extreme.',
    target: '2R, then trail.',
    risk: 'Fixed 1% per trade. The system will have losing streaks of 5-8 trades; that is normal, not broken.',
    drill: 'Take 3 months of a chart you like. Apply the rules mechanically with no discretion. Log every signal and the R result. Compare your expectation with the data.',
    screenHooks: ['Two EMAs on a chart', 'Price pulling back into an EMA', 'Flat, tangled moving averages (stand aside)'],
    mistakes: ['Changing parameters after each loss', 'Trading it in a range', 'Skipping the backtest because it is boring'],
    quiz: [
      { q: 'In this system, when do you take a long?', options: ['Price above 50>200 EMA, pullback to the 20, first close back up', 'Whenever RSI is below 30', 'Every green candle', 'When price is below the 200 EMA'], answer: 0, why: 'Trend filter + pullback location + trigger. All three, in that order.' },
      { q: 'The EMAs are flat and weaving through price. You should…', options: ['Stand aside — it is a range', 'Trade bigger', 'Switch to longs only', 'Ignore it'], answer: 0, why: 'Trend systems lose money in ranges. Recognising "no edge here" is the edge.' }
    ]
  },
  {
    id: 'rsi-divergence', level: 3, emoji: '📉', name: 'RSI, divergence and what overbought really means',
    tags: ['indicators', 'price action'], minutes: 5,
    summary: 'RSI measures the speed of recent gains vs losses. In a strong trend it stays "overbought" for ages — divergence is the useful part, not the level.',
    rules: [
      'Overbought (>70) in an uptrend usually means strong, not "sell". Fading it is a classic beginner blow-up.',
      'Regular bearish divergence: price makes a higher high, RSI makes a lower high → momentum fading (a warning, not a trigger).',
      'Regular bullish divergence: price makes a lower low, RSI makes a higher low → selling pressure fading.',
      'Divergence must occur at a level to matter. Divergence mid-range is noise.',
      'Hidden divergence (price higher low, RSI lower low) is a trend-continuation signal and is more reliable than regular divergence.',
      'Use RSI as a filter for your setup, never as the setup.'
    ],
    entry: 'Divergence at a marked level + a structure trigger (rejection candle or lower-timeframe shift).',
    invalidation: 'Beyond the divergence extreme.',
    target: 'The nearest opposing level or the range midpoint.',
    risk: 'Divergence can persist for many candles. Do not anticipate — wait for the trigger, and use 1%.',
    drill: 'Find 5 divergences. Mark which were at a level and which were mid-range. Note the difference in what happened next.',
    screenHooks: ['RSI above 70 during a strong trend', 'Price making a new high while RSI does not', 'RSI crossing back under 70 after divergence'],
    mistakes: ['Shorting a strong uptrend because RSI says 78', 'Ignoring that divergence needs location', 'Using 3 oscillators that all say the same thing (that is one opinion, not three)'],
    quiz: [
      { q: 'RSI is 78 in a strong uptrend. This means…', options: ['Strong momentum — not automatically a sell', 'Sell immediately', 'The trend is over', 'A reversal is confirmed'], answer: 0, why: 'In trends RSI can stay overbought for a long time. Fading it is how beginners get run over.' },
      { q: 'Price prints a higher high, RSI prints a lower high, at resistance. That is…', options: ['Regular bearish divergence — a warning at a level', 'Bullish continuation', 'Meaningless', 'A buy signal'], answer: 0, why: 'Momentum is fading right where sellers may be waiting. Still needs a trigger.' }
    ]
  },
  {
    id: 'range-trading', level: 3, emoji: '📦', name: 'Trading ranges (where markets spend most of the time)',
    tags: ['support & resistance', 'price action'], minutes: 5,
    summary: 'Markets range roughly 70% of the time. Having one plan for ranges stops you from donating money while waiting for a trend.',
    rules: [
      'Confirm the range: at least two touches of the high and two of the low with no closes outside.',
      'Buy the bottom third, sell the top third, never the middle. The middle is where the odds are 50/50 minus costs.',
      'Take profit BEFORE the opposite edge — the last bit is where range traders get stopped.',
      'A range that has been going for a long time will eventually break. Reduce size as the range ages.',
      'Volume typically falls in the middle of a range and rises near the edges.',
      'If price closes outside the range, the range plan is dead. Do not "give it one more candle".'
    ],
    entry: 'Rejection candle at the range edge, back toward the middle.',
    invalidation: 'A close beyond the edge.',
    target: 'Range midpoint or 80% of the way to the other edge.',
    risk: 'Range trades have tight stops and frequent small wins — which makes over-leveraging very tempting. Keep it at 1%.',
    drill: 'Find a clear range. Mark edges and midpoint. Log what price did at each touch for 10 touches. Note how often it reached the midpoint.',
    screenHooks: ['Two parallel horizontal levels with multiple touches', 'Price sitting exactly in the middle of a range', 'A close outside a long range'],
    mistakes: ['Trading the middle of the range', 'Holding a range trade through a breakout', 'Assuming every range is a "coiling spring" about to explode'],
    quiz: [
      { q: 'Best place to enter a range trade?', options: ['The top or bottom third', 'The middle', 'Anywhere', 'On the breakout'], answer: 0, why: 'Only the edges give you a tight stop and a real target. The middle is a coin flip.' },
      { q: 'A candle closes outside your range while you are in a range trade. You…', options: ['Exit — the plan is invalid', 'Hold and hope', 'Add to the position', 'Widen your stop'], answer: 0, why: 'The edge you were trading no longer exists. Wishing is not a strategy.' }
    ]
  },
  {
    id: 'liquidity-sweeps', level: 3, emoji: '🎣', name: 'Liquidity sweeps and stop hunts',
    tags: ['smart money / ICT', 'price action', 'psychology'], minutes: 6,
    summary: 'Obvious highs and lows are where everyone puts their stops. Big players need those stops to fill large orders. The wick through the level is often the real move.',
    rules: [
      'Identify where retail stops obviously sit: just above equal highs, just below equal lows, beyond round numbers.',
      'A sweep = a fast wick through that level followed by a close back on the original side.',
      'After a successful sweep, the reversal often targets the liquidity on the opposite side of the range.',
      'Equal highs/lows ("clean" levels) are magnets, not safety.',
      'The safest place for your stop is not where everyone else put theirs — give it room beyond the obvious level.',
      'Sweeps are most meaningful at higher-timeframe levels and during session opens (London/NY).'
    ],
    entry: 'Close back inside the range after a sweep, ideally with a lower-timeframe structure shift.',
    invalidation: 'Beyond the sweep wick extreme.',
    target: 'The opposite side of the range / next liquidity pool.',
    risk: 'Sweep trades fail often and fast. Tight invalidation, 1% risk, no averaging down.',
    drill: 'Mark yesterday\'s high and low. Watch today\'s session and note whether either got wicked through and rejected. Do this for 10 sessions.',
    screenHooks: ['Equal highs or equal lows', 'A long wick through an obvious level with a close back inside', 'A fast spike at a session open'],
    mistakes: ['Putting stops exactly where everyone else does', 'Treating every wick as a sweep', 'Trading sweeps with no higher-timeframe context'],
    quiz: [
      { q: 'Price wicks above equal highs then closes back below them. That is…', options: ['A liquidity sweep — often bearish', 'A breakout', 'A buy signal', 'Random noise'], answer: 0, why: 'Stops above the highs were taken, providing liquidity for larger sell orders.' },
      { q: 'Where should your stop go?', options: ['Beyond the obvious level, with room', 'Exactly at the round number', 'As tight as possible', 'Nowhere, use a mental stop'], answer: 0, why: 'If your stop is where everyone else\'s is, you are the liquidity.' }
    ]
  },
  {
    id: 'trading-plan', level: 4, emoji: '📝', name: 'Writing a trading plan that survives contact with the market',
    tags: ['trading plan', 'risk management'], minutes: 7,
    summary: 'A plan is a short document that makes your decisions before the market tries to make them for you.',
    rules: [
      'One page. Sections: markets, timeframes, setups (max 2), risk rules, no-trade conditions, daily routine, review cadence.',
      'Define your no-trade conditions explicitly: news within 15 min, outside your session, after 2 losses, when you are tired or emotional.',
      'Write your setups as IF-THEN: "IF the 4H is trending up AND price pulls back to the 20 EMA AND a bullish close prints, THEN buy with a stop below the low, risking 1%, targeting 2R."',
      'Include a pre-trade checklist of 5 items or fewer. If any fails, no trade.',
      'The plan changes monthly, based on journal data — never mid-session.',
      'If you cannot write your edge in two sentences, you do not have one yet. That is fine — paper trade and find out.'
    ],
    entry: 'Only setups that appear in your written plan.',
    invalidation: 'As pre-defined per setup.',
    target: 'As pre-defined per setup.',
    risk: 'The plan IS the risk control. Discretion in the moment is what blows accounts.',
    drill: 'Write your one-page plan today. Then for the next 20 trades, tick the checklist before every entry and note how many you skipped.',
    screenHooks: ['An order ticket open with no checklist visible', 'Multiple instruments and timeframes open at once (loss of focus)'],
    mistakes: ['A 10-page plan nobody follows', 'Rewriting the plan after a loss', 'Having no no-trade conditions'],
    quiz: [
      { q: 'What belongs in a beginner\'s trading plan?', options: ['Max 2 setups, risk rules, and no-trade conditions', 'Every pattern ever invented', 'A profit target per day', 'News predictions'], answer: 0, why: 'Fewer setups executed consistently beat a catalogue of ideas executed randomly. Daily profit targets create pressure to force trades.' },
      { q: 'When is it OK to change your plan?', options: ['In a scheduled review, using journal data', 'Immediately after a loss', 'During a live trade', 'Never'], answer: 0, why: 'Emotional edits destroy the plan\'s purpose. Review on a schedule, with data.' }
    ]
  },
  {
    id: 'journaling', level: 4, emoji: '📓', name: 'Journaling: the only feedback loop that works',
    tags: ['trading plan', 'psychology'], minutes: 5,
    summary: 'You cannot improve what you do not measure. A journal turns random losses into a dataset about yourself.',
    rules: [
      'Log every trade: setup name, timeframe, entry, stop, target, size, R result, and ONE emotion word.',
      'Screenshot the chart at entry and at exit. Memory lies; screenshots do not.',
      'Review weekly: which setup made money, which lost, what time of day, how you felt.',
      'Track "rule-breaks" as their own category. Most accounts are killed by 3 repeated mistakes, not by bad strategy.',
      'Also log trades you did NOT take and why — skipped good setups are a real cost.',
      'After 30 trades you have a real sample. Before that, you have impressions.'
    ],
    entry: 'n/a', invalidation: 'n/a', target: 'n/a',
    risk: 'Without a journal you will repeat the same mistake for years and call it bad luck.',
    drill: 'Log your last 5 trades (or 5 paper trades) right now with an emotion word each. Then find the pattern in the emotions.',
    screenHooks: ['A trade just closed — capture it', 'Repeated small losses at the same time of day'],
    mistakes: ['Logging only the wins', 'No emotion field (the data you need most)', 'Reviewing once a year'],
    quiz: [
      { q: 'Which journal field reveals the most about a beginner\'s losses?', options: ['Rule-breaks and the emotion word', 'The exact entry price', 'The broker name', 'The colour of the candle'], answer: 0, why: 'Most early losses are execution errors, not analysis errors. Those fields expose them.' },
      { q: 'How many trades before your stats mean something?', options: ['About 30+', '3', '1', '1000'], answer: 0, why: 'Small samples are noise. 30+ gives you a first honest read.' }
    ]
  },
  {
    id: 'psychology-tilt', level: 4, emoji: '🧠', name: 'Psychology: fear, greed, FOMO and tilt',
    tags: ['psychology', 'risk management'], minutes: 7,
    summary: 'Your brain is optimised for survival on a savannah, not for probabilistic decision-making with money on the line. You have to build rules that protect you from yourself.',
    rules: [
      'FOMO is a physical feeling (heat, urgency, tight chest). Name it out loud — naming it reduces its power.',
      'Loss aversion: a loss hurts ~2x more than an equal gain pleases. That is why you cut winners early and hold losers.',
      'Tilt protocol: after 2 losses, stand up, leave the screen for 15 minutes, and only return if you can state your next setup out loud.',
      'Revenge trading is always bigger size and worse setups. Cap your daily loss at 2-3% and make the platform close.',
      'Boredom produces trades that look like setups. If you are trading because nothing is happening, that is the tell.',
      'Confidence should come from your process being followed, not from the outcome of the last trade.',
      'Sleep, food and stress move your win rate more than any indicator.'
    ],
    entry: 'n/a', invalidation: 'n/a', target: 'n/a',
    risk: 'Every rule in this curriculum fails under tilt. Psychology is the layer that keeps the others working.',
    drill: 'For one week, before every click, say out loud: "My setup is ___, my stop is ___, my risk is ___%." If you cannot finish the sentence, you cannot click.',
    screenHooks: ['Rapid re-entries right after a loss', 'Position size increasing after a loss', 'Screens open late at night'],
    mistakes: ['Judging a decision by its outcome', 'No daily loss cap', 'Trading while tired, angry or euphoric'],
    quiz: [
      { q: 'You take a loss and immediately open a bigger position to "make it back". This is…', options: ['Revenge trading / tilt', 'Good risk management', 'Scaling in', 'Arbitrage'], answer: 0, why: 'It is the single most expensive habit in trading, and it feels reasonable while you are doing it.' },
      { q: 'The best response to 2 consecutive losses is…', options: ['Stop, step away, return only with a stated setup', 'Trade smaller but keep going', 'Switch strategy immediately', 'Double the next size'], answer: 0, why: 'A circuit breaker protects the account from your own state of mind.' }
    ]
  },
  {
    id: 'backtesting-expectancy', level: 4, emoji: '🧪', name: 'Backtesting and expectancy: proving your edge',
    tags: ['trading plan', 'risk management'], minutes: 6,
    summary: 'An edge is a positive expectancy measured over enough trades. Everything else is storytelling.',
    rules: [
      'Expectancy per trade = (win% × average win in R) − (loss% × average loss in R). Positive = you have something.',
      'Measure in R (multiples of your risk), not money or percent. R makes different setups comparable.',
      'Minimum 30 trades, ideally 100, with the SAME rules, before judging a strategy.',
      'Manual backtesting (scrolling bar by bar) teaches you more than any automated test as a beginner.',
      'Beware hindsight bias: you see the right side of the chart. Cover it and only reveal candle by candle.',
      'Include costs: spread, commission, slippage. A scalping edge can be entirely eaten by fees.',
      'Maximum drawdown matters more than total return. Can you stomach the worst month this system produces?'
    ],
    entry: 'n/a', invalidation: 'n/a', target: 'n/a',
    risk: 'A system with positive expectancy can still have a 30% drawdown. Sizing must survive that, or the maths never gets to pay you.',
    drill: 'Pick one setup. Scroll back 3 months, bar by bar, and log 30 signals with entry/stop/target and R result. Compute win%, average R, expectancy, worst streak.',
    screenHooks: ['A chart with the replay/bar-by-replay mode active', 'A spreadsheet of trades next to the chart'],
    mistakes: ['Testing 5 trades and declaring an edge', 'Optimising parameters until the past looks perfect (curve fitting)', 'Ignoring fees and slippage'],
    quiz: [
      { q: 'Win rate 40%, average win 2R, average loss 1R. Expectancy is…', options: ['+0.2R per trade (profitable)', '−0.2R', 'Zero', 'Impossible to know'], answer: 0, why: '(0.4 × 2) − (0.6 × 1) = 0.8 − 0.6 = +0.2R. You can lose most trades and still make money.' },
      { q: 'Why measure results in R instead of money?', options: ['It makes different setups and sizes comparable', 'It looks professional', 'Brokers require it', 'It hides losses'], answer: 0, why: 'R normalises for risk, so a $50 win and a $500 win can be compared fairly.' }
    ]
  },
  {
    id: 'building-your-edge', level: 4, emoji: '⚒️', name: 'Building your own edge from everything you learned',
    tags: ['trading plan', 'psychology', 'risk management'], minutes: 7,
    summary: 'The goal is not to collect strategies. It is to have ONE setup you understand completely, execute perfectly, and can improve with data.',
    rules: [
      'Choose one market, one session, one timeframe pair, one setup. Master it for 60 trades before adding anything.',
      'Your edge = a repeatable context + trigger + risk rule that you have data for. Not a feeling about a chart.',
      'Specialisation beats variety: a trader who knows one setup deeply outperforms one who knows ten shallowly.',
      'Paper trade until your execution score (rules followed %) is above 90%, regardless of profit.',
      'Only go live with money you can lose entirely, at the smallest size the platform allows.',
      'Review your own journal monthly and let the data promote or demote your setups.',
      'The companion\'s job is to keep you honest about all of the above.'
    ],
    entry: 'Your one documented setup.',
    invalidation: 'Documented.',
    target: 'Documented.',
    risk: 'Adding a new strategy after a losing week is how a working system gets destroyed. Fix execution first.',
    drill: 'Write your "one setup" card: context, trigger, stop, target, size, no-trade conditions. Pin it. Trade nothing else for 30 trades.',
    screenHooks: ['More than 3 charts open', 'A new indicator added mid-session', 'Switching instruments after a loss'],
    mistakes: ['Strategy hopping after every losing streak', 'Going live too early with too much size', 'Measuring success in money before execution'],
    quiz: [
      { q: 'A beginner\'s fastest path to consistency is…', options: ['One setup, executed well, measured over 60 trades', 'Learning ten strategies', 'Following signals', 'Higher leverage'], answer: 0, why: 'Depth creates data; data creates confidence; confidence creates consistency.' },
      { q: 'Before trading real money you should be able to show…', options: ['A high execution score on paper trades', 'A big win', 'A good feeling', 'A funded account'], answer: 0, why: 'Execution is controllable. Outcome is not. Prove the controllable part first.' }
    ]
  }
];

const LEVEL_NAMES = { 1: '🌱 Foundation', 2: '📖 Reading charts', 3: '🎯 Playbooks', 4: '🧠 Execution & mind' };

const SKILL_TAGS = ['price action', 'support & resistance', 'trend trading', 'breakouts', 'chart patterns',
  'indicators', 'volume', 'smart money / ICT', 'risk management', 'psychology', 'trading plan'];

function byId(id) { return LIBRARY.find((m) => m.id === id) || null; }

function listModules() {
  return LIBRARY.map((m) => ({
    id: m.id, level: m.level, emoji: m.emoji, name: m.name, tags: m.tags, minutes: m.minutes,
    summary: m.summary, rules: m.rules, entry: m.entry, invalidation: m.invalidation, target: m.target,
    risk: m.risk, drill: m.drill, screenHooks: m.screenHooks, mistakes: m.mistakes,
    quizCount: (m.quiz || []).length
  }));
}

/* ------------------------------- skill profile ------------------------------ */

function blankSkill() { return { exposure: 0, correct: 0, wrong: 0, taught: 0, lastTaught: 0, lastWrong: 0 }; }

function skillOf(profile, tag) {
  if (!profile[tag]) profile[tag] = blankSkill();
  return profile[tag];
}

/** Record that the coach taught something tagged with `tag`. */
function markTaught(profile, tag, weight) {
  if (!tag) return profile;
  const s = skillOf(profile, tag);
  s.taught += 1;
  s.exposure += (weight == null ? 1 : weight);
  s.lastTaught = Date.now();
  return profile;
}

/** Record a quiz answer. */
function markAnswer(profile, tag, correct) {
  if (!tag) return profile;
  const s = skillOf(profile, tag);
  s.exposure += 1;
  if (correct) s.correct += 1; else { s.wrong += 1; s.lastWrong = Date.now(); }
  return profile;
}

/** 0-100 mastery estimate per tag: exposure weighted by accuracy. */
function mastery(skill) {
  if (!skill) return 0;
  const answered = skill.correct + skill.wrong;
  const accuracy = answered ? skill.correct / answered : 0.5;
  const volume = Math.min(1, (skill.exposure || 0) / 12);
  return Math.round(volume * (0.35 + 0.65 * accuracy) * 100);
}

function weaknessScore(skill) {
  const answered = (skill && skill.correct + skill.wrong) || 0;
  if (!answered) return 0.35; // unknown = mild priority
  const wrongRate = skill.wrong / answered;
  return Math.min(1, wrongRate * 1.3 + (answered < 3 ? 0.15 : 0));
}

/**
 * Build the next-best study plan.
 * @param {{skills?:object, kbTags?:string[], doneModules?:string[], level?:number}} state
 * @returns {Array<{module:object, reason:string, priority:number}>}
 */
function planFor(state) {
  const st = state || {};
  const skills = st.skills || {};
  const kbTags = new Set(st.kbTags || []);
  const done = new Set(st.doneModules || []);

  const scored = LIBRARY.map((m) => {
    let priority = 0;
    const reasons = [];

    // Curriculum order matters: foundations first.
    priority += (5 - m.level) * 12;

    const tagScores = m.tags.map((t) => weaknessScore(skills[t]));
    const weak = Math.max.apply(null, tagScores.concat([0]));
    priority += weak * 34;
    if (weak > 0.5) reasons.push('you keep missing questions on ' + m.tags[0]);

    const untaught = m.tags.filter((t) => !(skills[t] && skills[t].exposure > 0));
    if (untaught.length === m.tags.length) { priority += 16; reasons.push('never covered yet'); }

    if (!m.tags.some((t) => kbTags.has(t))) {
      priority += 12;
      reasons.push('nothing in your fed library covers ' + m.tags[0]);
    } else {
      priority -= 4;
      reasons.push('your library has material on this — I will quote it');
    }

    if (done.has(m.id)) { priority -= 26; reasons.push('completed (revision)'); }

    // Risk management is never allowed to fall far down the list.
    if (m.tags.includes('risk management')) priority += 10;

    if (!reasons.length) reasons.push('next in the curriculum');

    return { module: m, priority: Math.round(priority), reason: reasons.slice(0, 2).join(' · ') };
  });

  scored.sort((a, b) => b.priority - a.priority);
  return scored;
}

/** Pick a micro-lesson for the live panel: short, immediately usable. */
function microLesson(tag) {
  const pool = LIBRARY.filter((m) => !tag || m.tags.includes(tag));
  const m = pool.length ? pool[Math.floor(Math.random() * pool.length)] : LIBRARY[0];
  const rule = m.rules[Math.floor(Math.random() * m.rules.length)];
  return { moduleId: m.id, name: m.name, emoji: m.emoji, tag: m.tags[0], rule };
}

/** A quiz question, optionally restricted to tags the trader is weak on. */
function quizQuestion(tags) {
  const want = (tags || []).filter(Boolean);
  const pool = LIBRARY.filter((m) => !want.length || m.tags.some((t) => want.includes(t)));
  const modules = pool.length ? pool : LIBRARY;
  const m = modules[Math.floor(Math.random() * modules.length)];
  const q = (m.quiz || [])[Math.floor(Math.random() * (m.quiz || []).length)];
  if (!q) return null;
  // Keep the requested topic as the tag when this module really covers it, so
  // the skill profile is credited to the right place.
  const asked = want.find((t) => m.tags.includes(t));
  return Object.assign({}, q, { moduleId: m.id, moduleName: m.name, tag: asked || m.tags[0], emoji: m.emoji });
}

/** Convert a module (or an AI-distilled card) into the existing Professor Fox
 *  lesson format so it can be published into lessons.json and shown in the main app. */
function moduleToLesson(m, extra) {
  const sections = [
    { h: 'The idea in one line', b: m.summary, ex: null },
    { h: 'Rules to follow', b: m.rules.map((r, i) => (i + 1) + '. ' + r).join('\n'), ex: null },
    { h: 'Entry · Stop · Target', b: 'Entry: ' + m.entry + '\nInvalidation: ' + m.invalidation + '\nTarget: ' + m.target, ex: null },
    { h: 'Risk note', b: m.risk, ex: null },
    { h: 'Your practice drill', b: m.drill, ex: null }
  ];
  return {
    id: 'coach_' + m.id,
    title: (m.emoji || '📘') + ' ' + m.name,
    emoji: m.emoji || '📘',
    minutes: (m.minutes || 4) + ' min read',
    easy: String(m.summary || '').slice(0, 190),
    tip: String(m.risk || '').slice(0, 290),
    sections,
    questions: (m.quiz || []).slice(0, 4).map((q) => ({ q: q.q, options: q.options, answer: q.answer, why: q.why })),
    source: extra && extra.source ? extra.source : 'Built-in curriculum'
  };
}

const __exports = {
  LIBRARY, LEVEL_NAMES, SKILL_TAGS, byId, listModules, planFor, microLesson, quizQuestion,
  mastery, weaknessScore, markTaught, markAnswer, moduleToLesson, blankSkill
};
// Works in Node (require) and in the browser/Electron renderer (<script> tag).
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
if (typeof globalThis !== 'undefined') { globalThis.TCEngine = globalThis.TCEngine || {}; globalThis.TCEngine.curriculum = __exports; }
