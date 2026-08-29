'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

let failed = 0;

function runSuite(label, script, env, timeoutMs) {
  const tmp = path.join(os.tmpdir(), 'pf_test_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(tmp, script, 'utf8');
  try {
    const out = execFileSync(process.execPath, [tmp], { encoding: 'utf8', env: Object.assign({}, process.env, env), timeout: timeoutMs || 60000 });
    console.log(out);
  } catch (e) {
    console.log(e.stdout && e.stdout.length ? e.stdout : '');
    console.error(e.stderr || e.message);
    failed = 1;
  } finally {
    fs.unlinkSync(tmp);
  }
}

/* ============ SUITE A: browser app (stubs + lessons + ai + app) ============ */

const STUBS = `
'use strict';
let __chatReply = '{"q":"What does a green candle mean?","options":["Price ended higher","Price ended lower","Price froze","Price turned purple"],"answer":0,"why":"Green equals up!"}';

function __makeEl() {
  function __makeClassList() {
    const s = new Set();
    return {
      add(c){ s.add(c); }, remove(c){ s.delete(c); }, toggle(c){ s.has(c) ? s.delete(c) : s.add(c); },
      contains(c){ return s.has(c); }
    };
  }
  return {
    innerHTML: '', textContent: '', value: '', className: '', src: '', title: '',
    disabled: false, scrollTop: 0, scrollHeight: 100, dataset: {}, style: {},
    classList: __makeClassList(),
    selectedOptions: [{}],
    addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){}, click(){},
    querySelector(){ return __makeEl(); }, querySelectorAll(){ return []; },
    getBoundingClientRect(){ return { width: 800, height: 400 }; },
    focus(){}, blur(){}
  };
}
const __els = {};
const document = {
  body: __makeEl(),
  querySelector: (s) => { if (!__els[s]) __els[s] = __makeEl(); return __els[s]; },
  querySelectorAll: (s) => { if (!__els[s]) __els[s] = __makeEl(); return [__els[s]]; },
  createElement: () => __makeEl(),
  addEventListener(){}
};
const __store = {};
const localStorage = {
  getItem(k){ return Object.prototype.hasOwnProperty.call(__store, k) ? __store[k] : null; },
  setItem(k, v){ __store[k] = String(v); },
  removeItem(k){ delete __store[k]; }
};
global.localStorage = localStorage;
global.window = { scrollTo: function(){} };
const __ok = (data) => ({ ok: true, status: 200, json: () => Promise.resolve(data), text: () => Promise.resolve('') });
global.fetch = (url, opts) => {
  const u = String(url);
  if (u.indexOf('/api/health') !== -1) {
    return __ok({ ok: true });
  }
  if (u.indexOf('/api/tags') !== -1) {
    return __ok({ models: [{ name: 'llama3.2:latest' }, { name: 'tinyllama:latest' }, { name: 'qwen2.5:7b' }] });
  }
  if (u.indexOf('/api/chat') !== -1) {
    return __ok({ message: { content: __chatReply } });
  }
  if (u.indexOf('/models') !== -1) {
    return __ok({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] });
  }
  return { ok: false, status: 404, json: () => Promise.reject(new Error('no json')), text: () => Promise.resolve('404') };
};
`;

const DRIVER = `
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ' + (detail || '')); }
}

console.log('== LESSON CONTENT ==');
check('8 lessons bundled', LESSONS.length === 8, 'got ' + LESSONS.length);
let contentOk = true, detail = '';
for (const l of LESSONS) {
  if (!l.id || !l.title || !l.easy || !l.tip || !Array.isArray(l.questions) || l.questions.length < 3) { contentOk = false; detail = l.id + ': missing fields'; break; }
  for (const q of l.questions) {
    if (!q.q || !Array.isArray(q.options) || q.options.length !== 4 || !q.why) { contentOk = false; detail = l.id + ' question malformed'; break; }
    if (q.answer < 0 || q.answer > 3) { contentOk = false; detail = l.id + ' answer index out of range'; break; }
  }
}
check('lesson content is complete & valid', contentOk, detail);

console.log('== SCORING & LEVELS ==');
check('first-try = 10', questionPoints(0) === 10, 'got ' + questionPoints(0));
check('second-try = 5', questionPoints(1) === 5, 'got ' + questionPoints(1));
check('later-tries = 2', questionPoints(3) === 2, 'got ' + questionPoints(3));
check('level 0 = Money Beginner', getLevel(0).level.name === 'Money Beginner', 'got ' + getLevel(0).level.name);
check('level 60 = Coin Explorer', getLevel(60).level.name === 'Coin Explorer', 'got ' + getLevel(60).level.name);
check('level max = Market Master', getLevel(5000).level.name === 'Market Master', 'got ' + getLevel(5000).level.name);
check('progress caps at 100', getLevel(5000).progress === 100, 'got ' + getLevel(5000).progress);

async function main() {
  console.log('== AI BRAIN (stub Ollama online) ==');
  const st = await AI.status();
  check('status says online', AI.online === true, (AI.lastError || '') + ' ' + JSON.stringify(st));
  check('auto-picked a model', !!AI.model, 'model=' + AI.model);
  check('prefers llama3.2', AI.model === 'llama3.2:latest', 'got ' + AI.model);

  const g1 = await AI.generateQuestion(LESSONS[0]);
  check('AI generated a valid question', g1.ok && g1.question && g1.question.options.length === 4 && g1.question.answer === 0,
    JSON.stringify(g1));

  __chatReply = 'This is not JSON at all.';
  const g2 = await AI.generateQuestion(LESSONS[0]);
  check('AI junk response is rejected safely', g2.ok === false, JSON.stringify(g2));
  __chatReply = JSON.stringify({ q: 'Q', options: ['a', 'b'], answer: 0, why: 'x' });
  const g3 = await AI.generateQuestion(LESSONS[0]);
  check('short options list rejected safely', g3.ok === false, JSON.stringify(g3));

  console.log('== AI BRAIN offline paths ==');
  AI.cfg.provider = 'openai';
  const off = await AI.status();
  check('provider needing a key reports offline', off.ok === false, JSON.stringify(off));
  check('offline error mentions the key', (AI.lastError || '').indexOf('API key') !== -1, AI.lastError);
  AI.cfg.provider = 'ollama';
  await AI.status();

  console.log('== CHAT ==');
  const chat = await AI.chat([{ role: 'system', content: 'be a fox' }, { role: 'user', content: 'hi' }]);
  check('chat returns stub text', chat.ok && !!chat.text, JSON.stringify(chat));

  console.log('== BOOT (all UI render paths) ==');
  let uiErr = null;
  try { boot(); await connectBrain(); } catch (e) { uiErr = e; }
  check('boot + connectBrain run without throwing', uiErr === null, uiErr ? (uiErr.stack || uiErr.message) : '');
  check('no token + server online shows login screen', $('#loginScreen').classList.contains('hidden') === false, 'login hidden=' + $('#loginScreen').classList.contains('hidden'));
  guestMode();
  check('guest mode hides login and renders home', $('#loginScreen').classList.contains('hidden') === true, 'login hidden=' + $('#loginScreen').classList.contains('hidden'));

  console.log('== QUIZ FLOW ==');
  openLesson('money');
  startQuiz();
  session.queue = session.lesson.questions.slice();
  for (let i = 0; i < session.queue.length; i++) { session.index = i; session.mistakes = 0; session.locked = false; choose(session.queue[i].answer); }
  session.index = session.queue.length;
  finishQuiz();
  check('perfect money quiz earns 45 (40 + first-time bonus)', state.score === 45, 'score=' + state.score);
  check('money lesson marked done', state.done.money === true, JSON.stringify(state.done));
  check('streak = 4 on all-first-try quiz', state.streak === 4, 'streak=' + state.streak);
  check('best streak recorded', state.bestStreak === 4, 'best=' + state.bestStreak);

  openLesson('shares');
  startQuiz();
  session.queue = [session.lesson.questions[0]];
  session.index = 0;
  choose(2);
  check('wrong answer resets streak', state.streak === 0, 'streak=' + state.streak);
  choose(session.queue[0].answer);
  check('second-try correct awards 5', session.earned === 5, 'earned=' + session.earned);
  session.index = session.queue.length;
  finishQuiz();
  check('shares quiz adds 10 (5 + bonus)', state.score === 55, 'score=' + state.score);

  openLesson('risk');
  startQuiz();
  const q = session.queue[0];
  session.index = 0;
  session.mistakes = 0;
  for (let i = 0; i < 4; i++) choose((q.answer + i) % 4);
  session.index = session.queue.length;
  finishQuiz();
  check('reveal/retries path finishes cleanly', state.done.risk === true, JSON.stringify(state.done));

  console.log('\\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main();
`;

const suiteA = STUBS + '\n' +
  [
    fs.readFileSync(path.join(__dirname, 'lessons.js')),
    fs.readFileSync(path.join(__dirname, 'ai.js')),
    fs.readFileSync(path.join(__dirname, 'app.js'))
  ].map(b => b.toString('utf8')).join('\n') + '\n' + DRIVER;

/* ============ SUITE B: node auth backend ============ */

const suiteB = `
'use strict';
const assert = require('assert');
const AUTH = require(${JSON.stringify(path.join(__dirname, 'auth.js'))});

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  ' + (detail || '')); }
}

async function main() {
  console.log('== AUTH: usernames & passwords ==');
  check('cleanUsername keeps valid', AUTH.cleanUsername('Fox_123') === 'fox_123');
  check('cleanUsername rejects too short', AUTH.cleanUsername('ab') === null);
  check('cleanUsername rejects spaces', AUTH.cleanUsername('bad name') === null);
  check('cleanUsername rejects symbols', AUTH.cleanUsername('oops!') === null);
  check('checkPassword accepts 6+', AUTH.checkPassword('abcdef') === true);
  check('checkPassword rejects short', AUTH.checkPassword('abc') === false);

  console.log('== AUTH: register ==');
  const r1 = await AUTH.register('alex', 'secret123');
  check('register ok', r1.ok === true, JSON.stringify(r1));
  const r2 = await AUTH.register('alex', 'other123');
  check('duplicate rejected', r2.ok === false && r2.error.indexOf('taken') !== -1, JSON.stringify(r2));
  const r3 = await AUTH.register('bob', 'bad');
  check('weak password rejected at register', r3.ok === false, JSON.stringify(r3));
  const r4 = await AUTH.register('CAROL!', 'secret123');
  check('bad username rejected at register', r4.ok === false, JSON.stringify(r4));

  console.log('== AUTH: login ==');
  const l1 = await AUTH.login('alex', 'wrongpass');
  check('wrong password fails', l1.ok === false, JSON.stringify(l1));
  const l2 = await AUTH.login('ALEX', 'secret123');
  check('login ok with progress', l2.ok === true && l2.user === 'alex' && l2.progress && l2.progress.score === 0, JSON.stringify(l2));
  const l3 = await AUTH.login('nobody', 'secret123');
  check('unknown user fails', l3.ok === false, JSON.stringify(l3));

  console.log('== AUTH: tokens ==');
  const tok = AUTH.issueToken('alex');
  const v1 = AUTH.verifyToken(tok);
  check('token verifies', v1 && v1.user === 'alex', JSON.stringify(v1));
  const v2 = AUTH.verifyToken(tok + 'x');
  check('tampered token rejected', v2 === null, JSON.stringify(v2));
  const v3 = AUTH.verifyToken('garbage.token');
  check('garbage token rejected', v3 === null, JSON.stringify(v3));
  const v4 = AUTH.verifyToken(AUTH.issueToken('alex', Date.now() - 1000));
  check('expired token rejected', v4 === null, JSON.stringify(v4));
  const v5 = AUTH.verifyToken(AUTH.issueToken('ghost'));
  check('token for deleted user rejected', v5 === null, JSON.stringify(v5));

  console.log('== AUTH: progress ==');
  const p1 = AUTH.getProgress('alex');
  check('fresh progress is zeroed', p1.score === 0 && p1.streak === 0 && p1.bestStreak === 0, JSON.stringify(p1));
  const sp = AUTH.setProgress('alex', { score: 120, streak: 3, bestStreak: 9, done: { money: true, shares: true } });
  check('setProgress ok', sp.ok === true, JSON.stringify(sp));
  const p2 = AUTH.getProgress('alex');
  check('progress roundtrip', p2.score === 120 && p2.streak === 3 && p2.bestStreak === 9 && p2.done.money === true, JSON.stringify(p2));
  const sn = AUTH.setProgress('alex', { score: -50, streak: -1, bestStreak: 'x', done: { risk: 1 } });
  check('negative/garbage progress sanitized to 0', sn.ok && AUTH.getProgress('alex').score === 0 && AUTH.getProgress('alex').bestStreak === 0 && AUTH.getProgress('alex').done.risk === true, JSON.stringify(sn));
  const sf = AUTH.setProgress('nobody', { score: 1 });
  check('setProgress unknown user fails', sf.ok === false, JSON.stringify(sf));
  const l4 = await AUTH.login('alex', 'secret123');
  check('login returns saved progress', l4.ok && l4.progress.score === 0, JSON.stringify(l4));

  console.log('\\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
`;

const tmpDb = path.join(os.tmpdir(), 'pf_users_' + Date.now() + '.json');

console.log('[A] Browser app suite (stubs)');
runSuite('A', suiteA, {});
console.log('\\n[B] Node auth backend suite');
runSuite('B', suiteB, { DB_FILE: tmpDb, SESSION_SECRET: 'test-secret-not-for-production' });

try { fs.unlinkSync(tmpDb); } catch {}
if (fs.existsSync(path.join(__dirname, 'users.json'))) {
  console.log('\\nNOTE: users.json exists (from running the real server) — leaving it in place.');
}

process.exit(failed ? 1 : 0);