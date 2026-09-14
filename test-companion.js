'use strict';
/* test-companion.js — smoke + unit tests for the Trading Companion.
 *
 *   node test-companion.js
 *
 * Covers: chunking, local embeddings, BM25/hybrid retrieval, the knowledge base,
 * text/HTML/PDF/subtitle extraction, YouTube parsing, ingestion routing, the
 * offline vision reader, the curriculum, distillation parsing, the coach
 * (including its rate limiting), and a real end-to-end HTTP run against
 * server.js on a scratch port with a scratch data directory. */

// server-companion reads COMPANION_TOKEN once at module load; the suite is
// loaded before any require of it, so set the test token up here.
process.env.COMPANION_TOKEN = 'test-token-123';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
function section(t) { console.log('\n== ' + t + ' =='); }

const ENGINE = require('./engine');
const { chunk, keyphrases } = ENGINE.chunk;
const { embed, cosine, topicTags } = ENGINE.embed;
const bm25 = ENGINE.bm25;
const { KnowledgeBase } = ENGINE;
const text = ENGINE.text;
const yt = ENGINE.youtube;
const ingest = ENGINE.ingest;
const vision = ENGINE.vision;
const CUR = ENGINE.curriculum;
const distill = ENGINE.distill;
const coachMod = ENGINE.coach;

