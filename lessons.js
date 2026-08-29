'use strict';

const LESSONS = [
  {
    id: 'money',
    emoji: '🍎',
    title: 'Money 101',
    minutes: '2 min read',
    easy: 'The Big Idea: Buy something cheap, sell it for more. That profit is a win!',
    sections: [
      {
        h: 'What is trading?',
        b: 'Trading sounds like a big grown-up word, but it is just this: buy something for one price, then sell it for a higher price. The difference is your win (your profit).',
        ex: 'Leo buys a comic for $2 and sells it to Max for $5. Leo just made $3. That is trading!'
      },
      {
        h: 'Why money?',
        b: "Long ago people swapped things — I give you my banana, you give me your apple. That is swapping. The problem? You must find someone who wants exactly what you have. Money was invented so everyone agrees on little coins and notes, and swapping got 10,000 times easier.",
        ex: "Nobody wanted Jo's extra socks, but everyone wants shiny coins."
      },
      {
        h: 'The whole secret',
        b: 'Buy low, sell high = you win. Buy high, sell low = you lose. That really is the whole secret of trading. Professional traders just do it millions of times, very carefully, with pretend money first.',
        ex: 'Water bottle sells for $1, but everyone is thirsty and it is the only one — you can sell it for $3!'
      }
    ],
    tip: 'The Rule: You only win a trade when you sell higher than you bought (or buy back lower). There is no other secret.',
    questions: [
      { q: 'Trading is mostly about…', options: ['Buying things cheap and selling for more', 'Swapping secrets', 'Paying extra taxes', 'Wearing lucky hats'], answer: 0, why: 'Buy low, sell high! That is the whole game.' },
      { q: 'What was the tricky part of swapping (barter)?', options: ['You had to find someone who wants what you have', 'It was too fast', 'It made too much money', 'It only worked on Mondays'], answer: 0, why: 'If nobody wants your socks, you cannot swap them. Money fixed that problem.' },
      { q: 'You buy chocolate for $1 and sell it for $3. You…', options: ['made $2', 'broke even', 'lost $2', 'made $30'], answer: 0, why: '3 − 1 = $2 profit. Sell higher than you bought!' },
      { q: 'You buy a toy for $5 and sell it for $2. You…', options: ['lost $3', 'made $3', 'made $2', 'broke even'], answer: 0, why: '2 − 5 = minus $3, so you lost $3. Ouch! Be careful to sell higher.' }
    ]
  },
  {
    id: 'shares',
    emoji: '🧃',
    title: 'Stocks & Shares',
    minutes: '2 min read',
    easy: 'The Big Idea: A share is a tiny slice of a company. Owning shares makes you a mini-partner.',
    sections: [
      {
        h: 'Cut the cake',
        b: 'Imagine a lemonade stand that is worth $100. Now cut it into 10 equal slices — those are shares. If you buy 1 slice, you own 1/10 of the whole stand. A stock, a share, a slice — same thing.',
        ex: 'Kid who owns 4 slices of the stand gets 4/10 of all its lemonade money profits.'
      },
      {
        h: 'Why would I want a slice?',
        b: 'If the company makes lots of money, your slice can become worth more money too. And sometimes the company hands out a little bonus from its profits — that gift is called a dividend.',
        ex: 'The stand makes $30 profit. Owner-slices can share it out — your slice gets its cut!'
      },
      {
        h: 'Pieces can wiggle',
        b: 'Share prices go up and down all the time. Your slice might be worth $10 today and $15 later — or $8 if the stand has a bad week. That up-and-down wiggle is how money is made or lost.',
        ex: 'Famous companies sell shares too: video-game makers, car makers, chocolate makers.'
      }
    ],
    tip: 'The Rule: When you own a share, you are a mini-partner of the business. Treat it like a little slice of cake — never a gamble on a whole bakery.',
    questions: [
      { q: 'A share is…', options: ['a tiny slice of a company', 'a small sandwich', 'a secret password', 'a discount coupon'], answer: 0, why: 'A share = a tiny slice of ownership in a company.' },
      { q: 'A stand has 10 equal shares and you own 1. You own…', options: ['1/10 (one tenth) of it', 'the whole stand', 'half the stand', 'nothing at all'], answer: 0, why: '1 slice of 10 slices = 1/10 of the stand.' },
      { q: 'A dividend is…', options: ['a little money gift from the company profit', 'a kind of pizza', 'a parking ticket', 'a science exam'], answer: 0, why: 'Dividends are small profit-gifts companies sometimes share with slice-owners.' },
      { q: 'If the company makes big profit, your share…', options: ['can become worth more', 'automatically disappears', 'turns into a cow', 'stays frozen forever'], answer: 0, why: 'When the business wins, your slice usually becomes more valuable too.' }
    ]
  },
  {
    id: 'market',
    emoji: '🏪',
    title: 'The Stock Market',
    minutes: '2 min read',
    easy: 'The Big Idea: The stock market is a giant shop where people buy and sell slices of companies.',
    sections: [
      {
        h: 'A shop inside computers',
        b: "The stock market is not one building with a roof. It is a huge shop that lives inside computers. Millions of buyers and sellers meet there every second to trade slices of companies.",
        ex: 'Picture a shopping mall, but instead of shoes, they sell little slices of businesses.'
      },
      {
        h: 'Why prices wiggle every moment',
        b: 'Prices wiggle because people keep buying and selling. If lots of people want a slice right now, the price climbs. If lots of people dump their slices, the price drops. Every second is a tiny auction.',
        ex: 'Two kids both want the last trading card → the price goes up because the card is wanted.'
      },
      {
        h: 'Famous markets',
        b: "Big famous markets live in New York: the NYSE and the NASDAQ. People say 'the market is up today' — that just means most slices went up a little today.",
        ex: 'Thousands of companies, one giant shared shop window.'
      }
    ],
    tip: 'The Rule: A market is just a meeting place for buyers and sellers. No buyers, no sellers, no market.',
    questions: [
      { q: 'The stock market is…', options: ['a giant shop for buying and selling company slices', 'a football stadium', 'a bakery', 'a zoo'], answer: 0, why: 'It is a meeting place for buying and selling shares — inside computers.' },
      { q: 'Who makes prices move?', options: ['all the buyers and sellers together', 'a sneaky wizard', 'the weather report', 'the news reader only'], answer: 0, why: 'Buying and selling pressure is what pushes prices up and down.' },
      { q: 'In trading, “a market” means…', options: ['a meeting place for buyers and sellers', 'a supermarket', 'a holiday', 'a type of dance'], answer: 0, why: 'Buyers meet sellers there. That is all a market is.' }
    ]
  },
  {
    id: 'bullbear',
    emoji: '🐂',
    title: 'Bull vs Bear',
    minutes: '1 min read',
    easy: 'The Big Idea: Bull = prices going UP. Bear = prices going DOWN.',
    sections: [
      {
        h: 'The bull pushes up',
        b: 'In a bull market, prices mostly go up. Everyone is happy and confident like a big strong bull pushing its horns up, up, up.',
        ex: 'Horn emoji: horns point UP → prices go UP.'
      },
      {
        h: 'The bear swipes down',
        b: 'In a bear market, prices mostly go down. People get scared and want to sell, like a big bear swiping its paws DOWN.',
        ex: 'A bear swipes DOWN with its claws → prices go DOWN.'
      },
      {
        h: 'Bullish vs bearish',
        b: 'If you think prices will rise, you are bullish. If you think they will fall, you are bearish. You can say it about you, a person, or even a whole week of trading.',
        ex: "'I am bullish on pizza' = I think pizza prices will go up."
      }
    ],
    tip: 'The Rule: Bull = horns up = prices rising. Bear = claws down = prices falling. Easy to remember!',
    questions: [
      { q: 'A bull market is when prices…', options: ['mostly go up', 'mostly go down', 'stand totally still', 'vanish forever'], answer: 0, why: 'The bull lifts everything UP with its horns.' },
      { q: 'A bear market is when prices…', options: ['mostly go down', 'mostly go up', 'double every day', 'take a nap'], answer: 0, why: 'The bear swipes prices DOWN with its claws.' },
      { q: 'You think prices will rise. You say you are…', options: ['bullish', 'bearish', 'hungry', 'sleepy'], answer: 0, why: 'Bullish = you think UP is coming!' }
    ]
  },
  {
    id: 'supply',
    emoji: '⚖️',
    title: 'Supply & Demand',
    minutes: '2 min read',
    easy: 'The Big Idea: Rare + Wanted = expensive. Plentiful + Not wanted = cheap.',
    sections: [
      {
        h: 'Two big forces',
        b: 'Only two forces move every price. Demand: how many people want it. Supply: how much of it is around. When they tug against each other, prices wiggle.',
        ex: 'Demand is the number of hands reaching for something.'
      },
      {
        h: 'Rare and wanted = price up',
        b: 'If lots of kids want your stickers but you only have 3, you can charge a lot. High demand, low supply, big price.',
        ex: 'The last golden ticket! Everyone wants it, almost no supply → super expensive.'
      },
      {
        h: 'Plentiful and wanted-not = price down',
        b: 'If your school has a million spare pencils and nobody wants them, you almost give them away. High supply, low demand, small price.',
        ex: 'Rainy day and a whole bucket of ice cream nobody wants — prices drop fast.'
      }
    ],
    tip: 'The Rule: Supply is how much there is. Demand is how much people want it. Be a detective and watch both.',
    questions: [
      { q: 'A toy is super popular but only a few exist. It gets…', options: ['more expensive', 'cheaper', 'invisible', 'free'], answer: 0, why: 'High demand + low supply = price goes UP.' },
      { q: 'Too many bananas but very few buyers. Banana price…', options: ['goes down', 'goes up', 'doubles', 'becomes gold'], answer: 0, why: 'Lots of supply but nobody wants them → price drops.' },
      { q: 'Demand means…', options: ['how many people want something', 'how heavy it is', 'a type of dance', 'a holiday'], answer: 0, why: 'Demand = wanting. More wanting = higher price.' },
      { q: 'Supply means…', options: ['how much of it there is', 'how naughty it is', 'the electricity bill', 'a backpack'], answer: 0, why: 'Supply = how much exists. More supply usually = lower price.' }
    ]
  },
  {
    id: 'risk',
    emoji: '🛟',
    title: 'The Golden Rule — Risk',
    minutes: '2 min read',
    easy: 'The Big Idea: Never risk more than you can afford to lose. Practice with pretend money first.',
    sections: [
      {
        h: 'Rule number one',
        b: 'There is exactly one rule you must never break: never risk money you cannot afford to lose. Winners protect their money like treasure. Losers bet everything and cry later.',
        ex: 'Think of your money like a sidewalk: never stand closer to the edge than you can handle.'
      },
      {
        h: 'Practice with pretend money',
        b: 'Before real money, practice with pretend money. It is called paper trading or a demo account. The pretend shop works exactly like the real one — so you learn for free, with zero tears.',
        ex: 'Video game mode before the real match. Same game, no points lost.'
      },
      {
        h: 'Only risk a tiny slice',
        b: 'Real careful traders risk only about 1–2% of their money on one trade. That means $1 to $2 of every $100. Even ten losses in a row leave almost everything safe.',
        ex: '100 cookies in the jar. Only 1 cookie goes on any single bet. That is 1%.'
      },
      {
        h: 'Spot the scam',
        b: 'If someone promises you instant, guaranteed riches — run away. That is a scam, not trading. Real trading has no guarantees, and everyone who promises one is lying to grab your money.',
        ex: "'Send me $10 and get $100 tomorrow!' — that is at best a balloon that pops, at worst a trap."
      }
    ],
    tip: 'The Rule: Protect your money first. Risk only what you can afford to lose. No guarantees, ever — and that is okay, because you only lose a little slice.',
    questions: [
      { q: 'The golden rule of trading is…', options: ['never risk more than you can afford to lose', 'always risk absolutely everything', 'bet the whole house', 'never practise first'], answer: 0, why: 'Protect your money. That rule keeps you in the game for years.' },
      { q: 'Practising with pretend money is called…', options: ['paper trading', 'fake news', 'homework', 'daydreaming'], answer: 0, why: 'Paper trading = practising with pretend money, same rules, no risk.' },
      { q: 'On one single trade, a careful person risks about…', options: ['1–2% of their money', '100% of their money', '90% of their money', 'the whole solar system'], answer: 0, why: '1–2% means a loss barely hurts. Protects the treasure chest.' },
      { q: 'Someone promises INSTANT guaranteed riches. You should…', options: ['run away, it is a scam', 'send them all your money', 'borrow money to give them', 'take a photo of them as a hero'], answer: 0, why: 'Guaranteed riches do not exist in trading. Never trust that promise.' }
    ]
  },
  {
    id: 'candles',
    emoji: '🕯️',
    title: 'Reading a Candle',
    minutes: '2 min read',
    easy: 'The Big Idea: Chart candles are little price stories. Green = up, red = down.',
    sections: [
      {
        h: 'What is a candle?',
        b: 'On trading charts, price action is drawn as little candles. One candle = what happened during one time slice (an hour, a day…). It looks like a candle with a body and two wicks.',
        ex: "A candle for '1 hour' shows the whole hour in one little picture."
      },
      {
        h: 'Body and wicks',
        b: 'The fat part (the body) shows where the price opened and where it closed. The thin lines poking out (the wicks, also called shadows) show the very highest and lowest points reached.',
        ex: "Body says 'started here, finished here'. Wicks say 'got this high, dipped this low'."
      },
      {
        h: 'Green or red?',
        b: 'A green (or white) candle means the price finished HIGHER than it started. A red (or black) candle means it finished LOWER. Super quick way to see if a time slice was up or down.',
        ex: 'Green slice = happy ending. Red slice = grumpy ending.'
      }
    ],
    tip: 'The Rule: Body = open to close. Wicks = the far extremes. Green = closed higher, red = closed lower. That is an entire candle language!',
    questions: [
      { q: 'A green candle usually means the price…', options: ['ended higher than it started', 'ended lower than it started', 'did not move at all', 'exploded'], answer: 0, why: 'Green = up. Price closed higher than its open.' },
      { q: 'The thin lines poking out of a candle are called…', options: ['wicks (or shadows)', 'spaghetti', 'antennae', 'arrows'], answer: 0, why: 'Wicks show the highest and lowest points of the price.' },
      { q: 'On a chart, one candle shows…', options: ['price action for one time period', 'the weather forecast', 'how old you are', 'a class timetable'], answer: 0, why: 'Each candle is one time slice, like one hour or one day.' }
    ]
  },
  {
    id: 'longshort',
    emoji: '🛩️',
    title: 'Long vs Short',
    minutes: '2 min read',
    easy: 'The Big Idea: Long = win when price goes up. Short = win when price goes down. Short is for grown-up level.',
    sections: [
      {
        h: 'Going long',
        b: 'Going long = buying first, hoping the price climbs. Buy at $10, price rises to $12, sell → you win $2. This is the classic, beginner-friendly move.',
        ex: 'Buy a lemonade for $1, sell it after the heatwave for $3. Long = up = win.'
      },
      {
        h: 'Going short',
        b: 'Going short = selling first, hoping the price drops. You borrow an item, sell it at $10, the price falls to $8, you buy it back and return it → you keep the $2 difference. Clever, but slippery and advanced.',
        ex: 'Short is like betting the price will fall. Only suit up for that after lots of practice.'
      },
      {
        h: 'Move the training wheels up gradually',
        b: 'Beginners should start with long trades only. Shorting can lose fast if the price climbs. Slow, gentle practice beats spectacular crash-later every time.',
        ex: 'Ride the bike with training wheels before you try riding backwards.'
      }
    ],
    tip: 'The Rule: LONG = win when price rises. SHORT = win when price falls. Shorts are the advanced slide — go slow, practise first.',
    questions: [
      { q: 'Going “long” means you…', options: ['buy hoping the price goes up', 'sell hoping the price goes down', 'sleep through the day', 'sing a song'], answer: 0, why: 'Long = buy now, sell higher later.' },
      { q: 'Going “short” means you…', options: ['sell first hoping the price falls so you buy back cheaper', 'buy only bananas', 'go on holiday', 'hold everything forever'], answer: 0, why: 'Short = sell high now, buy back lower later. Advanced! Treat carefully.' },
      { q: 'For a brand-new beginner, it is smartest to…', options: ['start with long trades only', 'short everything immediately', 'skip practising', 'bet the whole piggy bank short'], answer: 0, why: 'Long trades are friendlier while you learn. Walk before you run backwards.' }
    ]
  }
];

const FALLBACK_AI = {
  chooseMessage: '🦊 I was asleep, but here is the short version: the answer is right because it follows the lesson rule. Which part is confusing? Ask me again when my brain is awake!'
};