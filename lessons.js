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
  },
  {
    id: 'wantsneeds',
    emoji: '🧦',
    title: 'Wants vs Needs',
    minutes: '3 min read',
    easy: 'The Big Idea: Needs are the stuff you must have. Wants are the stuff you just really, really like.',
    sections: [
      {
        h: 'Needs come first',
        b: 'Needs keep you safe and healthy — food, water, a roof, warm clothes, and a bed. Spend money on needs BEFORE wants, like loading the school bag before the snacks.',
        ex: 'Rain jacket = need. Sparkly rain jacket with a cape = want.'
      },
      {
        h: 'Wants are still okay',
        b: 'Wants make life fun — toys, games, ice cream, cinema trips. The trick is choosing a few favourite wants instead of every single one. Same money, happier you.',
        ex: 'One game you will play 40 times beats ten games you play once.'
      },
      {
        h: 'The pause trick',
        b: 'Before buying a want, wait one day (or one hour). If you still want it tomorrow, it might be a real favourite — if the buzz faded, you just saved a coin.',
        ex: 'Put the toy back, walk around the shop once, then decide.'
      }
    ],
    tip: 'The Rule: NEEDS first, then your favourite WANTS. Food, then fun.',
    questions: [
      { q: 'Which of these is a NEED?', options: ['a warm hat in winter', 'jelly beans', 'a new video game', 'glow-in-the-dark shoes'], answer: 0, why: 'Keeping warm is a need — we must have it.' },
      { q: 'Which of these is a WANT?', options: ['a movie ticket', 'milk', 'school shoes that fit', 'medicine when sick'], answer: 0, why: 'A movie ticket is fun but optional — a want.' },
      { q: 'The pause trick says…', options: ['wait before buying a want', 'buy everything instantly', 'hide your wallet', 'needs are silly'], answer: 0, why: 'Waiting one day shows if you really want it.' },
      { q: 'A good money plan spends on…', options: ['needs first, then a few favourite wants', 'only wants, always', 'nothing ever', 'the shiniest things first'], answer: 0, why: 'Needs first keeps you safe; wants bring the fun.' }
    ]
  },
  {
    id: 'compound',
    emoji: '🪄',
    title: 'The Magic of Compound Interest',
    minutes: '3 min read',
    easy: 'The Big Idea: When your money earns, and that money earns too, it grows like a snowball rolling downhill.',
    sections: [
      {
        h: 'Interest pays you for saving',
        b: 'A bank (or a savings jar with a deal) gives you extra money just for keeping money there. That extra money is called interest.',
        ex: 'Save $100, the bank adds $5 of interest — now you have $105.'
      },
      {
        h: 'The snowball effect',
        b: 'Next year the interest is calculated on the BIGGER amount ($105, not $100). Now you earn interest ON your interest. Each year the snowball gets bigger and faster.',
        ex: 'Doubling money each year: 1, 2, 4, 8, 16 — the jumps get huge.'
      },
      {
        h: 'Time is the magic ingredient',
        b: 'Compound grows slow at first, then shockingly fast. That is why grown-ups (and kids) start saving EARLY — time does the heavy lifting.',
        ex: 'Start at 10 vs 30 = way more snowball at 60.'
      }
    ],
    tip: 'The Rule: Save early, earn interest, and watch money build money. Start NOW.',
    questions: [
      { q: 'Interest is…', options: ['extra money you earn for saving', 'a type of sandwich', 'always free money with zero risk', 'just counting coins'], answer: 0, why: 'Interest is the reward for keeping money saved.' },
      { q: 'Compound means…', options: ['your interest earns interest', 'money always doubles overnight', 'only coins can save', 'interest is removed'], answer: 0, why: 'Interest on top of interest — the snowball.' },
      { q: 'The best time to start saving is…', options: ['as early as you can', 'when you retire', 'never', 'only at the weekend'], answer: 0, why: 'More time = bigger magic snowball.' },
      { q: 'If you have $100 and get 5% interest…', options: ['you end with $105', 'you end with $95', 'you lose $5', 'nothing changes'], answer: 0, why: '5% of $100 is $5 of extra money.' }
    ]
  },
  {
    id: 'inflation',
    emoji: '🎈',
    title: 'Inflation — Prices Float Up',
    minutes: '3 min read',
    easy: 'The Big Idea: Over time, most things cost a little MORE. Inflation is the balloon slowly filling up prices.',
    sections: [
      {
        h: 'Why prices rise',
        b: 'People earn more money, ingredients cost more, and things get fancier. Bit by bit, the same ice cream costs more money than it did last year.',
        ex: 'A comic that cost $2 last year might cost $2.20 this year.'
      },
      {
        h: 'Inflation sneaks away your money',
        b: 'If your cash hides under the bed, it does not grow — but prices do. So your money quietly buys less each year. That is why saving in a jar has a hidden cost.',
        ex: '$50 buys fewer toys in 5 years than it does today.'
      },
      {
        h: 'Beat it with growing money',
        b: 'Interest, investing, and learning skills make your money GROW faster than prices. Then your buying power moves forward, not backwards.',
        ex: 'Money that earns 5% beats inflation of 3%.'
      }
    ],
    tip: 'The Rule: Prices rise over time. Make your money grow so it keeps up and pulls ahead.',
    questions: [
      { q: 'Inflation means…', options: ['prices creep up over time', 'prices always go down', 'money doubles instantly', 'you get free money'], answer: 0, why: 'Inflation = the slow rise in prices.' },
      { q: 'If your money hides in a jar during inflation…', options: ['it buys fewer things later', 'it doubles', 'it never changes value', 'it turns gold'], answer: 0, why: 'Cash that does not grow slowly loses buying power.' },
      { q: 'A good defence against inflation is…', options: ['making money grow with interest', 'sleeping on your wallet', 'carrying loose coins', 'ignoring prices'], answer: 0, why: 'Growing money keeps up with, and beats, rising prices.' },
      { q: 'Two years ago a pizza cost $8. With 4% inflation it now costs about…', options: ['$8.60 something', '$4', '$20', 'still $8 forever'], answer: 0, why: 'Prices edge up each year — that is inflation.' }
    ]
  },
  {
    id: 'budget',
    emoji: '📒',
    title: 'Pocket Money Budgets',
    minutes: '3 min read',
    easy: 'The Big Idea: A budget is a simple plan that tells your money where to go BEFORE it is spent.',
    sections: [
      {
        h: 'The four-pile trick',
        b: 'Sharing is easier with boxes: SPEND a little now, SAVE some for later, SHARE something with others, and INVEST a slice to grow. Even toy shops use plans.',
        ex: 'Out of $8 pocket money: $3 spend, $3 save, $1 share, $1 grow.'
      },
      {
        h: 'Money hates surprises',
        b: 'Without a plan, money vanishes in a puff of candy and cheap jewels. A budget means YOU are the boss of your coins, not the candy aisle.',
        ex: 'Budget the pizza first, then the games not the other way round.'
      },
      {
        h: 'Track a little, smile a lot',
        b: 'Tally your coins once a week. Seeing where money went feels like finding a map to a treasure you already own.',
        ex: 'Notebook line: Monday +$3, Tuesday -$1 toy.'
      }
    ],
    tip: 'The Rule: Plan where each coin goes first: spend, save, share, grow.',
    questions: [
      { q: 'A budget is…', options: ['a plan for your money', 'a bag of coins', 'a money tree', 'a shop display'], answer: 0, why: 'A budget is the plan for every coin.' },
      { q: 'Which pile should own a slice of your money?', options: ['all four: spend, save, share, grow', 'only candy', 'only the bank knows', 'none of them'], answer: 0, why: 'Four piles = a balanced plan.' },
      { q: 'A budget helps you…', options: ['stay in charge of your money', 'lose your coins', 'spend randomly', 'hide from numbers'], answer: 0, why: 'Plans keep YOU as the boss of your cash.' },
      { q: 'Once a week, a coin tracker should…', options: ['add up where money went', 'be thrown away', 'buy more snacks', 'do sums in a dream'], answer: 0, why: 'Reviewing your plan sharpens your money map.' }
    ]
  },
  {
    id: 'bank',
    emoji: '🏦',
    title: 'Banks, Savings & Interest',
    minutes: '3 min read',
    easy: 'The Big Idea: A bank is a giant, ultra-safe piggy bank that pays you free money for keeping your coins there.',
    sections: [
      {
        h: 'How a bank works',
        b: 'You deposit money (park it there). The bank keeps it REALLY safe and pays you interest. The bank then lends that cash to others who need it — and charges them interest to cover your payment.',
        ex: 'You save $1,000, bank pays $40 a year. The bank lends it out at $120 a year. Everybody wins.'
      },
      {
        h: 'Savings vs current accounts',
        b: 'Savings accounts pay more interest because you promise to leave the money alone. Current accounts spend easily but pay little. Pick your pot for the job.',
        ex: 'Savings = sleeping treasure. Current = money for everyday treats.'
      },
      {
        h: 'Safety guarantee',
        b: 'In many places your money is insured, even if the bank hits trouble. Your coins are watched over, usually protected, and never in the floorboards.',
        ex: 'The bank vaults are like a castle with a moat.'
      }
    ],
    tip: 'The Rule: Banks pay interest for keeping money. Savings pots pay the most. Safe and sound.',
    questions: [
      { q: 'Interest from a bank means…', options: ['they pay you extra for saving', 'they take your money', 'you pay them to leave', 'coins disappear'], answer: 0, why: 'Interest rewards keeping money in the bank.' },
      { q: 'Which account usually pays MORE interest?', options: ['a savings account', 'a spending card', 'a sock', 'a wallet'], answer: 0, why: 'Savings accounts reward you for not spending.' },
      { q: 'A bank protects your money by…', options: ['keeping it safe and insured', 'burying it randomly', 'printing new coins daily', 'lending it to squirrels'], answer: 0, why: 'Vaults, rules, and insurance keep deposits safe.' },
      { q: 'The bank can lend savings to others because…', options: ['it loans cash and charges interest', 'it steals your coins', 'money grows on trees', 'nobody pays back'], answer: 0, why: 'Lending earns the bank income to pay your interest.' }
    ]
  },
  {
    id: 'diversify',
    emoji: '🧺',
    title: 'Don’t Put All Eggs in One Basket',
    minutes: '3 min read',
    easy: 'The Big Idea: Spread your money across lots of companies and things, so one tumble never breaks your whole fortune.',
    sections: [
      {
        h: 'One basket is risky',
        b: 'If you buy only ONE company and it stumbles, your whole money wobbles. Single bets are thrilling but fragile — like juggling one egg.',
        ex: 'Only one toy maker? If it flops, your whole fortune flops.'
      },
      {
        h: 'Many baskets share the luck',
        b: 'Own a little bit of MANY companies and different kinds of things. When one dips, others usually hold you up. The basket gentle-glides instead of smash-landing.',
        ex: 'Lemonade + umbrella + games: sun or rain, you earn.'
      },
      {
        h: 'Diversification smooths the ride',
        b: 'Experts say spreading money across companies, bonds, and savings is one of the friendliest ways to invest. Lower drama, steadier gains.',
        ex: 'A sports team needs all the players, not one superstar.'
      }
    ],
    tip: 'The Rule: Spread your eggs — own many things, never bet the whole treasure on one.',
    questions: [
      { q: '“Don’t put all your eggs in one basket” means…', options: ['spread your money around', 'collect eggs', 'buy one huge stock', 'hide your cash'], answer: 0, why: 'Spreading reduces the risk of one big tumble.' },
      { q: 'Owning one single company is risky because…', options: ['if it dips, all your money dips', 'it is always the best', 'companies never change', 'it is far too spread out'], answer: 0, why: 'A single company = a single point of failure.' },
      { q: 'Diversification means…', options: ['many different investments', 'one giant gamble', 'only cash', 'never investing'], answer: 0, why: 'Many different things = a smoother ride.' },
      { q: 'When one investment dips, a diverse portfolio…', options: ['is steadied by the others', 'loses everything', 'can never fail', 'doubles instantly'], answer: 0, why: 'Other holdings cushion the dip.' }
    ]
  },
  {
    id: 'index',
    emoji: '🗂️',
    title: 'Indexes & Index Funds',
    minutes: '3 min read',
    easy: 'The Big Idea: An index tracks a big bundle of companies. An index fund lets YOU own a tiny slice of that bundle.',
    sections: [
      {
        h: 'What is an index?',
        b: 'Teachers use average scores; investors use indexes. An index like the S&P 500 averages lots of famous companies’ prices so we can watch the whole team at once.',
        ex: 'The class average says how the class is doing, not one student.'
      },
      {
        h: 'An index fund does the buying for you',
        b: 'You give the fund money; it buys a little piece of every company in the index. One purchase = hundreds of companies. Instant spreading, no juggling!',
        ex: '$50 into an index fund = a crumb of 500 famous firms.'
      },
      {
        h: 'The lazy-but-smart classic',
        b: 'Many experts love index funds because they are cheap, simple, and well-spread. Perfect for kids (and parents) who want to invest without picking winners.',
        ex: 'Buy the whole buffet ticket instead of guessing one dish.'
      }
    ],
    tip: 'The Rule: An index fund owns a slice of MANY companies at once — simple, spread-out investing.',
    questions: [
      { q: 'An index (like the S&P 500) is…', options: ['a bundle-average of many companies', 'an internet password', 'a single share', 'a type of coin'], answer: 0, why: 'Indexes track big groups of companies at once.' },
      { q: 'An index fund lets you…', options: ['own a tiny slice of many companies', 'own one factory', 'skip all rules', 'bet on a single day'], answer: 0, why: 'One fund = lots of companies, instantly spread.' },
      { q: 'Index funds are loved by experts because they are…', options: ['cheap, simple, and spread out', 'secret and pricey', 'only for billionaires', 'impossible to buy'], answer: 0, why: 'The buffet ticket is the friendly classic.' },
      { q: 'Watching an index is like watching…', options: ['the whole team\'s class average', 'one player\'s shoes', 'a single coin flip', 'a magic trick'], answer: 0, why: 'The average shows how the whole team fares.' }
    ]
  },
  {
    id: 'currency',
    emoji: '💱',
    title: 'Currencies & Exchange Rates',
    minutes: '3 min read',
    easy: 'The Big Idea: Different countries use different money, and swapping it has a price called the exchange rate.',
    sections: [
      {
        h: 'Every place has its own money',
        b: 'USA uses dollars ($), Europe uses euros (€), UK uses pounds (£), Japan uses yen (¥). One “10” is worth different things in different lands.',
        ex: 'A grape soda costs $1 in Texas but ¥150 in Tokyo.'
      },
      {
        h: 'Exchange rates flip-flop daily',
        b: 'The rate at which you swap currencies moves a little every day, based on how much everyone wants each money. Rates even shift overnight!',
        ex: 'Today $1 = €0.92; next month maybe €0.90 or €0.95.'
      },
      {
        h: 'Travelling = trading currencies',
        b: 'When you visit abroad you quietly “trade”: hand your local money, receive the local cash at the day’s rate. That swap is a tiny mini-investment.',
        ex: 'Airport counters show the rate on boards like scores.'
      }
    ],
    tip: 'The Rule: Currencies are different moneys, and swapping one for another uses a daily rate.',
    questions: [
      { q: 'Which is TRUE?', options: ['different countries use different money', 'all money is dollars', 'money never changes', 'currencies are free'], answer: 0, why: 'Dollars, euros, pounds, yen — many moneys exist.' },
      { q: 'An exchange rate is…', options: ['the swap-value between two currencies', 'a maths test', 'a kind of magnet', 'a shop sale'], answer: 0, why: 'The rate sets how much currency trades for.' },
      { q: 'Exchange rates…', options: ['move a little day by day', 'are frozen forever', 'only change yearly', 'are all identical'], answer: 0, why: 'Daily shifts reflect demand for each money.' },
      { q: 'When you travel abroad, you…', options: ['swap your money for the local currency', 'keep your money in a dream', 'print new notes', 'pay in jelly beans'], answer: 0, why: 'Travelling means a quiet currency trade at the rate.' }
    ]
  },
  {
    id: 'psych',
    emoji: '🎭',
    title: 'Greed, Fear & Patience',
    minutes: '3 min read',
    easy: 'The Big Idea: The market’s wildest swings come from feelings — greedy crowds and panicky crowds. Patience beats both.',
    sections: [
      {
        h: 'FOMO — the fear of being left out',
        b: 'When prices zoom, FOMO whispers “buy NOW, everyone is winning!” Chasing a hot price is how fortunes are bought at the very top.',
        ex: 'Everyone yells “up up up!” — that is exactly when to think twice.'
      },
      {
        h: 'Panic — the fear of losing',
        b: 'When prices crash, panic shouts “sell NOW, save yourself!” Selling in fear locks in losses that patience would have ridden out.',
        ex: 'Fear sellers sell low; calm sellers wait for the bounce.'
      },
      {
        h: 'The patient hero',
        b: 'Smart investors feel the fear and the greed, then do the boring healthy thing: think in YEARS, not days. Boring usually wins.',
        ex: 'Sleepy turtle crosses first — the tortoise always wins.'
      }
    ],
    tip: 'The Rule: Feelings make prices swing. Decide with plans, not panic — patience is a superpower.',
    questions: [
      { q: 'FOMO means…', options: ['fear of missing out — buying just because others are', 'a friendly monkey', 'free money online', 'a banana report'], answer: 0, why: 'FOMO makes people chase hot, expensive prices.' },
      { q: 'Panic selling usually…', options: ['locks in losses at the low point', 'doubles your money', 'moves markets up', 'is always genius'], answer: 0, why: 'Fear sellers sell low and miss the recovery.' },
      { q: 'The patient approach to investing is…', options: ['thinking in years, not days', 'checking prices every second', 'selling in every drop', 'never buying good things'], answer: 0, why: 'Long-term thinking smooths out the FEELING swings.' },
      { q: 'When everyone is screaming “buy buy buy!”…', options: ['pause and think before you act', 'buy everything instantly', 'sell your house', 'ignore all rules'], answer: 0, why: 'The loudest moments are often the riskiest.' }
    ]
  },
  {
    id: 'debt',
    emoji: '🏷️',
    title: 'Borrowing, Debt & Interest',
    minutes: '3 min read',
    easy: 'The Big Idea: Borrowing money means paying it BACK with extra — the extra is interest. Debt is a promise with a price tag.',
    sections: [
      {
        h: 'Borrowing costs extra',
        b: 'Friends do not charge interest, but banks do. Borrow $100 and agree to pay back $110 — the extra $10 is the loan’s price.',
        ex: 'Borrowing = renting money for a little while.'
      },
      {
        h: 'The snowball goes backwards',
        b: 'Interest on debt compounds TOO — but against you. Unpaid loans grow like a grumpy snowball, so paying on time is the winning move.',
        ex: '$10 unpaid fees turn into $15, then $22. Ouch.'
      },
      {
        h: 'Good debt vs bad debt',
        b: 'Borrowing for things that build your future (a tool, an education) can be smart. Borrowing for junk that melts in a week is usually a trap.',
        ex: 'A bike to earn deliveries = good. Blinking sneakers = sad debt.'
      }
    ],
    tip: 'The Rule: Borrowed money returns with interest. Pay on time, and borrow only for things that help you grow.',
    questions: [
      { q: 'When you borrow money you must…', options: ['pay it back plus interest', 'never return it', 'share it with squirrels', 'hide it forever'], answer: 0, why: 'Lending has a price: the extra interest.' },
      { q: 'Interest on debt…', options: ['grows the longer you owe', 'shrinks each week', 'is always free', 'disappears at night'], answer: 0, why: 'Unpaid debt compounds against you.' },
      { q: 'Paying your loan late usually means…', options: ['more money owed, extra fees', 'a free holiday', 'the debt vanishes', 'you earn a badge'], answer: 0, why: 'Late payment grows the bill.' },
      { q: 'A smarter reason to borrow is…', options: ['a tool that helps you earn', 'a flashy trinket you\'ll drop', 'another snack', 'a ticket to anywhere'], answer: 0, why: 'Future-building debts can be worth their cost.' }
    ]
  },
  {
    id: 'oppcost',
    emoji: '⏳',
    title: 'Opportunity Cost',
    minutes: '3 min read',
    easy: 'The Big Idea: Every time you choose ONE thing, you quietly give up other things. That hidden give-up is opportunity cost.',
    sections: [
      {
        h: 'Every choice has a price',
        b: 'Spent the whole week’s coins on one game? Then you cannot buy the comic AND the poster. The thing you DIDN’T choose is the opportunity cost.',
        ex: 'Ice cream now vs two lollipops later — you pick one.'
      },
      {
        h: 'It is not just money',
        b: 'Opportunity cost is also TIME. Two hours gaming = two hours you are not building a treehouse, reading, or stacking coins. Choose your hours like coins.',
        ex: 'One screen hour costs one park hour. Choose wisely.'
      },
      {
        h: 'Comparing choices like a pro',
        b: 'Before buying, ask: “What else could this coin do?” If the alternative is better, spend there. That tiny habit is big-time money wisdom.',
        ex: '$5 on a sticker vs $5 saved toward the robot kit.'
      }
    ],
    tip: 'The Rule: Choosing one thing costs the next-best thing. Always check what a coin could do instead.',
    questions: [
      { q: 'Opportunity cost is…', options: ['what you give up when you choose', 'a free coupon', 'a type of coin', 'a lucky number'], answer: 0, why: 'The road not taken is the cost of the road taken.' },
      { q: 'If you buy the game with all your money, you give up…', options: ['the other things that money could buy', 'nothing at all', 'tomorrow', 'your lucky socks'], answer: 0, why: 'Spent coins can no longer buy other things.' },
      { q: 'Opportunity cost applies to TIME too because…', options: ['hours spent one way can’t be spent another', 'time is fake', 'only money counts', 'clocks are toys'], answer: 0, why: 'Both money and hours are limited — spend them well.' },
      { q: 'Before buying, a smart kid asks…', options: ['what else could this coin do?', 'which sticker is shiniest?', 'who has the loudest money?', 'can I spend twice?'], answer: 0, why: 'Comparing options shows the real cost.' }
    ]
  },
  {
    id: 'volatility',
    emoji: '🌊',
    title: 'Up and Down Days (Volatility)',
    minutes: '3 min read',
    easy: 'The Big Idea: Prices wobble and wiggle every day — that wiggling is volatility. Waves are normal, not an emergency.',
    sections: [
      {
        h: 'Prices surf, not climb',
        b: 'A stock hardly ever goes in a straight line. It zigs up, zags down, and drifts — that rhythm of swings is volatility. Like waves on the sea.',
        ex: 'Day 1: +3, Day 2: -1, Day 3: +2. Normal surf!'
      },
      {
        h: 'Big swings = splashy… and scary',
        b: 'High volatility means bigger ups and bigger downs. It can feel amazing on the up and horrible on the down. Same wave, different moods.',
        ex: 'A rollercoaster and a seesaw are both just motion.'
      },
      {
        h: 'Tame the waves with time',
        b: 'Stretched over YEARS, day-to-day waves smooth into a gentle rising tide. Short-term watchers get seasick; long-term sailors enjoy the cruise.',
        ex: 'A week of drops may still be a year of gains.'
      }
    ],
    tip: 'The Rule: Prices wiggle daily. Waves are normal — ride them with patience and long time horizons.',
    questions: [
      { q: 'Volatility is…', options: ['the wiggle and swing of prices', 'a volcano problem', 'a flat line', 'a shopping mania'], answer: 0, why: 'Volatility = the daily up-and-down motion.' },
      { q: 'A stock that swings +3 then -1 then +2 is…', options: ['normal, wiggly market behaviour', 'a broken computer', 'proof it is lost', 'urgently weird'], answer: 0, why: 'Waves are the sea’s normal rhythm.' },
      { q: 'Over YEARS, daily volatility tends to…', options: ['smooth into a rising tide', 'double every hour', 'erase all gains', 'turn gold'], answer: 0, why: 'Long horizons soak up the short-term noise.' },
      { q: 'Feeling seasick about a one-week drop?', options: ['check the year-long trend first', 'sell everything instantly', 'hide under a blanket', 'blame the wind'], answer: 0, why: 'Short waves don\'t decide long journeys.' }
    ]
  },
  {
    id: 'profit',
    emoji: '🍰',
    title: 'How Companies Earn Money',
    minutes: '3 min read',
    easy: 'The Big Idea: Companies collect money (revenue), pay their costs, and the leftover sweet slice is profit. Profit makes shares grow.',
    sections: [
      {
        h: 'Revenue vs profit',
        b: 'Revenue is ALL the money flowing in — every sale, every lemonade. Profit is what remains after paying for lemons, cups, helpers, and rent.',
        ex: 'Sold $100 of lemonade, costs $70 → profit $30.'
      },
      {
        h: 'Profit makes share prices happy',
        b: 'When a company earns more profit, it can pay dividends, build new stuff, or buy back shares. Bigger profits usually nudge the share price up.',
        ex: 'More customers + lower costs = bigger sweet slice.'
      },
      {
        h: 'Watch the costs, kid',
        b: 'Companies win by raising revenue AND trimming waste. Smart winners do both — like baking more pies with the same stove.',
        ex: 'Sell more AND spill less sugar = fatter profit.'
      }
    ],
    tip: 'The Rule: Profit = money left after costs. More profit usually means healthier shares.',
    questions: [
      { q: 'Revenue is…', options: ['all the money a company takes in', 'the profit only', 'a kind of tax', 'a boss\'s salary'], answer: 0, why: 'Revenue is the total money flowing in.' },
      { q: 'Profit is…', options: ['what’s left after paying the costs', 'the money lost', 'the rented building', 'the workers\' shoes'], answer: 0, why: 'Profit is the leftover slice after bills.' },
      { q: 'A company that keeps growing profit usually sees…', options: ['happier share prices', 'losing customers', 'empty shelves', 'no change ever'], answer: 0, why: 'Bigger profits lift the shares.' },
      { q: 'Profits rise when a company…', options: ['sells more and wastes less', 'only raises prices wildly', 'hides its products', 'stops selling'], answer: 0, why: 'More sales + lower costs = better profit math.' }
    ]
  },
  {
    id: 'dividends',
    emoji: '🍬',
    title: 'Dividends — Share Gifts',
    minutes: '3 min read',
    easy: 'The Big Idea: Some companies share their profit with owners as dividends — a cash gift, just for holding shares.',
    sections: [
      {
        h: 'Owning a slice = a share of the pie',
        b: 'When you own shares, you own a scrap of the company. If the company earns a fat profit, it sometimes shares a slice with its owners as a dividend.',
        ex: 'Own 10 shares, get $2 per share → $20 gift.'
      },
      {
        h: 'Dividends can flow again and again',
        b: 'Some companies pay dividends every few months, like pocket money from the company to you. Collecting them is called dividend income.',
        ex: 'Every pizza sold is a crumb you receive as owner.'
      },
      {
        h: 'Reinvest the gifts to make them grow',
        b: 'Use the dividend cash to buy MORE shares, and next gift is bigger. Gifts that buy gifts — the snowball strikes again!',
        ex: 'Gift $20 buys more shares → next gift is higher.'
      }
    ],
    tip: 'The Rule: Dividends are profit-slices shared with owners. Reinvest them to grow the party.',
    questions: [
      { q: 'A dividend is…', options: ['profit shared with share owners', 'a bank loan', 'a shopping list', 'a company invoice'], answer: 0, why: 'Dividends share company profit with owners.' },
      { q: 'To receive dividends you usually need to…', options: ['own shares in the company', 'work there daily', 'live next door', 'buy a poster of it'], answer: 0, why: 'Owning shares makes you an owner.' },
      { q: 'Many dividend companies pay…', options: ['regularly, like pocket money', 'only once ever', 'never, by law', 'in coupons only'], answer: 0, why: 'Regular dividend income is common.' },
      { q: 'A smart move with dividend cash is…', options: ['reinvesting to buy more shares', 'burning the receipt', 'throwing it away', 'ignoring it'], answer: 0, why: 'Reinvested gifts grow into bigger gifts.' }
    ]
  }
];

const FALLBACK_AI = {
  chooseMessage: '🦊 I was asleep, but here is the short version: the answer is right because it follows the lesson rule. Which part is confusing? Ask me again when my brain is awake!'
};