async function main() {
  /* ═════════════════════════════ chunking ═════════════════════════════ */

  section('chunk.js');
  const longDoc = Array.from({ length: 14 }, (_, i) =>
    'Section ' + (i + 1) + '. This is paragraph number ' + (i + 1) + ' about trading rules, ' +
    'risk management and price action. It explains one idea per paragraph so the chunker has clean boundaries to work with.').join('\n\n');

  const chunks = chunk(longDoc);
  ok('long document splits into several chunks', chunks.length > 3, 'got ' + chunks.length);
  ok('chunks stay near the target size', chunks.every((c) => c.text.length <= 1700));
  ok('chunk indices are sequential', chunks.every((c, i) => c.i === i));
  ok('no chunk is empty', chunks.every((c) => c.text.trim().length > 20));
  const joined = chunks.map((c) => c.text).join(' ');
  ok('content is preserved across chunks', joined.includes('paragraph number 1') && joined.includes('paragraph number 14'));

  const headed = chunk('# Support and resistance\n\nLevels are zones, not lines.\n\n# Volume\n\nVolume confirms conviction.');
  ok('headings are captured', headed.some((c) => c.heading === 'Support and resistance'), JSON.stringify(headed.map((h) => h.heading)));
  ok('heading is prefixed into the chunk text', headed[0] && headed[0].text.startsWith('Support and resistance'));
  eq('empty text gives no chunks', chunk('').length, 0);
  ok('keyphrases find domain terms', keyphrases('risk management and stop loss placement with position sizing', 8).some((k) => k.includes('risk')));

  /* ═════════════════════════════ embeddings ═════════════════════════════ */

  section('embed.js');
  const v1 = embed('how to place a stop loss beyond the swing low');
  const v2 = embed('where should my stop go below the recent low');
  const v3 = embed('the recipe for a chocolate cake needs flour and butter');
  eq('vector has the configured dimension', v1.length, 256);
  ok('vector is L2 normalised', Math.abs(Math.sqrt(v1.reduce((s, x) => s + x * x, 0)) - 1) < 0.02);
  ok('embeddings are deterministic', JSON.stringify(v1) === JSON.stringify(embed('how to place a stop loss beyond the swing low')));
  ok('similar trading sentences score higher than an unrelated one', cosine(v1, v2) > cosine(v1, v3),
    cosine(v1, v2).toFixed(3) + ' vs ' + cosine(v1, v3).toFixed(3));
  ok('empty text does not produce NaN', embed('').every((x) => isFinite(x)));
  const tags = topicTags('Always use a stop loss and risk one percent. Position sizing protects your drawdown.');
  ok('topic tagger finds risk management', tags.some((t) => t.tag === 'risk management'), JSON.stringify(tags.slice(0, 3)));

  /* ═════════════════════════════ bm25 ═════════════════════════════ */

  section('bm25.js');
  const docs = [
    { id: 'a', text: 'breakout retest of resistance with volume expansion' },
    { id: 'b', text: 'position sizing stop loss risk one percent of equity' },
    { id: 'c', text: 'moving average crossover trend following system' }
  ];
  const idx = bm25.build(docs);
  eq('index counts documents', idx.N, 3);
  const sc = bm25.score(idx, 'stop loss position size');
  ok('bm25 ranks the risk document first', sc.get('b') > (sc.get('a') || 0) && sc.get('b') > (sc.get('c') || 0));
  ok('bm25 returns nothing for an unmatched query', bm25.score(idx, 'zzz qqq').size === 0);
  ok('highlight wraps matched terms', bm25.highlight('the stop loss is below', 'stop').includes('⟦stop⟧'));

  /* ═════════════════════════════ knowledge base ═════════════════════════════ */

  section('kb.js');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-kb-'));
  const kbFile = path.join(tmpDir, 'knowledge.json');
  const kb = new KnowledgeBase(kbFile);

  const DOC_STRUCTURE = ('MARKET STRUCTURE. An uptrend is a sequence of higher highs and higher lows. ' +
    'A downtrend is lower highs and lower lows. Structure only breaks on a closing basis, so a wick that pokes ' +
    'through a swing low is not a break. Label the last two swing highs and the last two swing lows before you ' +
    'form an opinion. If you cannot name the most recent higher low you have no place for a stop and therefore no trade. ').repeat(3);
  const DOC_RISK = ('POSITION SIZING AND RISK. Risk one percent of account equity per trade. Position size equals ' +
    'account multiplied by risk percent divided by the distance from entry to stop. The stop distance determines the size. ' +
    'Leverage does not change risk, it only changes margin. After two consecutive losses cut your size in half. ').repeat(3);
  const DOC_BREAK = ('BREAKOUTS AND FAKEOUTS. A valid breakout needs a real level, a close beyond it, and expansion in volume. ' +
    'Most breakouts fail, so the safer entry is the retest of the broken level. If price breaks above resistance and the next ' +
    'candle closes back inside the range that is a failed breakout. ').repeat(3);

  const r1 = kb.addSource({ kind: 'article', url: 'https://example.com/structure', title: 'Reading market structure', text: DOC_STRUCTURE });
  const r2 = kb.addSource({ kind: 'text', title: 'Risk and sizing notes', text: DOC_RISK });
  const r3 = kb.addSource({ kind: 'video', url: 'https://youtu.be/abcdefghijk', title: 'Breakouts masterclass', text: DOC_BREAK });
  ok('addSource succeeds', r1.ok && r2.ok && r3.ok);
  ok('sources are chunked', r1.chunks >= 1 && r2.chunks >= 1 && r3.chunks >= 1, r1.chunks + ',' + r2.chunks + ',' + r3.chunks);
  eq('source count', kb.db.sources.length, 3);
  eq('chunk count matches', kb.db.chunks.length, r1.chunks + r2.chunks + r3.chunks);

  const hit = kb.search('how do I calculate position size from my stop distance', { k: 3 })[0];
  ok('search finds the risk document', hit && /Risk and sizing notes/.test(hit.source.title), hit && hit.source.title);
  const hit2 = kb.search('what makes a breakout fail and how do I trade the retest', { k: 3 })[0];
  ok('search finds the breakout document', hit2 && /Breakouts/.test(hit2.source.title), hit2 && hit2.source.title);
  const hit3 = kb.search('does a wick through a swing low break the trend', { k: 3 })[0];
  ok('search finds the structure document', hit3 && /structure/.test(hit3.source.title), hit3 && hit3.source.title);
  ok('results carry a snippet', !!(hit && hit.snippet && hit.snippet.length > 20));
  ok('results carry a score', hit && hit.score > 0.3, hit && String(hit.score));

  const ctx = kb.context('stop distance position size one percent', { k: 3 });
  ok('context block is built', ctx.block.length > 200 && ctx.hits.length >= 1);
  ok('context block is numbered for citation', /\[1\]/.test(ctx.block));
  ok('context respects the char budget', ctx.chars <= 5200);

  // Re-ingesting the same URL replaces instead of duplicating.
  const r1b = kb.addSource({ kind: 'article', url: 'https://example.com/structure', title: 'Reading market structure (v2)', text: DOC_STRUCTURE + 'Extra note about wicks.' });
  ok('re-ingest reports replacement', r1b.ok && r1b.replaced === true);
  eq('source count unchanged after re-ingest', kb.db.sources.length, 3);
  ok('newest source is first', kb.db.sources[0].title.includes('v2'));

  ok('rejects near-empty text', kb.addSource({ kind: 'text', title: 'x', text: 'hi' }).ok === false);

  // Persistence roundtrip.
  kb.save();
  ok('knowledge file written', fs.existsSync(kbFile) && fs.statSync(kbFile).size > 500);
  const kb2 = new KnowledgeBase(kbFile);
  eq('reloaded source count', kb2.db.sources.length, 3);
  eq('reloaded chunk count', kb2.db.chunks.length, kb.db.chunks.length);
  const reloadedHit = kb2.search('position size stop distance', { k: 1 })[0];
  ok('search still works after reload', reloadedHit && /Risk and sizing/.test(reloadedHit.source.title));

  // Cards + journal + skills.
  const card = kb.upsertCard({ title: 'Breakout retest', setup: 'Close beyond a level then retest', entry: 'On the retest hold', invalidation: 'Close back inside', target: 'Range height', risk: '1% per trade', checklist: ['Level touched 2+ times?', 'Volume expanded?'] });
  ok('card stored', kb.listCards().length === 1 && kb.listCards()[0].id === card.id);
  ok('card context includes the playbook', kb.cardContext(3).includes('Breakout retest'));
  const je = kb.addJournal({ kind: 'rule-break', text: 'Moved my stop wider instead of exiting', tags: ['risk management'] });
  ok('journal entry stored', kb.listJournal(10)[0].id === je.id);
  kb.db.skills = CUR.markAnswer(kb.db.skills || {}, 'risk management', false);
  kb.db.skills = CUR.markAnswer(kb.db.skills, 'risk management', true);
  eq('skill answer counters', kb.db.skills['risk management'].correct + kb.db.skills['risk management'].wrong, 2);
  kb.removeSource(kb.db.sources.find((s) => s.title.includes('Breakouts')).id);
  eq('removeSource drops its chunks', kb.db.chunks.filter((c) => c.text.includes('FAKEOUTS')).length, 0);
  const stats = kb.stats();
  ok('stats report coverage gaps', Array.isArray(stats.coverageGaps) && stats.coverageGaps.length > 0);
  ok('stats count words', stats.words > 300);
  // The UI reads stats.tags as {tag, n}; kind markers are not topics.
  ok('stats.tags use the {tag,n} shape', Array.isArray(stats.tags) && stats.tags.length > 0 &&
    stats.tags.every((t) => typeof t.tag === 'string' && typeof t.n === 'number' && t.n >= 1), JSON.stringify(stats.tags));
  ok('stats.tags exclude kind markers', !stats.tags.some((t) => ['pasted', 'video', 'file', 'article'].indexOf(t.tag) >= 0));
  // One stray word must not tag a whole document as a topic.
  const noisy = TCEngine.embed.topicTags('We closed the margin account and reduced leverage before the weekend.');
  ok('a stray word does not tag a document', !noisy.some((t) => t.tag === 'options & derivatives'), JSON.stringify(noisy.map((t) => t.tag)));
  const clean = TCEngine.embed.topicTags('Risk management: risk one percent per trade, place the stop loss, and size the position from the stop distance.');
  ok('repeated topic words do tag a document', clean.some((t) => t.tag === 'risk management'), JSON.stringify(clean.map((t) => t.tag)));
  ok('export keeps source text for re-import', kb.exportAll().sources.every((s) => typeof s.text === 'string'));

  /* ═════════════════════════════ text extraction ═════════════════════════════ */

  section('text.js');
  const html = '<html><head><title>How to Trade Breakouts | SomeSite</title>' +
    '<meta name="description" content="A guide to breakout trading.">' +
    '<meta name="author" content="Jane Trader">' +
    '<script>var x = "this must not appear in the text";</script>' +
    '<style>.a{color:red}</style></head><body>' +
    '<nav>Home About Contact</nav>' +
    '<article><h1>Breakout basics</h1><p>A breakout needs a <b>real level</b> &amp; a close beyond it.</p>' +
    '<ul><li>Wait for the retest</li><li>Check volume</li></ul>' +
    '<p>Price &gt; resistance means buyers won&nbsp;the day.</p></article>' +
    '<footer>Copyright 2026</footer></body></html>';
  const parsed = text.htmlToText(html);
  ok('title extracted', /Breakout/.test(parsed.title), parsed.title);
  ok('author extracted', parsed.byline === 'Jane Trader', parsed.byline);
  ok('script content removed', !parsed.text.includes('must not appear'));
  ok('style content removed', !parsed.text.includes('color:red'));
  ok('entities decoded', parsed.text.includes('&') && parsed.text.includes('>'), parsed.text.slice(0, 200));
  ok('nbsp removed', !parsed.text.includes('\u00a0'));
  ok('list items become bullets', parsed.text.includes('• Wait for the retest'));
  ok('heading markers survive', parsed.text.includes('# Breakout basics') || parsed.text.includes('Breakout basics'));
  ok('article body preferred over nav/footer', parsed.text.includes('real level') && !parsed.text.includes('Copyright 2026'));

  // A minimal but real PDF: uncompressed content stream with Tj operators.
  const pdfBody = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/Contents 4 0 R>>endobj\n' +
    '4 0 obj<</Length 120>>stream\nBT /F1 12 Tf 40 700 Td (Trading rules: risk one percent per trade.) Tj ET\nBT /F1 12 Tf 40 680 Td (Always define your stop before entry.) Tj ET\nendstream\nendobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n';
  const pdfRes = text.pdfToText(Buffer.from(pdfBody, 'latin1'));
  ok('pdf text extracted', /risk one percent/.test(pdfRes.text) && /define your stop/.test(pdfRes.text), pdfRes.error || pdfRes.text.slice(0, 80));

  // FlateDecode stream (the common case in real PDFs).
  const content = 'BT /F1 12 Tf 40 700 Td (Compressed stream support works.) Tj ET';
  const flate = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const pdf2 = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n2 0 obj<</Filter/FlateDecode/Length ' + flate.length + '>>stream\n', 'latin1'),
    flate,
    Buffer.from('\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'latin1')
  ]);
  ok('flate-compressed pdf stream decoded', /Compressed stream support works/.test(text.pdfToText(pdf2).text));
  ok('non-pdf buffer is rejected cleanly', /does not look like a PDF/.test(text.pdfToText(Buffer.from('hello')).error || ''));

  eq('subtitle timestamps stripped', ingest.subtitleToText('1\n00:00:01,000 --> 00:00:04,000\nWelcome back\n\n2\n00:00:04,000 --> 00:00:06,000\n[Music]\ntoday we talk risk'), 'Welcome back\ntoday we talk risk');
  ok('normalise collapses whitespace', text.normalise('a    b\n\n\n\nc') === 'a b\n\nc');
  ok('wordCount counts words', text.wordCount('one two three') === 3);

  /* ═════════════════════════════ youtube ═════════════════════════════ */

  section('youtube.js');
  eq('watch url', yt.parseId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  eq('short url', yt.parseId('https://youtu.be/dQw4w9WgXcQ?t=42'), 'dQw4w9WgXcQ');
  eq('embed url', yt.parseId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  eq('shorts url', yt.parseId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  eq('bare id', yt.parseId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  eq('non-youtube', yt.parseId('https://example.com/video/123'), null);
  ok('isYouTube detects domains', yt.isYouTube('http://youtube.com/watch?v=abc') && !yt.isYouTube('https://vimeo.com/1'));
  const xmlCap = '<?xml version="1.0"?><transcript><text start="0" dur="1">Risk one percent</text><text start="1" dur="1">[Music]</text><text start="2" dur="1">of every trade</text></transcript>';
  const capText = yt.xmlCaptionsToText(xmlCap);
  ok('xml captions parsed', /Risk one percent/.test(capText) && /of every trade/.test(capText), capText);
  ok('music markers dropped', !capText.includes('[Music]'));
  ok('paragraphise removes duplicate consecutive lines', !yt.paragraphise(['hello', 'hello', 'world']).includes('hello hello'));

  // Realistic watch-page fixture: exercises the same parsing paths the live
  // scraper uses, without needing network access.
  const playerJson = {
    videoDetails: {
      videoId: 'abc12345678',
      title: 'Price Action Trading for Beginners',
      shortDescription: 'Learn support and resistance the simple way.\n0:00 Intro\n2:10 Support and resistance',
      lengthSeconds: '754',
      viewCount: '123456',
      author: 'Chart School'
    },
    microformat: { playerMicroformatRenderer: { publishDate: '2025-04-01', title: { simpleText: 'Price Action Trading for Beginners' } } },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc12345678&lang=en&kind=asr', vssId: 'a.en', languageCode: 'en', kind: 'asr', name: { simpleText: 'English (auto-generated)' } },
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc12345678&lang=en', vssId: '.en', languageCode: 'en', name: { simpleText: 'English' } },
          { baseUrl: 'https://www.youtube.com/api/timedtext?v=abc12345678&lang=es', vssId: '.es', languageCode: 'es', name: { simpleText: 'Spanish' } }
        ]
      }
    }
  };
  const dataJson = {
    contents: {
      macroMarkersListRenderer: {
        contents: [
          { macroMarkersListItemRenderer: { title: { simpleText: '00:00 Intro' } } },
          { macroMarkersListItemRenderer: { title: { runs: [{ text: '02:10 Support and ' }, { text: 'resistance' }] } } }
        ]
      }
    }
  };
  const watchHtml = '<html><body><script>var ytInitialPlayerResponse = ' + JSON.stringify(playerJson) +
    ';var meta = document.createElement("meta");</script>' +
    '<script>var ytInitialData = ' + JSON.stringify(dataJson) + ';</script></body></html>';

  const parsedPage = yt.parseWatchPage(watchHtml);
  ok('watch page: player object found', !!parsedPage.player && parsedPage.player.videoDetails.videoId === 'abc12345678');
  ok('watch page: data object found', !!parsedPage.data && !!parsedPage.data.contents);
  ok('watch page: survives a different statement after the object', !!yt.parseWatchPage('var ytInitialPlayerResponse = ' + JSON.stringify(playerJson) + ';\n  (function(){}());').player);
  ok('watch page: missing vars return null safely', yt.parseWatchPage('<html>nothing here</html>').player === null);

  const meta = yt.metaFromPlayer(parsedPage.player);
  eq('metadata: title', meta.title, 'Price Action Trading for Beginners');
  eq('metadata: channel', meta.channel, 'Chart School');
  eq('metadata: duration seconds', meta.seconds, 754);
  ok('metadata: publish date', meta.published === '2025-04-01');
  ok('metadata: description kept', /support and resistance/i.test(meta.description));

  const tracks = yt.captionTracks(parsedPage.player);
  eq('caption tracks discovered', tracks.length, 3);
  eq('preferred track is human English, not auto-generated', yt.pickTrack(tracks, 'en').languageCode + '/' + (yt.pickTrack(tracks, 'en').kind || 'manual'), 'en/manual');
  eq('spanish preference honoured', yt.pickTrack(tracks, 'es').languageCode, 'es');
  ok('unknown language still returns a usable track', !!yt.pickTrack(tracks, 'zz'));
  eq('no tracks returns null', yt.pickTrack([], 'en'), null);

  const chapters = yt.chaptersFromData(parsedPage.data);
  eq('chapters extracted', chapters.length, 2);
  ok('chapter runs are concatenated', chapters[1] === '02:10 Support and resistance', chapters[1]);

  ok('brace scanner handles braces inside strings', yt.scanJsonObject('{"a":"}{"}  trailing', 0) === '{"a":"}{"}');
  ok('brace scanner handles escaped quotes', yt.scanJsonObject('{"a":"x\\"y"} rest', 0) === '{"a":"x\\"y"}');
  ok('brace scanner returns null when unbalanced', yt.scanJsonObject('{"a":1', 0) === null);
  ok('extractJsonVar finds a nested assignment', !!yt.extractJsonVar('window.ytInitialData = {"a":{"b":[1,2]}};', 'ytInitialData'));

  const json3 = { events: [
    { segs: [{ utf8: 'Risk ' }, { utf8: 'one percent' }] },
    { segs: [{ utf8: '\n' }] },
    { segs: [{ utf8: 'of every trade' }] },
    { segs: [{ utf8: '[Music]' }] }
  ] };
  const j3 = yt.json3ToText(json3);
  ok('json3 captions assembled', /Risk one percent/.test(j3) && /of every trade/.test(j3), j3);
  ok('json3 drops music markers', !j3.includes('[Music]'));

  const badTrack = await yt.fetchTrack({ baseUrl: 'https://invalid.host.localdomain/timedtext?v=x' });
  ok('unreachable caption track fails cleanly', badTrack.ok === false && !!badTrack.error);


  /* ═════════════════════════════ ingestion ═════════════════════════════ */

  section('ingest.js');
  eq('youtube kind', ingest.guessKind('https://www.youtube.com/watch?v=abc12345678'), 'video');
  eq('article kind', ingest.guessKind('https://www.babypips.com/learn/forex/support-resistance'), 'article');
  eq('vimeo kind', ingest.guessKind('https://vimeo.com/12345'), 'video-other');
  eq('mp3 kind', ingest.guessKind('https://x.com/podcast.mp3'), 'audio');
  const it = ingest.ingestText('Risk one percent per trade. The stop distance sets your position size, never the reverse.', 'My risk rule');
  ok('ingestText ok', it.ok && it.title === 'My risk rule' && it.kind === 'text');
  ok('ingestText rejects short input', ingest.ingestText('hi').ok === false);
  const im = ingest.ingestFile({ name: 'notes.md', text: '# My strategy\n\nBuy the retest of broken resistance with a stop below the low.' });
  ok('ingestFile reads markdown', im.ok && /retest/.test(im.text));
  ok('ingestFile rejects docx', /can read/.test(ingest.ingestFile({ name: 'a.docx', buffer: Buffer.from('x') }).error || ''));
  const ivtt = ingest.ingestFile({ name: 'captions.vtt', text: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nWelcome to the lesson\n\n00:00:03.000 --> 00:00:05.000\nToday we cover risk' });
  ok('vtt timestamps stripped', ivtt.ok && !ivtt.text.includes('-->'), ivtt.text && ivtt.text.slice(0, 60));
  const badUrl = await ingest.ingestUrl('not-a-url');
  ok('bad url rejected', badUrl.ok === false && /web address/i.test(badUrl.error));
  const badVid = await ingest.ingestUrl('https://vimeo.com/12345');
  ok('non-youtube video gives a helpful message', badVid.ok === false && /paste/i.test(badVid.error), badVid.error);

  /* ═════════════════════════════ offline vision ═════════════════════════════ */

  section('vision.js (offline pixel reader)');
  const COLS = 64, ROWS = 40;

  /** Build a signature from a synthetic candle path (row index per column). */
  function makeSig(pathFn, opts) {
    const o = opts || {};
    const g = new Uint8Array(COLS * ROWS), r = new Uint8Array(COLS * ROWS), b = new Uint8Array(COLS * ROWS);
    for (let x = 0; x < COLS; x++) {
      const y = Math.max(1, Math.min(ROWS - 2, Math.round(pathFn(x))));
      const bodyTop = Math.max(0, y - (o.body || 1));
      const bodyBot = Math.min(ROWS - 1, y + (o.body || 1));
      // `fading` makes the left half mixed and the right half one-sided, the way a
      // real momentum shift looks, so the momentum measure has something to find.
      const isRed = o.up === false
        ? !(o.fading && x >= COLS / 2 && x % 3 === 0)
        : !!(o.fading && x < COLS / 2 && x % 3 === 0);
      for (let yy = bodyTop; yy <= bodyBot; yy++) {
        const i = yy * COLS + x;
        if (isRed) r[i] = 200; else g[i] = 200;
      }
      for (let yy = Math.max(0, y - 3); yy <= Math.min(ROWS - 1, y + 3); yy++) {
        const i = yy * COLS + x;
        if (!g[i] && !r[i]) b[i] = 120;
      }
    }
    const enc = (u) => Buffer.from(u).toString('base64');
    return { cols: COLS, rows: ROWS, g: enc(g), r: enc(r), b: enc(b) };
  }

  const upSig = makeSig((x) => ROWS * 0.85 - (x / COLS) * ROWS * 0.6, { fading: true });
  const downSig = makeSig((x) => ROWS * 0.2 + (x / COLS) * ROWS * 0.6, { up: false, fading: true });
  const flatSig = makeSig(() => ROWS * 0.5, { body: 0 });

  const upRead = vision.localRead(upSig);
  const downRead = vision.localRead(downSig);
  const flatRead = vision.localRead(flatSig);

  ok('uptrend detected', upRead.looksLikeChart && upRead.trend === 'up', JSON.stringify({ c: upRead.looksLikeChart, t: upRead.trend, m: upRead.measures && upRead.measures.slope }));
  ok('downtrend detected', downRead.looksLikeChart && downRead.trend === 'down', downRead.trend);
  ok('flat market detected', flatRead.looksLikeChart && (flatRead.trend === 'flat' || flatRead.volatility === 'low'), flatRead.trend + '/' + flatRead.volatility);
  ok('uptrend reports buyer momentum', upRead.momentum === 'buyers', upRead.momentum);
  ok('read has observations', upRead.observations.length >= 3);
  ok('read has measures for the prompt', upRead.measures.rangeRatio > 0.1);
  ok('confidence within 0..1', upRead.confidence > 0 && upRead.confidence <= 1);

  const blank = vision.localRead({ cols: COLS, rows: ROWS, g: '', r: '', b: '' });
  ok('blank frame is not a chart', blank.looksLikeChart === false && blank.regime === 'not-a-chart');
  ok('blank frame explains itself', blank.observations.length > 0);
  ok('null signature handled', vision.localRead(null).looksLikeChart === false);

  const brightOnly = (function () {
    const b = new Uint8Array(COLS * ROWS).fill(250);
    return { cols: COLS, rows: ROWS, g: '', r: '', b: Buffer.from(b).toString('base64') };
  })();
  ok('white document page detected as not-a-chart', vision.localRead(brightOnly).looksLikeChart === false);

  ok('describeLocal is a readable hint block', /trend=up/.test(vision.describeLocal(upRead)), vision.describeLocal(upRead).slice(0, 60));
  ok('sceneKey differs between up and down', vision.sceneKey(upRead) !== vision.sceneKey(downRead));
  eq('sceneKey is stable for the same read', vision.sceneKey(upRead), vision.sceneKey(upRead));

  section('vision.js (AI reply parsing)');
  const cleanJson = '{"screen":"chart","symbol":"BTCUSD","timeframe":"15m","trend":"up","structure":"above the last higher low",' +
    '"patterns":["bull flag"],"levels":{"support":["64200"],"resistance":["65800"]},"indicators":["RSI 62"],' +
    '"momentum":"buyers","riskFlags":["chasing an extended move"],"see":["Higher highs","Shallow pullback","Volume drying up"],' +
    '"action":"Wait for the pullback to finish","teach":"A trend needs a pullback to give you a logical stop.",' +
    '"lessonTag":"trend trading","confidence":0.8}';
  const p1 = vision.parseChartRead(cleanJson);
  ok('clean JSON parses', p1.ok && p1.symbol === 'BTCUSD' && p1.trend === 'up');
  ok('lists parsed', p1.patterns[0] === 'bull flag' && p1.see.length === 3 && p1.riskFlags.length === 1);
  ok('levels parsed', p1.levels.support[0] === '64200' && p1.levels.resistance[0] === '65800');
  ok('confidence clamped', p1.confidence === 0.8);
  ok('lessonTag validated', p1.lessonTag === 'trend trading');

  const p2 = vision.parseChartRead('Sure! Here you go:\n```json\n' + cleanJson.replace('"confidence":0.8', '"confidence":140,') + '\n```\nHope that helps!');
  ok('fenced + prose-wrapped JSON parses', p2.ok && p2.symbol === 'BTCUSD');
  ok('confidence >1 is rescaled', p2.confidence === 1);
  const p3 = vision.parseChartRead('{"screen":"chart","trend":"sideways","momentum":"unknown","confidence":"0.4"}');
  ok('invalid enum falls back safely', p3.ok && p3.trend === 'unknown');
  ok('garbage reply fails cleanly', vision.parseChartRead('I cannot help with that').ok === false);
  const p4 = vision.parseChartRead('{"screen":"chart","levels":{"support":"64200, 63800"},"see":"one thing;two things","confidence":null}');
  ok('string-encoded lists are accepted', p4.ok && p4.levels.support.length === 2 && p4.see.length === 2);
  eq('null confidence defaults', p4.confidence, 0.5);

  /* ═════════════════════════════ curriculum ═════════════════════════════ */

  section('curriculum.js');
  ok('library has a full curriculum', CUR.LIBRARY.length >= 18, String(CUR.LIBRARY.length));
  ok('every module has required fields', CUR.LIBRARY.every((m) =>
    m.id && m.name && m.summary && Array.isArray(m.rules) && m.rules.length >= 4 &&
    m.entry && m.invalidation && m.target && m.risk && m.drill &&
    Array.isArray(m.screenHooks) && Array.isArray(m.mistakes) && Array.isArray(m.tags) && m.tags.length));
  ok('module ids are unique', new Set(CUR.LIBRARY.map((m) => m.id)).size === CUR.LIBRARY.length);
  ok('every module has 2+ valid quiz questions', CUR.LIBRARY.every((m) =>
    (m.quiz || []).length >= 2 && m.quiz.every((q) => q.q && Array.isArray(q.options) && q.options.length === 4 &&
      q.options.every((o) => typeof o === 'string' && o.trim().length > 0) &&
      Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3 && q.why)));
  ok('levels are 1..4', CUR.LIBRARY.every((m) => m.level >= 1 && m.level <= 4));
  ok('tags come from the known skill list', CUR.LIBRARY.every((m) => m.tags.every((t) => CUR.SKILL_TAGS.includes(t))));
  ok('risk management is covered', CUR.LIBRARY.some((m) => m.tags.includes('risk management')));

  const plan = CUR.planFor({ skills: {}, kbTags: [], doneModules: [] });
  eq('plan covers the whole library', plan.length, CUR.LIBRARY.length);
  ok('plan is sorted by priority', plan.every((p, i) => i === 0 || plan[i - 1].priority >= p.priority));
  ok('plan items explain themselves', plan.every((p) => typeof p.reason === 'string' && p.reason.length > 3));
  ok('level 1 modules come first for a beginner', plan.slice(0, 6).every((p) => p.module.level <= 2),
    plan.slice(0, 6).map((p) => p.module.level).join(','));

  const weakSkills = { 'risk management': { exposure: 8, correct: 1, wrong: 7, taught: 4, lastTaught: 0, lastWrong: 0 } };
  const plan2 = CUR.planFor({ skills: weakSkills, kbTags: [], doneModules: [] });
  const riskRank = plan2.findIndex((p) => p.module.id === 'risk-1-percent');
  const riskRankBefore = plan.findIndex((p) => p.module.id === 'risk-1-percent');
  ok('weak topics are promoted in the plan', riskRank < riskRankBefore || riskRank <= 1, 'now ' + riskRank + ', was ' + riskRankBefore);
  ok('mastery rises with correct answers', CUR.mastery({ exposure: 12, correct: 10, wrong: 2 }) > CUR.mastery({ exposure: 12, correct: 2, wrong: 10 }));
  eq('mastery of nothing is 0', CUR.mastery(null), 0);
  ok('weaknessScore flags a bad record', CUR.weaknessScore(weakSkills['risk management']) > 0.5);
  const q = CUR.quizQuestion(['risk management']);
  ok('quizQuestion returns a tagged question', q && q.tag === 'risk management' && q.options.length === 4);
  ok('microLesson returns a rule', !!CUR.microLesson('trend trading').rule);
  const lesson = CUR.moduleToLesson(CUR.byId('risk-1-percent'));
  ok('moduleToLesson produces a publishable id', /^[a-z0-9_-]{2,40}$/.test(lesson.id), lesson.id);
  ok('moduleToLesson respects field limits', lesson.title.length <= 80 && lesson.easy.length <= 200 && lesson.tip.length <= 300);
  ok('moduleToLesson has 3+ questions with 4 options', lesson.questions.length >= 3 && lesson.questions.every((x) => x.options.length === 4));

  /* ═════════════════════════════ distillation ═════════════════════════════ */

  section('distill.js');
  const bigText = Array.from({ length: 60 }, (_, i) =>
    (i % 3 === 0
      ? 'Entry rule ' + i + ': wait for the retest of the broken level, then enter on the first close back in the trend direction with a stop beyond the swing low. '
      : 'Filler paragraph ' + i + ': the host welcomes you back to the channel, asks you to subscribe, mentions the sponsor of the week and reads a few comments. ')
  ).join('\n\n');
  const ex = distill.excerpt(bigText, 4000);
  ok('excerpt respects the budget', ex.length <= 4400, String(ex.length));
  ok('excerpt prefers trading-dense paragraphs', (ex.match(/retest/g) || []).length > (ex.match(/sponsor/g) || []).length);
  ok('short text is returned whole', distill.excerpt('short text', 4000) === 'short text');

  const distillJson = '{"title":"Breakout retesting","author":"Jane","summary":"How to trade breakouts safely.",' +
    '"takeaways":["Wait for the retest.","Volume must expand."],' +
    '"terms":[{"term":"retest","meaning":"when price returns to a level it just broke"}],' +
    '"cards":[{"title":"Retest entry","tags":["breakouts","risk management"],"level":2,' +
    '"setup":"A level breaks with volume and price returns to it.","entry":"First close back in the breakout direction.",' +
    '"invalidation":"A close back inside the old range.","target":"Range height projected.","risk":"1% with the stop inside the range.",' +
    '"checklist":["Did volume expand?","Is this the first retest?"],"mistakes":["Chasing the first candle."],' +
    '"markets":["any"],"quote":"Never chase the break."}],"warnings":["The host sells a course at the end."],"quality":0.8}';
  const d1 = distill.parseDistill(distillJson);
  ok('distill parses', d1.ok && d1.cards.length === 1);
  ok('card fields preserved', d1.cards[0].entry.includes('First close') && d1.cards[0].checklist.length === 2);
  ok('tags validated against the known list', d1.cards[0].tags.every((t) => distill.VALID_TAGS.includes(t)));
  ok('terms parsed', d1.terms[0].term === 'retest');
  ok('warnings parsed', d1.warnings.length === 1);
  const d2 = distill.parseDistill('Here is the JSON you wanted:\n```json\n' + distillJson + '\n```');
  ok('fenced distill JSON parses', d2.ok && d2.cards.length === 1);
  const d3 = distill.parseDistill(distillJson.replace('"quality":0.8}', '"quality":0.8,}'));
  ok('trailing commas tolerated', d3.ok);
  ok('garbage distill reply fails cleanly', distill.parseDistill('no json here').ok === false);
  const prompt = distill.buildDistillPrompt({ kind: 'video', title: 'My video', url: 'https://youtu.be/x', text: bigText, meta: { chapters: ['Intro', 'The setup'], durationSeconds: 900 } }, { chars: 3000 });
  ok('distill prompt carries metadata', /My video/.test(prompt) && /CHAPTERS/i.test(prompt) && /15 minutes/.test(prompt));
  ok('distill prompt carries content', prompt.length > 3000);

  const quizJson = '{"questions":[{"q":"Where does the stop go?","options":["Beyond the swing low","Anywhere","Above entry","No stop"],"answer":0,"why":"That is where the idea is wrong."},' +
    '{"q":"Bad question","options":["only three"],"answer":9,"why":"x"}]}';
  const qz = distill.parseQuiz(quizJson);
  ok('parseQuiz keeps only valid questions', qz.ok && qz.questions.length === 1 && qz.questions[0].answer === 0);
  ok('parseQuiz rejects total garbage', distill.parseQuiz('nope').ok === false);

  const fedLesson = distill.cardToLesson(d1.cards[0], { title: 'Breakout retesting', url: 'https://youtu.be/x' }, 'ab12cd34');
  ok('cardToLesson id is valid for the lessons API', /^fed_[a-z0-9_-]{2,40}$/.test(fedLesson.id), fedLesson.id);
  ok('cardToLesson title within 80 chars', fedLesson.title.length <= 80, String(fedLesson.title.length));
  ok('cardToLesson easy within 200 chars', fedLesson.easy.length <= 200, String(fedLesson.easy.length));
  ok('cardToLesson tip within 300 chars', fedLesson.tip.length <= 300, String(fedLesson.tip.length));
  ok('cardToLesson has 3+ questions each with 4 options', fedLesson.questions.length >= 3 && fedLesson.questions.every((x) => x.options.length === 4 && x.answer >= 0 && x.answer <= 3));
  ok('cardToLesson sections within the 12 limit', fedLesson.sections.length <= 12 && fedLesson.sections.length >= 3);
  const cardNoQuestions = distill.cardToLesson({ title: 'Bare card', setup: 's', entry: 'e', invalidation: 'i', target: 't', risk: 'r' }, null, 'zz99');
  ok('card without questions still gets 3 valid defaults', cardNoQuestions.questions.length === 3);

  /* ═════════════════════════════ coach ═════════════════════════════ */

  section('coach.js (offline / no API key)');
  const kb3 = new KnowledgeBase(null);
  kb3.addSource({ kind: 'text', title: 'My risk rules', text: DOC_RISK });
  kb3.upsertCard({ title: 'Retest entry', setup: 'Break + retest', entry: 'Close back out', invalidation: 'Back inside', target: 'Range height', risk: 'Risk 1% only' });
  const coach = new coachMod.Coach({ kb: kb3, ai: null, settings: { sensitivity: 'chatty', riskPercent: 1 } });

  const pack = coachMod.packContext(kb3, { query: 'stop distance position size' });
  ok('packContext returns grounded quotes', pack.kbContext.hits.length > 0 && pack.kbContext.block.length > 100);
  ok('packContext includes the playbook', pack.playbook.includes('Retest entry'));
  ok('packContext includes stats', pack.stats && pack.stats.sources === 1);

  const offCard = coach._cardOffline(upRead, '', pack);
  ok('offline card produced with no AI', !!offCard && offCard.offline === true);
  ok('offline card has all teaching sections', !!(offCard.see.length && offCard.rule && offCard.action && offCard.risk && offCard.learn));
  ok('offline card cites the trader library', offCard.citations.length >= 1, JSON.stringify(offCard.citations.length));
  ok('offline card carries a lesson tag', !!offCard.lessonTag);
  ok('offline card links to a module', !!offCard.moduleId && !!CUR.byId(offCard.moduleId));
  ok('risk line mentions the configured risk', /1%/.test(offCard.risk), offCard.risk);

  const coach2 = new coachMod.Coach({ kb: kb3, ai: null, settings: { riskPercent: 0.5 } });
  ok('risk percent setting is honoured', /0\.5%/.test(coach2._cardOffline(upRead, '', pack).risk));
  const hvCard = coach._cardOffline(vision.localRead(makeSig((x) => ROWS * 0.8 - (x / COLS) * ROWS * 0.55, { body: 9, fading: true })), '', pack);
  ok('high volatility triggers a sizing warning', /size/i.test(hvCard.risk) || /volatility/i.test(hvCard.risk), hvCard.risk);

  const qCard = coach._cardOffline(null, 'Where do I put my stop on a breakout retest?', pack);
  ok('question without a frame still produces a card', !!qCard && qCard.title.includes('Your question'));
  ok('question card answers from the library', qCard.learn.length > 30);

  section('coach.js (rate limiting + skills)');
  const rl = new coachMod.Coach({ kb: kb3, ai: null, settings: { sensitivity: 'normal' } });
  const c1 = rl._cardOffline(upRead, '', pack); c1.read = { local: upRead, ai: null };
  ok('first card always speaks', rl.shouldSpeak(c1) === true);
  const c2 = rl._cardOffline(upRead, '', pack); c2.read = { local: upRead, ai: null };
  rl._commit(c1);
  ok('identical scene is suppressed immediately after', rl.shouldSpeak(c2) === false);
  rl.lastChangeAt = Date.now() - 120000;
  ok('same scene speaks again after the cooldown', rl.shouldSpeak(c2) === true);
  const c3 = rl._cardOffline(downRead, '', pack); c3.read = { local: downRead, ai: null };
  ok('a changed scene always speaks', rl.shouldSpeak(c3) === true);
  const calm = new coachMod.Coach({ kb: kb3, ai: null, settings: { sensitivity: 'calm' } });
  calm._commit(c1);
  calm.lastChangeAt = Date.now() - 300000;
  ok('calm mode stays quiet when there is no risk flag', calm.shouldSpeak(c2) === false);

  // No kb attached: this is how the renderer drives the coach, so skills live on the instance.
  const sk = new coachMod.Coach({ ai: null });
  sk.answer({ tag: 'risk management', answer: 1 }, 1);
  sk.answer({ tag: 'risk management', answer: 1 }, 0);
  eq('coach records correct answers', sk.skills['risk management'].correct, 1);
  eq('coach records wrong answers', sk.skills['risk management'].wrong, 1);
  const quizQ = sk.quiz(['risk management']);
  ok('coach quiz picks from the weak topic', quizQ && quizQ.tag === 'risk management');
  ok('coach plan works without a kb', Array.isArray(sk.plan(3, [], [])) );
  const taught = new coachMod.Coach({ kb: kb3, ai: null });
  taught._commit(offCard);
  ok('committing a card marks the topic taught', (kb3.db.skills[offCard.lessonTag] || {}).taught >= 1);
  ok('coach keeps a bounded history', taught.history.length === 1);

  section('coach.js (AI card parsing + prompt)');
  const coachJson = '{"title":"Extended at the range top","screen":"chart","symbol":"ETHUSD","timeframe":"5m",' +
    '"see":["Price is at the top of the visible range","Candles are getting smaller","No stop visible on the ticket"],' +
    '"rule":"Do not chase an extended move; wait for the pullback [1].",' +
    '"action":"Mark the range high and wait for a close back below it.","risk":"Risk 1% and define the stop before entry.",' +
    '"learn":"Chasing the top of a range gives you the worst risk:reward of the session.",' +
    '"askThem":"Where would your stop go here?","citations":[1],"lessonTag":"psychology","confidence":0.72}';
  const hits = pack.kbContext.hits;
  const aiCard = coachMod.parseCoachCard(coachJson, hits);
  ok('AI card parses', !!aiCard && aiCard.title.includes('Extended'));
  ok('AI card keeps the citation mapping', aiCard.citations.length === (hits.length ? 1 : 0));
  ok('out-of-range citation numbers are dropped', coachMod.parseCoachCard(coachJson.replace('"citations":[1]', '"citations":[99]'), hits).citations.length === 0);
  ok('empty AI card is rejected', coachMod.parseCoachCard('{"title":"x"}', hits) === null);
  ok('prose-wrapped AI card still parses', !!coachMod.parseCoachCard('Sure:\n```json\n' + coachJson + '\n```', hits));
  const coachPrompt = coachMod.buildCoachUserPrompt({
    local: upRead, question: 'is this a good entry?', playbook: 'PLAYBOOK X', kbContext: '[1] quote',
    skills: 'risk management: mastery 20%', journal: '[09-13 10:00] rule-break: moved stop', previous: 'title: old',
    settings: { language: 'English' }
  });
  ok('prompt includes the offline pre-read', /OFFLINE PIXEL PRE-READ/.test(coachPrompt) && /trend=up/.test(coachPrompt));
  ok('prompt includes library quotes', coachPrompt.includes('[1] quote'));
  ok('prompt includes playbook + journal + previous', coachPrompt.includes('PLAYBOOK X') && coachPrompt.includes('moved stop') && coachPrompt.includes('title: old'));
  ok('prompt asks for JSON', /JSON/i.test(coachPrompt));
  ok('non-chart frame tells the model to identify the screen', /does not look like a candlestick chart/.test(
    coachMod.buildCoachUserPrompt({ local: blank })));
  ok('skillsSummary describes a beginner', /Brand new trader/.test(coachMod.skillsSummary({})));
  ok('skillsSummary lists weakest topics', /Weakest right now/.test(coachMod.skillsSummary({ 'risk management': { exposure: 5, correct: 1, wrong: 4 } })));
  ok('journalText formats entries', /rule-break/.test(coachMod.journalText([{ ts: Date.now(), kind: 'rule-break', text: 'moved my stop' }])));

  /* ═════════════════════════════ core + HTTP adapter ═════════════════════════════ */

  section('companion-core.js');
  const { createCore, DEFAULT_SETTINGS } = require('./companion-core');
  const { isLocalAddr, ssrfCheck } = require('./server-companion');
  const coreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-core-'));
  let published = null;
  const core = createCore({
    dataDir: coreDir,
    publishLessons: (lessons) => { published = lessons; return { ok: true, count: lessons.length }; }
  });

  ok('isLocalAddr accepts loopback', isLocalAddr('127.0.0.1') && isLocalAddr('::1') && isLocalAddr('::ffff:127.0.0.1'));
  ok('isLocalAddr accepts private ranges', isLocalAddr('192.168.1.5') && isLocalAddr('10.0.0.9') && isLocalAddr('172.16.4.4') && isLocalAddr('169.254.9.9'));
  ok('isLocalAddr rejects public IPs', !isLocalAddr('8.8.8.8') && !isLocalAddr('172.32.0.1') && !isLocalAddr(''));
  ok('ssrf lets a local caller fetch anything', (await ssrfCheck('http://localhost:8081/x', true)).ok === true);
  ok('ssrf blocks a remote caller from localhost', (await ssrfCheck('http://localhost:8081/x', false)).ok === false);
  ok('ssrf blocks a remote caller from a private IP', (await ssrfCheck('http://192.168.1.1/admin', false)).ok === false);
  ok('ssrf blocks a remote caller from cloud metadata', (await ssrfCheck('http://169.254.169.254/latest/meta-data/', false)).ok === false);
  ok('ssrf rejects non-http schemes even for a local caller', (await ssrfCheck('javascript:alert(1)', true)).ok === false);
  ok('ssrf rejects file:// URLs', (await ssrfCheck('file:///etc/passwd', true)).ok === false);

  eq('default settings interval', DEFAULT_SETTINGS.intervalMs, 8000);
  const s1 = core.saveSettings({ intervalMs: 1, riskPercent: 99, width: 20, sensitivity: 'screaming', opacity: 500 });
  ok('settings are clamped', s1.settings.intervalMs >= 3000 && s1.settings.riskPercent <= 5 && s1.settings.width >= 320 && s1.settings.opacity <= 100);
  ok('invalid enum ignored', s1.settings.sensitivity === 'normal');
  const s2 = core.saveSettings({ demoMode: true, dock: 'left' });
  ok('boolean + enum settings accepted', s2.settings.demoMode === true && s2.settings.dock === 'left');
  ok('settings persist to disk', fs.existsSync(path.join(coreDir, 'settings.json')));
  ok('reloaded settings survive restart', createCore({ dataDir: coreDir }).settings.demoMode === true);

  const t1 = await core.ingestText(DOC_RISK, 'Risk rules from the core test');
  ok('core.ingestText works', t1.ok && t1.chunks >= 1);
  ok('core.state reports the source', core.state('test').sources.length === 1);
  ok('core.search works', core.search('stop distance size', 3).hits.length >= 1);
  ok('core.pack works', core.pack('position size').kbContext.hits.length >= 1);
  const st1 = await core.sourceText(t1.source.id);
  ok('core.sourceText returns the full text', st1.ok && st1.source.text.length > 200);
  const dis = core.saveDistill(t1.source.id, distill.parseDistill(distillJson));
  ok('core.saveDistill stores cards', dis.ok && dis.cards === 1);
  ok('distilled source is flagged', core.state().sources[0].distilled === true);
  ok('distilled terms are stored', (core.state().sources[0].terms || []).length === 1);
  const pub = core.publishLessons([fedLesson]);
  ok('core.publishLessons forwards to the hook', pub.ok && published && published.length === 1);
  const j1 = core.addJournal({ kind: 'rule-break', text: 'widened my stop', tags: ['risk management'] });
  ok('core.addJournal works', j1.ok && core.state().journal.length === 1);
  const sk1 = core.saveSkills({ 'risk management': { exposure: 3, correct: 1, wrong: 2 }, __done: ['risk-1-percent'] });
  ok('core.saveSkills sanitises', sk1.skills['risk management'].wrong === 2 && Array.isArray(sk1.skills.__done));
  const longTag = 'x'.repeat(120);
  const sk2 = core.saveSkills({ [longTag]: { exposure: 999999999, correct: -5, wrong: 'abc' }, evil: '<script>alert(1)</script>' });
  ok('unknown skill keys are truncated and clamped', !sk2.skills[longTag] && Object.keys(sk2.skills).some((k) => k.length === 60));
  ok('non-object skill values are ignored', sk2.skills.evil === undefined);
  ok('out-of-range skill counters are clamped', sk2.skills['x'.repeat(60)].exposure === 100000 && sk2.skills['x'.repeat(60)].correct === 0);
  const ex1 = core.exportData();
  ok('export includes sources with text', ex1.data.sources.length === 1 && !!ex1.data.sources[0].text);
  core.wipe();
  eq('wipe clears everything', core.state().sources.length, 0);
  const im1 = core.importData(ex1.data);
  ok('import restores sources', im1.ok && im1.sources === 1 && core.state().sources.length === 1);
  ok('import restores cards', core.state().cards.length === 1);
  ok('import rejects a non-export', core.importData({ nope: true }).ok === false);
  const f1 = await core.ingestFile({ name: 'trade-log.csv', text: 'date,symbol,result\n2026-09-01,BTCUSD,+1.2R\n2026-09-02,ETHUSD,-1R' });
  ok('core.ingestFile works', f1.ok);

  /* ═════════════════════════════ access gate ═════════════════════════════ */

  section('access gate (socket-level)');
  const { PassThrough } = require('stream');
  const { createCompanionApi } = require('./server-companion');
  const gateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-'));
  const gateApi = createCompanionApi({
    dataDir: gateDir,
    publishLessons: () => ({ ok: true, count: 0 }),
    isCreator: (session) => !!(session && session.user && session.user.username === 'yubi')
  });

  let lastHeaders = null;
  function fakeExchange(ip, method, pathname, body, headers) {
    const req = new PassThrough();
    req.method = method;
    req.headers = Object.assign({ host: 'localhost' }, headers || {});
    req.socket = { remoteAddress: ip };
    req.url = pathname;
    req._query = new URLSearchParams('');
    const res = { statusCode: 0, body: '', headers: {}, writeHead(c, h) { this.statusCode = c; this.headers = h || {}; }, end(b) { this.body = b || ''; } };
  lastHeaders = res.headers;
    if (body !== undefined) { const s = JSON.stringify(body); setImmediate(() => { req.write(s); req.end(); }); } else setImmediate(() => req.end());
    return { req, res };
  }

  async function callGate(ip, method, pathname, body, headers, session) {
    const x = fakeExchange(ip, method, pathname, body, headers);
    await gateApi.handle(x.req, x.res, pathname, session || null);
    let json = null;
    try { json = JSON.parse(x.res.body); } catch {}
    return { status: x.res.statusCode, json, headers: x.res.headers };
  }

  const gLocal = await callGate('127.0.0.1', 'GET', '/api/companion/state');
  ok('loopback caller is allowed', gLocal.status === 200 && gLocal.json.ok === true, 'status ' + gLocal.status);
  const gLan = await callGate('192.168.1.42', 'GET', '/api/companion/state');
  ok('LAN caller is allowed', gLan.status === 200, 'status ' + gLan.status);
  const gPublic = await callGate('203.0.113.7', 'GET', '/api/companion/state');
  eq('public caller is refused', gPublic.status, 403);
  const gSpoof = await callGate('203.0.113.7', 'GET', '/api/companion/state', undefined, { 'x-forwarded-for': '127.0.0.1' });
  eq('spoofed X-Forwarded-For does not grant access', gSpoof.status, 403);
  const gSpoof2 = await callGate('203.0.113.7', 'POST', '/api/companion/ingest/url',
    { url: 'http://169.254.169.254/latest/meta-data/' }, { 'x-forwarded-for': '127.0.0.1' });
  eq('spoofed header cannot trigger SSRF', gSpoof2.status, 403);
  const gCreator = await callGate('203.0.113.7', 'GET', '/api/companion/state', undefined, null, { user: { username: 'yubi' } });
  ok('signed-in creator is allowed from anywhere', gCreator.status === 200, 'status ' + gCreator.status);
  const gLanSsrf = await callGate('192.168.1.42', 'POST', '/api/companion/ingest/url', { url: 'http://169.254.169.254/latest/meta-data/' });
  eq('LAN caller cannot reach cloud metadata', gLanSsrf.status, 403);
  const gLanSsrf2 = await callGate('192.168.1.42', 'POST', '/api/companion/ingest/url', { url: 'http://localhost:8081/api/health' });
  eq('LAN caller cannot probe localhost', gLanSsrf2.status, 403);
  const gLanSsrf3 = await callGate('192.168.1.42', 'POST', '/api/companion/ingest/url', { url: 'file:///etc/passwd' });
  eq('LAN caller cannot use file://', gLanSsrf3.status, 403);

  // Phones (PWA / APK) reach the server cross-origin, authenticated by token.
  const gPreflight = await callGate('203.0.113.9', 'OPTIONS', '/api/companion/state');
  ok('CORS preflight answers 204 and allows the token header',
    gPreflight.status === 204 && /x-companion-token/i.test(JSON.stringify(gPreflight.headers)), 'status ' + gPreflight.status);
  const gToken = await callGate('203.0.113.9', 'GET', '/api/companion/state', undefined, { 'x-companion-token': 'test-token-123' });
  ok('a valid token grants access from anywhere', gToken.status === 200, 'status ' + gToken.status);
  const gBearer = await callGate('203.0.113.9', 'GET', '/api/companion/state', undefined, { authorization: 'Bearer test-token-123' });
  ok('Authorization: Bearer works too', gBearer.status === 200, 'status ' + gBearer.status);
  const gBadToken = await callGate('203.0.113.9', 'GET', '/api/companion/state', undefined, { 'x-companion-token': 'wrong' });
  eq('a wrong token is still refused', gBadToken.status, 403);

  /* ═════════════════════════════ UI integrity ═════════════════════════════ */

  section('companion UI wiring (static check)');
  const uiHtml = fs.readFileSync(path.join(__dirname, 'companion.html'), 'utf8');
  const uiJs = fs.readFileSync(path.join(__dirname, 'companion.js'), 'utf8');
  // IDs live either in companion.html or in markup the UI builds at runtime
  // (modal bodies, the size calculator), so both count as "defined".
  const htmlIds = new Set(Array.from(uiHtml.matchAll(/\sid="([^"]+)"/g)).map((m) => m[1]));
  const dynamicIds = new Set(Array.from(uiJs.matchAll(/id="([A-Za-z0-9_-]+)"/g)).map((m) => m[1]));
  const jsIds = Array.from(uiJs.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)).map((m) => m[1]);
  const missingIds = Array.from(new Set(jsIds)).filter((id) => !htmlIds.has(id) && !dynamicIds.has(id));
  ok('every $("#id") in companion.js is defined somewhere', missingIds.length === 0, 'missing: ' + missingIds.join(', '));
  ok('statically defined element ids are unique in the HTML', htmlIds.size === Array.from(uiHtml.matchAll(/\sid="([^"]+)"/g)).length);
  ok('UI references a healthy number of elements', jsIds.length > 40, String(jsIds.length));

  const scripts = Array.from(uiHtml.matchAll(/<script src="([^"]+)"/g)).map((m) => m[1]);
  ok('UI loads the pure engine modules only', scripts.filter((s) => s.startsWith('engine/')).length >= 6, scripts.join(', '));
  ok('UI never loads Node-only engine modules in the renderer',
    !scripts.some((s) => /engine\/(kb|text|net|youtube|ingest|index)\.js$/.test(s)), scripts.join(', '));
  for (const s of scripts.concat(['companion.css'])) {
    ok('referenced asset exists: ' + s, fs.existsSync(path.join(__dirname, s)));
  }
  const css = fs.readFileSync(path.join(__dirname, 'companion.css'), 'utf8');
  for (const cls of ['.card', '.stream', '.bubble', '.modal', '.panel', '.chip', '.skill-bar', '.pcard']) {
    ok('css defines ' + cls, css.includes(cls + ' ') || css.includes(cls + '{') || css.includes(cls + ',') || css.includes(cls + '.'));
  }
  ok('css supports the electron shell toggle', css.includes('body[data-shell="electron"]'));
  ok('topbar is an electron drag region', css.includes('-webkit-app-region: drag'));
  ok('UI declares all five tabs', ['coach', 'feed', 'library', 'learn', 'journal'].every((v) => uiHtml.includes('data-view="' + v + '"')));
  ok('UI has a settings view', uiHtml.includes('id="view-settings"'));
  ok('no placeholder/TODO left in the UI', !/TODO|FIXME|lorem ipsum/i.test(uiJs) && !/TODO|FIXME/i.test(uiHtml));

  /* ═════════════════════════════ end-to-end HTTP ═════════════════════════════ */

  section('server.js end-to-end (real HTTP)');
  const e2eDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-e2e-'));
  const PORT = 8099;
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), COMPANION_DATA: e2eDir, USERS_FILE: path.join(e2eDir, 'users.json'), LESSONS_FILE: path.join(e2eDir, 'lessons.json') }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d; });
  child.stderr.on('data', (d) => { serverLog += d; });

  async function waitForServer(tries) {
    for (let i = 0; i < (tries || 60); i++) {
      try {
        const r = await fetch('http://127.0.0.1:' + PORT + '/api/health');
        if (r.ok) return true;
      } catch {}
      await new Promise((r2) => setTimeout(r2, 250));
    }
    return false;
  }

  const up = await waitForServer();
  ok('server boots with the companion wired in', up, serverLog.slice(0, 400));

  if (up) {
    const B = 'http://127.0.0.1:' + PORT;
    const j = async (method, p, body) => {
      const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: await r.json().catch(() => null) };
    };

    const health = await j('GET', '/api/health');
    ok('health endpoint responds', health.status === 200 && health.json.ok === true);

    const stateRes = await j('GET', '/api/companion/state');
    ok('companion state is reachable from localhost', stateRes.status === 200 && stateRes.json.ok === true, JSON.stringify(stateRes.json).slice(0, 200));
    ok('state reports the server shell + engine version', stateRes.json.shell === 'server' && !!stateRes.json.engineVersion);
    ok('state carries default settings', stateRes.json.settings.intervalMs === 8000);

    const page = await fetch(B + '/companion');
    ok('/companion serves the UI', page.status === 200 && (await page.text()).includes('Trading Companion'));
    const engineFile = await fetch(B + '/engine/vision.js');
    ok('engine modules are served to the renderer', engineFile.status === 200 && (await engineFile.text()).includes('localRead'));
    const cssFile = await fetch(B + '/companion.css');
    ok('companion.css is served', cssFile.status === 200);
    const jsFile = await fetch(B + '/companion.js');
    ok('companion.js is served', jsFile.status === 200);

    const ing = await j('POST', '/api/companion/ingest/text', { text: DOC_BREAK, title: 'Breakouts via HTTP' });
    ok('ingest/text over HTTP', ing.status === 200 && ing.json.ok === true && ing.json.chunks >= 1, JSON.stringify(ing.json).slice(0, 200));
    const sid = ing.json.source && ing.json.source.id;

    const srch = await j('POST', '/api/companion/search', { q: 'failed breakout retest', k: 3 });
    ok('search over HTTP returns hits', srch.status === 200 && srch.json.hits.length >= 1);
    ok('search hits carry snippets + source', !!srch.json.hits[0].snippet && !!srch.json.hits[0].source.title);

    const pk = await j('POST', '/api/companion/pack', { query: 'breakout retest volume' });
    ok('pack over HTTP is grounded', pk.status === 200 && pk.json.kbContext.block.length > 100);

    const srcText = await j('GET', '/api/companion/sources/' + sid + '/text');
    ok('source text over HTTP', srcText.status === 200 && srcText.json.source.text.length > 200);
    const missing = await j('GET', '/api/companion/sources/nope/text');
    ok('missing source 404s', missing.status === 404 && missing.json.ok === false);

    const dis2 = await j('POST', '/api/companion/distill', { sourceId: sid, result: distill.parseDistill(distillJson) });
    ok('distill result stored over HTTP', dis2.status === 200 && dis2.json.cards === 1);

    const jr = await j('POST', '/api/companion/journal', { kind: 'trade', text: 'Took the retest, stopped out at -1R', outcome: '-1R' });
    ok('journal over HTTP', jr.status === 200 && jr.json.entry.kind === 'trade');
    const sks = await j('PUT', '/api/companion/skills', { skills: { 'breakouts': { exposure: 4, correct: 3, wrong: 1 } } });
    ok('skills saved over HTTP', sks.status === 200 && sks.json.skills.breakouts.correct === 3);
    const st = await j('PUT', '/api/companion/settings', { settings: { intervalMs: 20000, sensitivity: 'calm', riskPercent: 0.5 } });
    ok('settings saved over HTTP', st.status === 200 && st.json.settings.intervalMs === 20000 && st.json.settings.sensitivity === 'calm');

    const pub2 = await j('POST', '/api/companion/publish', { lessons: [fedLesson] });
    ok('publish to lessons.json over HTTP', pub2.status === 200 && pub2.json.count === 1, JSON.stringify(pub2.json).slice(0, 200));
    const lessonsNow = await j('GET', '/api/lessons');
    ok('published lesson is visible to the main app', lessonsNow.json.lessons.some((l) => l.id === fedLesson.id));

    const badPublish = await j('POST', '/api/companion/publish', { lessons: [{ id: 'x', title: 'nope' }] });
    ok('invalid lesson is rejected on publish', badPublish.status === 400 || badPublish.json.count === 0);

    const ssrfRes = await j('POST', '/api/companion/ingest/url', { url: 'http://127.0.0.1:' + PORT + '/api/health' });
    ok('local caller may fetch a local url (documented behaviour)', ssrfRes.status === 200);
    const badJson = await fetch(B + '/api/companion/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
    ok('malformed JSON body is rejected', badJson.status === 400);
    const unknown = await j('GET', '/api/companion/does-not-exist');
    ok('unknown companion route 404s', unknown.status === 404);
    const del = await j('DELETE', '/api/companion/sources/' + sid);
    ok('delete source over HTTP', del.status === 200 && del.json.ok === true);

    // A local caller may fetch a local URL; remote trust is tested at socket level below.
    const xff = await fetch(B + '/api/companion/state', { headers: { 'X-Forwarded-For': '203.0.113.7' } });
    ok('X-Forwarded-For is ignored for access decisions (socket peer is used)', xff.status === 200, 'status ' + xff.status);

    const wipeRes = await j('POST', '/api/companion/wipe');
    ok('wipe over HTTP', wipeRes.status === 200 && wipeRes.json.ok === true);
    const afterWipe = await j('GET', '/api/companion/state');
    ok('state is empty after wipe', afterWipe.json.sources.length === 0);
  }

  /* ═════════════════════════ android / PWA ═════════════════════════ */

  section('android: PWA manifest, service worker, camera, mobile export');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.webmanifest'), 'utf8'));
  ok('manifest has the installability basics',
    manifest.name && manifest.short_name && manifest.start_url && manifest.display === 'standalone' &&
    manifest.background_color && manifest.theme_color, JSON.stringify(manifest.display));
  ok('manifest ships any + maskable icons at 192 and 512',
    ['any', 'maskable'].every((p) => [192, 512].every((n) =>
      manifest.icons.some((i) => i.purpose === p && i.sizes === n + 'x' + n && fs.existsSync(path.join(__dirname, i.src.replace(/^\//, '')))))),
    manifest.icons.map((i) => i.purpose + i.sizes).join(','));
  for (const sc of manifest.shortcuts || []) {
    ok('manifest shortcut url is a companion url: ' + sc.name, /^\/companion/.test(sc.url), sc.url);
  }

  const swSrc = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
  ok('service worker never caches the API', swSrc.includes("startsWith('/api/')"));
  ok('service worker leaves other pages alone', swSrc.includes('if (!isCompanionPage(url.pathname)) return;'));
  ok('service worker precaches the whole companion shell',
    ['/companion', '/companion.js', '/ai.js', '/engine/coach.js'].every((u) => swSrc.includes("'" + u + "'")));
  let swSyntax = true;
  try { new (require('vm').Script)(swSrc, { filename: 'sw.js' }); } catch (e) { swSyntax = false; }
  ok('sw.js parses as JavaScript', swSyntax);

  const headHtml = fs.readFileSync(path.join(__dirname, 'companion.html'), 'utf8');
  ok('companion.html links the manifest + theme colour + apple icon',
    headHtml.includes('rel="manifest"') && headHtml.includes('name="theme-color"') && headHtml.includes('apple-touch-icon'));
  ok('companion.js registers the worker only over http(s)',
    uiJs.includes('registerServiceWorker') && uiJs.includes('/^https?:$/.test(location.protocol)'));
  ok('install prompt wiring exists (beforeinstallprompt + appinstalled)',
    uiJs.includes('beforeinstallprompt') && uiJs.includes('appinstalled') && uiJs.includes('btnInstallApp'));
  ok('camera capture source exists and reuses the same pipeline',
    uiJs.includes('const CameraCapture') && uiJs.includes('getUserMedia') && uiJs.includes("captureSource() === 'camera'"));
  ok('phones default to the camera when screen share is impossible',
    uiJs.includes('!md.getDisplayMedia && md.getUserMedia'));
  ok('stopping watching releases the camera too', uiJs.includes('CameraCapture.stop();'));
  ok('remote server mode is configurable (url + token)',
    uiJs.includes('setServerUrl') && uiJs.includes('setServerToken') && uiJs.includes('X-Companion-Token'));
  ok('the connection token is device-local, never uploaded with settings',
    uiJs.includes('delete wire.serverUrl; delete wire.serverToken;') && uiJs.includes("localStorage.setItem('companionConn'"));

  // static export for Capacitor
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'tools', 'make-mobile.js')], { cwd: __dirname, stdio: 'pipe' });
  const www = path.join(__dirname, 'mobile', 'www');
  ok('mobile export produced index.html', fs.existsSync(path.join(www, 'index.html')));
  const mobHtml = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
  const mobRefs = Array.from(mobHtml.matchAll(/(?:src|href)="([^"#?]+)"/g)).map((m) => m[1]).filter((u) => !/^https?:/i.test(u));
  ok('mobile export is self-contained', mobRefs.length > 5 && mobRefs.every((r) => fs.existsSync(path.join(www, r))),
    mobRefs.filter((r) => !fs.existsSync(path.join(www, r))).join(', '));
  const capCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'mobile', 'capacitor.config.json'), 'utf8'));
  ok('capacitor config points at the export and the right app id',
    capCfg.webDir === 'www' && /^com\./.test(capCfg.appId) && capCfg.server && capCfg.server.androidScheme === 'https',
    capCfg.appId);
  const mobPkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'mobile', 'package.json'), 'utf8'));
  ok('mobile package has the capacitor workflow scripts',
    ['export', 'add:android', 'sync', 'open'].every((k) => !!mobPkg.scripts[k]));

  // If a built APK has been fetched into apk/ (see BUILD-INFO.txt), verify it.
  const apkPath = path.join(__dirname, 'apk', 'app-debug.apk');
  if (fs.existsSync(apkPath)) {
    const fd = fs.openSync(apkPath, 'r');
    const magic = Buffer.alloc(4);
    fs.readSync(fd, magic, 0, 4, 0);
    fs.closeSync(fd);
    ok('fetched APK is a zip/apk', magic.toString('hex') === '504b0304', magic.toString('hex'));
    const raw = fs.readFileSync(apkPath);
    let eocd = -1;
    for (let i = raw.length - 22; i >= 0 && i >= raw.length - 70000; i--) {
      if (raw.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    ok('fetched APK has an intact zip central directory', eocd > 0);
    const names = [];
    if (eocd > 0) {
      const count = raw.readUInt16LE(eocd + 10);
      let p = raw.readUInt32LE(eocd + 16);
      for (let i = 0; i < count; i++) {
        if (raw.readUInt32LE(p) !== 0x02014b50) break;
        const nl = raw.readUInt16LE(p + 28);
        names.push(raw.toString('utf8', p + 46, p + 46 + nl));
        p += 46 + nl + raw.readUInt16LE(p + 30) + raw.readUInt16LE(p + 32);
      }
    }
    ok('APK carries the android triple + the exported web app',
      names.includes('AndroidManifest.xml') && names.includes('classes.dex') &&
      names.includes('assets/public/index.html') && names.includes('assets/public/engine/coach.js'),
      names.length + ' entries');
    ok('APK is signed (debug certificate)', names.some((n) => n === 'META-INF/CERT.RSA'));
  } else {
    console.log('  SKIP  APK artifact verification (no apk/app-debug.apk — fetch it: git fetch origin apk-artifact)');
  }

  /* ═════════════════════════ brand layer (NLH) ═════════════════════════ */

  section('brand layer: Northern Lights Herb edition (flag-gated)');
  const nlhJs = fs.readFileSync(path.join(__dirname, 'brand', 'nlh.js'), 'utf8');
  const nlhCss = fs.readFileSync(path.join(__dirname, 'brand', 'nlh.css'), 'utf8');
  ok('brand switch file parses', (() => { try { new (require('vm').Script)(nlhJs, { filename: 'nlh.js' }); return true; } catch (e) { return false; } })());
  ok('brand edition is OFF unless ?brand=nlh', /if \(!active\) return;/.test(nlhJs) && nlhJs.indexOf('if (!active) return;') < nlhJs.indexOf('data-brand'));
  ok('?brand=off clears the edition', nlhJs.includes("q.get('brand') === 'off'"));
  ok('18+ age gate present with both doors', nlhJs.includes('nlhYes') && nlhJs.includes('nlhNo') && /18 or older/.test(nlhJs));
  ok('under-18s get a friendly exit, not a blank screen', nlhJs.includes('Come back later'));
  ok('age consent is remembered, not re-asked', nlhJs.includes("localStorage.setItem(AGE, '1')"));
  ok('compliance footer states 18+, no-sales, no-advice',
    nlhJs.includes('does not sell cannabis through this app') && nlhJs.includes('financial or medical advice'));
  ok('DOC is an original character, not a likeness', nlhJs.includes('brand/art/doc.png'));

  // every css rule must be scoped under the brand flag or inert otherwise
  const unscoped = nlhCss.split('}').map((blk) => blk.split('{')[0].trim()).filter((sel) => sel && !sel.startsWith('body[data-brand="nlh"]') && !sel.startsWith('/*') && !sel.startsWith('@'));
  ok('nlh.css is fully scoped under body[data-brand="nlh"]', unscoped.length === 0, unscoped.join(' | ').slice(0, 120));

  for (const f of ['doc.png', 'crew-grower.png', 'crew-chemist.png', 'crew-hype.png']) {
    const st = fs.statSync(path.join(__dirname, 'brand', 'art', f));
    ok('original art exists: ' + f, st.size > 20000, st.size + 'b');
  }
  ok('companion.html loads the brand layer before the app',
    headHtml.includes('brand/nlh.css') && headHtml.indexOf('brand/nlh.js') < headHtml.indexOf('companion.js'));
  const pkgB = JSON.parse(fs.readFileSync(path.join(__dirname, 'companion', 'package.json'), 'utf8')).build;
  ok('brand edition is packaged for desktop + mobile',
    pkgB.extraResources.some((r) => r.from === '../brand') && fs.existsSync(path.join(__dirname, 'mobile', 'www', 'brand', 'nlh.js')));
  ok('rebrand brief records the client decisions', fs.existsSync(path.join(__dirname, 'docs', 'rebrand-brief.md')) &&
    fs.readFileSync(path.join(__dirname, 'docs', 'rebrand-brief.md'), 'utf8').includes('Decisions'));

  /* ═════════════════════════ packaging & installers ═════════════════════════ */

  section('packaging and installers');
  const iconMod = require('./tools/make-icons');
  const iconChecks = iconMod.verify();
  const iconBad = iconChecks.filter((c) => !c.ok);
  ok('every generated icon verifies (png/ico/icns parsed back)', iconBad.length === 0,
    iconBad.map((x) => x.name + ' (' + x.detail + ')').join('; '));
  ok('runtime icon set is complete', [16, 32, 64, 128, 256].every((n) => fs.existsSync(path.join(__dirname, 'companion', 'icon' + n + '.png'))));

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'companion', 'package.json'), 'utf8'));
  const b = pkg.build || {};
  ok('electron-builder config present', !!b.appId && !!b.productName, b.appId);
  ok('packaging dirs avoid throwaway names (build/dist/out)',
    b.directories && !/^(dist|build|out)$/.test(b.directories.output) && !/^(dist|build|out)$/.test(b.directories.buildResources),
    JSON.stringify(b.directories));
  for (const f of (b.files || [])) ok('packaged file exists: ' + f, fs.existsSync(path.join(__dirname, 'companion', f)));
  const resBad = [];
  for (const r of (b.extraResources || [])) {
    if (!fs.existsSync(path.join(__dirname, 'companion', r.from))) resBad.push('missing ' + r.from);
    if (!/^app\//.test(r.to)) resBad.push('bad to: ' + r.to);
  }
  ok('every extraResources entry exists and lands under app/', resBad.length === 0, resBad.join(', '));
  ok('windows installer icon exists', fs.existsSync(path.join(__dirname, 'companion', b.win.icon)), b.win.icon);
  ok('mac installer icon exists', fs.existsSync(path.join(__dirname, 'companion', b.mac.icon)), b.mac.icon);
  ok('linux icon folder holds a >=512 png', (() => {
    const p = path.join(__dirname, 'companion', b.linux.icon, 'icon.png');
    if (!fs.existsSync(p)) return false;
    const img = iconMod.readPng(fs.readFileSync(p));
    return img.w >= 512 && img.h >= 512;
  })());
  ok('nsis installer makes desktop + start menu shortcuts', !!(b.nsis && b.nsis.createDesktopShortcut && b.nsis.createStartMenuShortcut));
  ok('mac target builds unsigned (no certificate needed)', b.mac.identity === null);

  // When electron-builder is installed locally, validate the config against its
  // official JSON schema. Skipped on a fresh clone (no node_modules).
  let ebSchema = null;
  try { ebSchema = require(path.join(__dirname, 'companion', 'node_modules', 'app-builder-lib', 'scheme.json')); } catch (e) {}
  if (ebSchema) {
    const Ajv = require(path.join(__dirname, 'companion', 'node_modules', 'ajv'));
    const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
    const v = ajv.compile(ebSchema);
    const good = v(b);
    ok('electron-builder config matches the official schema', good,
      good ? '' : (v.errors || []).slice(0, 3).map((e) => (e.instancePath || 'root') + ' ' + e.message).join('; '));
  } else {
    console.log('  SKIP  electron-builder schema validation (electron-builder not installed here)');
  }
  ok('dist scripts exist for all three platforms', ['dist:win', 'dist:mac', 'dist:linux'].every((k) => !!pkg.scripts[k]));

  // The packaged app must not 404 anything the UI asks for.
  const uiRefs = Array.from(uiHtml.matchAll(/(?:src|href)="([^"#?]+)"/g)).map((m) => m[1])
    .filter((u) => !/^https?:/.test(u));
  const covered = (ref) => {
    if (b.files.some((f) => f === ref || ref.startsWith(f.replace(/\/$/, '') + '/'))) return true;
    for (const r of b.extraResources) {
      // extraResources "from" is relative to companion/, refs are relative to the repo root
      const from = path.relative(__dirname, path.resolve(path.join(__dirname, 'companion'), r.from)).split(path.sep).join('/');
      const abs = path.resolve(path.join(__dirname, 'companion'), r.from);
      const isDir = fs.existsSync(abs) && fs.statSync(abs).isDirectory();
      if (isDir && (ref === from || ref.startsWith(from.replace(/\/$/, '') + '/'))) return true;
      if (!isDir && ref === from) return true;
    }
    return false;
  };
  const uncovered = uiRefs.filter((u) => !covered(u));
  ok('every asset the UI loads is inside the package', uncovered.length === 0, uncovered.join(', ') + ' | refs: ' + uiRefs.join(', '));

  const mainSrc = fs.readFileSync(path.join(__dirname, 'companion', 'main.js'), 'utf8');
  ok('main.js resolves paths for packaged builds', mainSrc.includes('app.isPackaged') && mainSrc.includes('process.resourcesPath'));
  ok('main.js picks its root from isPackaged, with dev as the only fallback',
    /const ROOT = PACKAGED \? path\.join\(process\.resourcesPath, 'app'\) : path\.join\(__dirname, '\.\.'\);/.test(mainSrc));

  /* ── the installer scripts themselves ── */
  const shPath = path.join(__dirname, 'install.sh');
  ok('install.sh exists and is executable', fs.existsSync(shPath) && (fs.statSync(shPath).mode & 0o111) !== 0);
  const shSrc = fs.readFileSync(shPath, 'utf8');
  for (const flag of ['--dry-run', '--installer', '--remove', '--help']) ok('install.sh supports ' + flag, shSrc.includes(flag));
  ok('install.sh requires node 18+', shSrc.includes('-ge 18'));
  const { execFileSync } = require('child_process');
  let shSyntaxOk = true;
  try { execFileSync('bash', ['-n', shPath], { stdio: 'pipe' }); } catch (e) { shSyntaxOk = false; }
  ok('install.sh passes bash -n', shSyntaxOk);
  const dryOut = execFileSync(shPath, ['--dry-run'], { cwd: __dirname, encoding: 'utf8' });
  ok('install.sh --dry-run succeeds and changes nothing', dryOut.includes('[dry-run] install the Electron shell') && dryOut.includes('(dry run'), dryOut.slice(0, 60));
  ok('install.sh --dry-run never runs npm install for real', !/added \d+ packages/.test(dryOut));
  const helpOut = execFileSync(shPath, ['--help'], { cwd: __dirname, encoding: 'utf8' });
  ok('install.sh --help shows usage and nothing else', helpOut.includes('--installer') && !helpOut.includes('set -euo'), helpOut.slice(-80));

  const batPath = path.join(__dirname, 'install.bat');
  ok('install.bat exists', fs.existsSync(batPath));
  const bat = fs.readFileSync(batPath, 'utf8');
  ok('install.bat supports /installer, /remove, /dry, /help', ['/installer', '/remove', '/dry', '/help'].every((f) => bat.includes(f)));
  ok('install.bat builds the nsis setup on /installer', bat.includes('dist:win') && bat.includes('release\\'));
  ok('install.bat hides the console with a vbs launcher', bat.includes('launch.vbs') && bat.includes('Wscript.Shell'));
  ok('install.bat shortcuts use the packaged icon', bat.includes('packaging\\icon.ico'));
  ok('install.bat checks for node 18+', bat.includes('LSS 18'));
  ok('install.bat has clean failure and exit paths', bat.includes(':fail') && bat.includes('exit /b 1') && bat.includes('exit /b 0'));

  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 250));
  try { child.kill('SIGKILL'); } catch {}
  for (const d of [tmpDir, coreDir, gateDir, e2eDir]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('Failed: ' + failures.join(' | ')); process.exit(1); }

}

main().catch((e) => { console.error('\nTEST RUNNER ERROR:', e && e.stack || e); process.exit(1); });
