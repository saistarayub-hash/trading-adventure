'use strict';
/* tools/seed-demo.js — load a small starter library so you can see the companion
 * working before you feed it your own videos and links.
 *
 *   node tools/seed-demo.js                 # seeds ./.data (used by node server.js)
 *   COMPANION_DATA=/path node tools/seed-demo.js
 *
 * Everything here is plain educational text written for this project — no
 * copyrighted transcripts, and nothing that requires an API key. */

const path = require('path');
const { createCore } = require('../companion-core');

const DATA_DIR = process.env.COMPANION_DATA || path.join(__dirname, '..', '.data');

const SOURCES = [
  {
    title: 'Starter: market structure and trend',
    text:
      'MARKET STRUCTURE\n\n' +
      'An uptrend is a sequence of higher highs and higher lows. A downtrend is a sequence of lower highs and lower lows. ' +
      'Anything without that sequence is a range, and ranges are where trend traders lose money.\n\n' +
      'Structure only breaks on a closing basis. A wick that pokes through a swing low is not a break, because wicks show ' +
      'rejection, not commitment. Before you form any opinion about direction, label the last two swing highs and the last ' +
      'two swing lows on the chart in front of you.\n\n' +
      'If you cannot name the most recent higher low, you have nowhere logical to put a stop, which means you do not have a ' +
      'trade. That single filter removes most impulsive entries.\n\n' +
      'Higher timeframes dominate lower timeframes. A four hour close outweighs twenty one minute candles. Pick three ' +
      'timeframes and no more: one for context, one for the setup, one for the entry trigger.',
    tags: ['trend trading', 'price action']
  },
  {
    title: 'Starter: the 1% risk rule and position sizing',
    text:
      'POSITION SIZING AND RISK\n\n' +
      'Risk between 0.5% and 1% of account equity on a single trade. At 1% you can be wrong ten times in a row and still ' +
      'have roughly 90% of your capital, which means you are still in the game while you learn.\n\n' +
      'Position size equals account equity multiplied by risk percent, divided by the distance from entry to stop. The stop ' +
      'distance determines the size. Never choose a size first and then look for a stop that fits it.\n\n' +
      'Worked example: a $2,000 account risking 1% risks $20. If the entry is 64,250 and the stop is 63,800, the distance ' +
      'is 450, so the size is 20 divided by 450, which is about 0.044 units. That number is not exciting. That is the point.\n\n' +
      'Leverage does not change your risk. It only changes how much margin you must post. Two traders with the same size and ' +
      'the same stop have the same risk whether one uses 5x leverage and the other uses 50x.\n\n' +
      'Circuit breakers: after two consecutive losses in a day, cut your size in half. After three, close the platform and ' +
      'come back tomorrow. Expectancy is win rate times average win minus loss rate times average loss, measured in R, where ' +
      'one R is the amount you risked.',
    tags: ['risk management']
  },
  {
    title: 'Starter: breakouts, retests and fakeouts',
    text:
      'BREAKOUTS AND FAKEOUTS\n\n' +
      'A valid breakout needs three things: a real level built from several touches, a candle that closes beyond it, and ' +
      'expansion in volume or candle range. Most breakouts fail, which is why the safer entry is the retest of the broken ' +
      'level from the new side rather than the break itself.\n\n' +
      'If price breaks above resistance and the next candle closes back inside the range, that is a failed breakout. The ' +
      'traders who bought the break are now trapped and must exit, and their exits often drive a strong move in the opposite ' +
      'direction. A failed breakout is therefore a signal in its own right, not just a disappointment.\n\n' +
      'Breakouts from a long, tight consolidation are more reliable than breakouts from an already extended move, because the ' +
      'consolidation shows that both sides have been absorbing orders at that price.\n\n' +
      'Put your stop beyond the broken level, not inside the old range, and target the height of the range projected from the ' +
      'breakout point. Treat that projection as a guideline for where to take partial profit, not as a promise.',
    tags: ['breakouts', 'support & resistance', 'volume']
  },
  {
    title: 'Starter: trading psychology and tilt',
    text:
      'PSYCHOLOGY, FOMO AND TILT\n\n' +
      'FOMO has a physical signature: heat in the face, urgency in the chest, and a desire to click immediately. Naming it ' +
      'out loud reduces its power. Say "this is FOMO" and wait for the candle to close.\n\n' +
      'Loss aversion means a loss hurts about twice as much as an equal gain pleases. That is why beginners cut winners early ' +
      'and hold losers: taking profit ends the anxiety, while holding a loser preserves hope.\n\n' +
      'Tilt protocol: after two losses, stand up and leave the screen for fifteen minutes. Only return if you can state your ' +
      'next setup out loud, including the stop and the risk. Revenge trading always arrives with a larger size and a worse ' +
      'setup, and it is the single most common way a small account becomes an empty account.\n\n' +
      'Boredom produces trades that look like setups. If you are entering because nothing is happening, that is the tell. ' +
      'Judge every decision by whether you followed your process, never by whether it made money. A good decision can lose ' +
      'and a bad decision can win, and only the process compounds.',
    tags: ['psychology', 'risk management']
  },
  {
    title: 'Starter: support, resistance and liquidity',
    text:
      'LEVELS, ZONES AND LIQUIDITY\n\n' +
      'Levels are zones, not lines. Draw them from at least two or three touches, using the wicks for the edges of the zone ' +
      'and the bodies for its heart. A level that has been tested many times is weakening, because the orders that created ' +
      'the reaction are being consumed. A fresh level is stronger than a familiar one.\n\n' +
      'When resistance breaks, it tends to become support, and the retest of that flip is one of the highest quality entries ' +
      'available to a beginner. Round numbers, the previous day high and low, and the previous week levels attract orders.\n\n' +
      'Obvious highs and lows are also where most retail stops sit. A fast wick through such a level that closes back on the ' +
      'original side is a liquidity sweep, and it often precedes a move toward the liquidity on the other side of the range. ' +
      'If your stop sits exactly where everyone else put theirs, you are the liquidity. Place it beyond the obvious level, ' +
      'with room, and reduce your size to keep the risk the same.',
    tags: ['support & resistance', 'smart money / ICT', 'price action']
  }
];

async function main() {
  const core = createCore({ dataDir: DATA_DIR });
  console.log('Seeding the companion starter library into: ' + DATA_DIR);
  let added = 0;
  for (const s of SOURCES) {
    const existing = core.kb.db.sources.find((x) => x.title === s.title);
    if (existing) { console.log('  = already there: ' + s.title); continue; }
    const r = await core.ingestText(s.text, s.title);
    if (r.ok) { added++; console.log('  + ' + s.title + '  (' + r.chunks + ' searchable pieces)'); }
    else console.log('  ! ' + s.title + ' → ' + r.error);
    const src = core.kb.db.sources.find((x) => x.title === s.title);
    if (src) {
      src.tags = Array.from(new Set((src.tags || []).concat(s.tags || [])));
      src.starter = true;
    }
  }
  core.kb.save();

  const stats = core.state('seed').stats;
  console.log('\nKnowledge base now holds:');
  console.log('  sources   ' + stats.sources);
  console.log('  pieces    ' + stats.chunks);
  console.log('  words     ' + stats.words);
  console.log('  topics    ' + stats.tags.map((t) => t.tag).join(', '));
  if (stats.coverageGaps.length) console.log('  gaps      ' + stats.coverageGaps.join(', '));
  console.log('\nAdded ' + added + ' source(s). Restart nothing — the server picks this up on the next request.');
}

main().catch((e) => { console.error(e); process.exit(1); });
