'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const Store = {
  get(k, d) {
    try { const v = localStorage.getItem('pf_' + k); return v === null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('pf_' + k, JSON.stringify(v)); } catch {}
  }
};

const state = Object.assign({ score: 0, streak: 0, bestStreak: 0, done: {} }, Store.get('state', {}));

const API = (typeof location !== 'undefined' && location.protocol === 'file:') ? 'http://localhost:8081' : '';

const auth = { token: Store.get('token') || null, user: Store.get('user') || null, role: Store.get('role') || 'member' };

let CFG = { googleClientId: null, creator: 'yubi' };
let serverLessons = [];
let syncT = null;

function saveState() { Store.set('state', state); scheduleSync(); }

async function apiFetch(path, opts) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), (opts && opts.timeout) || 20000);
  try {
    const r = await fetch(API + path, Object.assign({ signal: ctl.signal }, opts || {}));
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok) return { ok: false, status: r.status, error: (data && data.error) || 'Request failed.' };
    return { ok: true, status: r.status, data: data || {} };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, network: true };
  } finally {
    clearTimeout(to);
  }
}

async function apiFetchRetry(path, opts) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await apiFetch(path, opts);
    if (!r.network || attempt === 1) return r;
    await new Promise((ok) => setTimeout(ok, 9000));
  }
}

function scheduleSync() {
  if (!auth.token) return;
  clearTimeout(syncT);
  syncT = setTimeout(syncNow, 700);
}

async function syncNow() {
  if (!auth.token) return;
  const r = await apiFetch('/api/progress', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token },
    body: JSON.stringify({ progress: { score: state.score, streak: state.streak, bestStreak: state.bestStreak, done: state.done } }),
    timeout: 15000
  });
  if (r.status === 401) { signOut('Session expired — please sign in again.'); }
  else if (!r.ok && r.network) { toast('⚠ Could not save progress — server unreachable. It will re-sync when back.', 'toast-error'); }
}

function applyServerProgress(p) {
  p = p || {};
  state.score = Math.max(state.score, +p.score || 0);
  state.bestStreak = Math.max(state.bestStreak, +p.bestStreak || 0);
  if (+p.streak) state.streak = +p.streak;
  state.done = Object.assign({}, p.done || {}, state.done);
  Store.set('state', state);
}

async function initAuth() {
  const h = await apiFetchRetry('/api/health', { timeout: 30000 });
  if (!h.ok) {
    toast('🦊 Server is waking up or offline — playing as guest for now. If this is the hosted site, give it about a minute then refresh.', 'toast-error');
    showLogin();
    return;
  }
  if (auth.token) {
    const r = await apiFetch('/api/me', { headers: { 'Authorization': 'Bearer ' + auth.token }, timeout: 25000 });
    if (r.ok) { applyServerProgress(r.data.progress); setSignedIn(r.data.user, r.data.role, false); }
    else if (r.status === 401) { auth.token = null; Store.set('token', null); auth.user = null; Store.set('user', null); auth.role = 'member'; Store.set('role', null); showLogin(); }
    else showLogin();
  } else {
    showLogin();
  }
}

async function loadConfig() {
  const r = await apiFetchRetry('/api/config', { timeout: 30000 });
  if (r.ok) {
    CFG = Object.assign(CFG, r.data);
    if (CFG.googleClientId) setupGoogle();
  }
}

function setupGoogle() {
  if (window.google && window.google.accounts) { renderGoogleButton(); return; }
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.defer = true;
  s.onload = renderGoogleButton;
  document.head.appendChild(s);
}

function renderGoogleButton() {
  const wrap = $('#googleWrap');
  if (!wrap || !window.google || !window.google.accounts) return;
  wrap.innerHTML = '';
  window.google.accounts.id.initialize({
    client_id: CFG.googleClientId,
    callback: handleGoogleCredential,
    auto_select: false
  });
  window.google.accounts.id.renderButton(wrap, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
}

async function handleGoogleCredential(resp) {
  if (!resp || !resp.credential) { $('#loginErr').textContent = 'Google sign-in did not return a login.'; return; }
  const err = $('#loginErr');
  err.textContent = 'Contacting Google…';
  const r = await apiFetch('/api/google', { method: 'POST', body: JSON.stringify({ credential: resp.credential }), timeout: 30000 });
  if (!r.ok) { err.textContent = r.error || 'Could not complete Google sign-in.'; return; }
  completeLogin(r.data);
}

function completeLogin(data) {
  auth.token = data.token;
  Store.set('token', auth.token);
  applyServerProgress(data.progress || null);
  setSignedIn(data.user, data.role);
}

function showLogin() {
  $('#loginScreen').classList.remove('hidden');
}

function setSignedIn(user, role, announce) {
  auth.user = user;
  auth.role = role || 'member';
  Store.set('user', user);
  Store.set('role', auth.role);
  $('#userPill').textContent = '👤 ' + user + (auth.role === 'creator' ? ' 👑' : '');
  $('#userPill').classList.remove('hidden');
  $('#btnSignOut').classList.remove('hidden');
  $('#loginScreen').classList.add('hidden');
  renderHome();
  syncNow();
  if (announce !== false) toast((auth.role === 'creator' ? 'Welcome back, creator ' : 'Welcome, ') + user + '! Your levels are saved to your account. 🎉', 'toast-ok');
}

function setSeg(mode) {
  $('#seg').dataset.mode = mode;
  $$('#seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#btnAuth').textContent = mode === 'login' ? 'Sign in 🚀' : 'Create account 🎉';
}

async function submitAuth() {
  const u = $('#userName').value.trim();
  const pw = $('#password').value;
  const err = $('#loginErr');
  const mode = $('#seg').dataset.mode || 'login';
  err.textContent = '';
  if (!u || !pw) { err.textContent = 'Type a username and password first!'; return; }
  $('#btnAuth').disabled = true;
  $('#btnAuth').textContent = 'Working…';
  const r = await apiFetchRetry('/api/' + mode, { method: 'POST', body: JSON.stringify({ username: u, password: pw }), timeout: 30000 });
  $('#btnAuth').disabled = false;
  $('#btnAuth').textContent = mode === 'login' ? 'Sign in 🚀' : 'Create account 🎉';
  if (!r.ok) { err.textContent = r.error || 'Could not reach the server.'; return; }
  completeLogin(r.data);
}

function guestMode() {
  $('#loginScreen').classList.add('hidden');
  renderHome();
  toast('Guest mode — progress stays in this browser. Create an account to keep it anywhere!', 'toast-error');
}

function signOut(msg) {
  auth.token = null;
  auth.user = null;
  auth.role = 'member';
  Store.set('token', null);
  Store.set('user', null);
  Store.set('role', null);
  $('#userPill').classList.add('hidden');
  $('#btnSignOut').classList.add('hidden');
  showLogin();
  if (msg) toast(msg, 'toast-error');
}

const SCORES = { first: 10, second: 5, retry: 2, reveal: 1, bonus: 5 };

const LEVELS = [
  { min: 0, name: 'Money Beginner', emoji: '🌱' },
  { min: 60, name: 'Coin Explorer', emoji: '🪙' },
  { min: 140, name: 'Piggy Bank Pro', emoji: '🐷' },
  { min: 260, name: 'Market Rookie', emoji: '🎯' },
  { min: 420, name: 'Stock Sleuth', emoji: '🕵️' },
  { min: 620, name: 'Risk Ranger', emoji: '🛡️' },
  { min: 860, name: 'Chart Captain', emoji: '🧭' },
  { min: 1200, name: 'Market Master', emoji: '👑' }
];

function getLevel(score) {
  let lvl = LEVELS[0];
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) { if (score >= LEVELS[i].min) { lvl = LEVELS[i]; idx = i; } }
  const next = LEVELS[idx + 1] || null;
  const span = next ? next.min - lvl.min : 0;
  const progress = next ? Math.min(100, Math.round(((score - lvl.min) / span) * 100)) : 100;
  return { level: lvl, next, progress };
}

function questionPoints(mistakes) {
  return mistakes === 0 ? SCORES.first : mistakes === 1 ? SCORES.second : SCORES.retry;
}

let session = null;

function toast(msg, cls) {
  const w = $('#toastWrap');
  const el = document.createElement('div');
  el.className = 'toast ' + (cls || '');
  el.textContent = msg;
  w.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 400); }, 3400);
}

function switchView(v) {
  $('#view-home').classList.toggle('hidden', v !== 'home');
  $('#view-lesson').classList.toggle('hidden', v !== 'lesson');
  $('#view-editor').classList.toggle('hidden', v !== 'editor');
  window.scrollTo(0, 0);
}

function allLessons() {
  return LESSONS.concat(serverLessons || []);
}

async function loadServerLessons() {
  const r = await apiFetchRetry('/api/lessons', { timeout: 25000 });
  if (r.ok && Array.isArray(r.data.lessons)) {
    serverLessons = r.data.lessons;
    renderHome();
  } else {
    serverLessons = [];
  }
}

function renderHome() {
  const lvl = getLevel(state.score);
  $('#scorePill').textContent = '⭐ ' + state.score + ' pts';
  $('#levelPill').textContent = lvl.level.emoji + ' ' + lvl.level.name;
  $('#streakPill').textContent = '🔥 ' + state.streak + (state.streak > 0 ? ' in a row' : '');
  $('#levelProgress').style.width = lvl.progress + '%';
  $('#levelProgressLabel').textContent = lvl.next
    ? lvl.progress + '% to ' + lvl.next.name + ' ' + lvl.next.emoji
    : 'MAX level reached! 👑';
  const totalPossible = LESSONS.reduce((s, l) => s + l.questions.length * SCORES.first + SCORES.bonus, 0);
  $('#heroMeta').innerHTML =
    (auth.user ? '👋 Hi, <b>' + escapeHtml(auth.user) + '</b>! ' : '') +
    '<b>' + LESSONS.length + ' lessons</b> · ' +
    Object.keys(state.done).length + ' done · ' +
    totalPossible + ' points available' +
    (state.bestStreak > 0 ? ' · best streak 🔥' + state.bestStreak : '');
  const grid = $('#lessonGrid');
  grid.innerHTML = allLessons().map((l) => lessonCard(l)).join('') +
    (auth.role === 'creator'
      ? '<button class="lesson-card card add-lesson" id="btnAddLesson"><div class="lc-emoji">➕</div><h3>Add / edit a lesson</h3><div class="muted small">Create a brand-new lesson that appears here instantly — no redeploy.</div></button>'
      : '');
  grid.querySelectorAll('.lesson-card').forEach((el) => el.addEventListener('click', () => openLesson(el.dataset.id)));
  const add = $('#btnAddLesson');
  if (add) add.addEventListener('click', openLessonEditor);
}

function lessonCard(l) {
  const done = !!state.done[l.id];
  const maxPts = l.questions.length * SCORES.first + SCORES.bonus;
  return '<button class="lesson-card card" data-id="' + l.id + '">' +
    '<div class="lc-emoji">' + l.emoji + '</div>' +
    '<h3>' + l.title + '</h3>' +
    '<div class="muted small">' + l.minutes + ' · ' + l.questions.length + ' questions · up to +' + maxPts + ' pts</div>' +
    '<div class="lc-foot">' + (done ? '<span class="chip done">✔ Done</span>' : '<span class="chip play">Start 🚀</span>') + '</div>' +
    '</button>';
}

function openLessonEditor() {
  if (auth.role !== 'creator') return;
  renderEditor();
  switchView('editor');
}

function renderEditor() {
  const card = $('#editorCard');
  card.innerHTML =
    '<div class="lc-emoji big">✏️</div>' +
    '<h2>Lesson editor</h2>' +
    '<p class="muted">Add or update a lesson. It appears on the home page for everyone instantly — no redeploy needed.</p>' +
    '<label>Lesson id (short, letters/dashes — must be unique)</label><input id="edId" placeholder="e.g. savings">' +
    '<label>Title 🎓</label><input id="edTitle" placeholder="e.g. The Power of Saving">' +
    '<label>Emoji</label><input id="edEmoji" placeholder="e.g. 🐖" maxlength="4">' +
    '<label>Minutes (small text)</label><input id="edMinutes" placeholder="e.g. 2 min read">' +
    '<label>Big Idea (the one-sentence lesson)</label><textarea id="edEasy" rows="2" placeholder="The Big Idea: …"></textarea>' +
    '<label>The Rule (the tip)</label><textarea id="edTip" rows="2" placeholder="The Rule: …"></textarea>' +
    '<label>Sections — one per line: heading | text | optional example</label>' +
    '<textarea id="edSections" rows="4" placeholder="Starting out | Save a little every week | Example: put 10% of pocket money away' + '\n' + 'Keep going | More text | Example: …"></textarea>' +
    '<label>Questions — one per line: question | option1 | option2 | option3 | option4 | *correct index (0-3) | why</label>' +
    '<textarea id="edQuestions" rows="6" placeholder="What is saving? | Spending all | Keeping some for later | Lending it | Burying it | 1 | Saving means keeping money for later' + '\n' + '"></textarea>' +
    '<div class="login-err" id="edErr"></div>' +
    '<div class="btn-row"><button class="btn big" id="btnSaveLesson">💾 Save lesson</button><button class="btn big primary" id="btnEditorBack">🏠 Home</button></div>';
  $('#btnSaveLesson').addEventListener('click', saveLessonFromEditor);
  $('#btnEditorBack').addEventListener('click', () => { switchView('home'); renderHome(); });
  $('#edId').addEventListener('input', () => $('#edId').value = $('#edId').value.toLowerCase().replace(/[^a-z0-9_-]/g, ''));
}

function saveLessonFromEditor() {
  const err = $('#edErr');
  err.textContent = '';
  const id = $('#edId').value.trim();
  const title = $('#edTitle').value.trim();
  const emoji = $('#edEmoji').value.trim() || '📘';
  const minutes = $('#edMinutes').value.trim() || '2 min read';
  const easy = $('#edEasy').value.trim();
  const tip = $('#edTip').value.trim();
  if (!id || !title || !easy || !tip) { err.textContent = 'Fill at least id, title, Big Idea and The Rule.'; return; }
  const sections = parseLines($('#edSections').value, 3);
  const questions = parseQuestions($('#edQuestions').value);
  if (sections.length === 0) { err.textContent = 'Add at least one section line (heading | text | example).'; return; }
  if (questions.length < 3) { err.textContent = 'Add at least 3 question lines.'; return; }
  saveLesson({ id, title, emoji, minutes, easy, tip, sections, questions }, err);
}

function parseLines(text, partsLen) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts[0]) {
      out.push({
        h: parts[0],
        b: parts[1] || parts[0],
        ex: parts[2] ? parts[2] : null
      });
    }
  }
  return out;
}

function parseQuestions(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const parts = line.split('|').map((p) => p.trim());
    const a = parseInt(parts[5], 10);
    if (parts.length >= 6 && parts[0] && parts[5] && !isNaN(a) && a >= 0 && a <= 3) {
      out.push({ q: parts[0], options: [parts[1], parts[2], parts[3], parts[4]], answer: a, why: parts[6] || '' });
    }
  }
  return out;
}

async function saveLesson(lesson, err) {
  const btn = $('#btnSaveLesson');
  btn.disabled = true;
  const r = await apiFetch('/api/lessons', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token },
    body: JSON.stringify({ lesson }),
    timeout: 30000
  });
  btn.disabled = false;
  if (!r.ok) { err.textContent = r.error || 'Could not save the lesson.'; return; }
  serverLessons = r.data.lessons;
  err.textContent = '';
  toast('✅ Lesson "' + lesson.title + '" is now live for everyone!', 'toast-ok');
  await loadServerLessons();
  switchView('home');
  renderHome();
}

function openLesson(idOrLesson) {
  const lesson = typeof idOrLesson === 'string' ? allLessons().find((l) => l.id === idOrLesson) : idOrLesson;
  if (!lesson) return;
  session = { lesson, index: -1, mistakes: 0, earned: 0, correct: 0, queue: [], locked: false };
  renderLesson();
  switchView('lesson');
}

function buildMixedQuiz(n) {
  const pool = [];
  for (const l of allLessons()) {
    for (const q of l.questions) pool.push(q);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  const picked = pool.slice(0, Math.max(4, n || Math.min(12, pool.length)));
  return {
    id: 'surprise',
    title: 'Surprise Mixed Quiz',
    emoji: '🎲',
    minutes: Math.max(2, Math.round(picked.length * 0.8)) + ' min',
    easy: 'The Big Idea: A little bit of everything — how many can you nail?',
    sections: [],
    tip: 'The Rule: Mix it up. Every question sharpens a different money tool.',
    questions: picked
  };
}

function startSurpriseQuiz() {
  openLesson(buildMixedQuiz(10));
  startQuiz();
}

function renderLesson() {
  const l = session.lesson;
  $('#lessonContent').innerHTML =
    '<div class="lc-emoji big">' + l.emoji + '</div>' +
    '<h2>' + l.title + '</h2>' +
    '<div class="chips"><span class="chip">⏱ ' + l.minutes + '</span><span class="chip">🎯 ' + l.questions.length + ' questions</span></div>' +
    '<div class="big-idea">' + l.easy + '</div>' +
    l.sections.map((s) =>
      '<div class="sec"><h4>' + s.h + '</h4><p>' + s.b + '</p>' +
      (s.ex ? '<div class="example">💡 ' + s.ex + '</div>' : '') + '</div>'
    ).join('') +
    '<div class="rule">🛡️ <b>The Rule:</b> ' + l.tip + '</div>' +
    '<button class="btn big" id="btnStartQuiz">🚀 Start the Quiz!</button>' +
    '<div class="btn-row">' +
    '<button class="btn ghost" id="btnStory">📖 Ask the Fox to tell this as a story</button>' +
    '<button class="btn ghost" id="btnBack">← Back to lessons</button>' +
    '</div>';
  $('#btnStartQuiz').addEventListener('click', startQuiz);
  $('#btnStory').addEventListener('click', askStory);
  $('#btnBack').addEventListener('click', () => { switchView('home'); renderHome(); });
  $('#quizCard').innerHTML = '<div class="quiz-start">Read the lesson first, then press <b>🚀 Start the Quiz!</b></div>';
}

function startQuiz() {
  session.queue = session.lesson.questions.slice();
  session.index = 0;
  session.mistakes = 0;
  session.earned = 0;
  session.correct = 0;
  session.locked = false;
  renderQuestion();
}

function currentQ() { return session.queue[session.index]; }

function renderQuestion() {
  const q = currentQ();
  const left = session.queue.length - session.index;
  $('#quizCard').innerHTML =
    '<div class="quiz-top"><span>' + session.lesson.emoji + ' ' + session.lesson.title + ' · Question ' +
    (session.index + 1) + '/' + session.queue.length + '</span><span>⭐ earned: ' + session.earned + '</span></div>' +
    '<h3 class="q">' + q.q + '</h3>' +
    '<div class="opts">' + q.options.map((o, i) =>
      '<button class="opt" data-i="' + i + '"><span class="opt-key">' + 'ABCD'[i] + '</span><span>' + o + '</span></button>'
    ).join('') + '</div>' +
    '<div id="quizFeedback"></div>';
  $$('#quizCard .opt').forEach((b) => b.addEventListener('click', () => choose(+b.dataset.i)));
}

function choose(i) {
  if (!session || session.locked) return;
  const q = currentQ();
  if (i === q.answer) {
    const pts = questionPoints(session.mistakes);
    session.earned += pts;
    session.correct++;
    if (session.mistakes === 0) {
      state.streak++;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
    }
    session.locked = true;
    markOption(i, 'right');
    showCorrect(pts);
  } else {
    session.mistakes++;
    state.streak = 0;
    markOption(i, 'wrong');
    showWrong();
  }
}

function markOption(i, kind) {
  $$('#quizCard .opt').forEach((b) => {
    b.disabled = kind === 'right';
    if (+b.dataset.i === i) b.classList.add(kind);
  });
}

function showCorrect(pts) {
  const q = currentQ();
  saveState();
  $('#quizFeedback').innerHTML =
    '<div class="feedback win"><div class="fb-emoji">🎉</div><div><b>' + (pts >= SCORES.first ? 'Perfect!' : 'Got it!') +
    ' +' + pts + ' pts</b><div class="fb-why">' + q.why + '</div>' +
    (session.index + 1 < session.queue.length
      ? '</div></div><button class="btn big" id="btnNext">Next ➡️</button>'
      : '</div></div><button class="btn big" id="btnFinish">See my stars ⭐</button>') +
    '<button class="btn ghost small" id="btnAskExplain">🧠 Fox, explain it even simpler</button>' +
    '<div id="aiClip"></div>';
  $('#btnAskExplain').addEventListener('click', askExplainClip);
  (session.index + 1 < session.queue.length ? $('#btnNext') : $('#btnFinish')).addEventListener('click', next);
}

function showWrong() {
  $('#quizFeedback').innerHTML =
    '<div class="feedback lose"><div class="fb-emoji">🤔</div><div><b>Not quite — try again!</b>' +
    '<div class="fb-why">Hint: ' + session.lesson.tip + '</div></div></div>' +
    '<button class="btn big" id="btnReveal">👀 Show me the answer</button>';
  $('#btnReveal').addEventListener('click', revealAnswer);
}

function revealAnswer() {
  const q = currentQ();
  session.earned += SCORES.reveal;
  session.correct++;
  session.locked = true;
  state.streak = 0;
  markCorrectAll();
  showCorrect(SCORES.reveal);
}

function markCorrectAll() {
  $$('#quizCard .opt').forEach((b) => {
    b.disabled = true;
    if (+b.dataset.i === currentQ().answer) b.classList.add('right');
  });
}

async function askExplainClip() {
  const q = currentQ();
  const clip = $('#aiClip');
  clip.style.display = 'block';
  clip.innerHTML = '<div class="fox-typing">🦊 thinking…</div>';
  if (!AI.online) {
    clip.innerHTML = FALLBACK_AI.chooseMessage;
    return;
  }
  const res = await AI.explainAnswer(q, -1, q.answer);
  clip.innerHTML = res.ok ? '🦊 ' + res.text : '<span class="muted">' + res.error + '</span>';
}

function next() {
  session.index++;
  if (session.index >= session.queue.length) finishQuiz();
  else renderQuestion();
}

function finishQuiz() {
  const l = session.lesson;
  const firstTime = !state.done[l.id] && l.id !== 'surprise';
  let bonus = 0;
  let stars = 1;
  if (session.mistakes === 0) stars = 3;
  else if (session.mistakes <= 2) stars = 2;
  if (firstTime) bonus = SCORES.bonus;
  const total = session.earned + bonus;
  state.score += total;
  if (l.id !== 'surprise') state.done[l.id] = true;
  saveState();
  const lvl = getLevel(state.score);
  $('#scorePill').textContent = '⭐ ' + state.score + ' pts';
  $('#levelPill').textContent = lvl.level.emoji + ' ' + lvl.level.name;
  const starStr = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
  $('#quizCard').innerHTML =
    '<div class="quiz-summary">' +
    '<div class="fb-emoji">🏆</div>' +
    '<h2>' + starStr + '</h2>' +
    '<h3>' + (stars === 3 ? 'Amazing!' : stars === 2 ? 'Great job!' : 'Well done!') + '</h3>' +
    '<p class="muted">' + session.lesson.emoji + ' ' + session.lesson.title + '</p>' +
    '<div class="score-line">' +
    '<span>Answers right: <b>' + session.correct + '</b></span>' +
    '<span>Quiz points: <b>+' + session.earned + '</b></span>' +
    (bonus ? '<span>First-time bonus: <b>+' + bonus + '</b></span>' : '') +
    '</div>' +
    '<div class="big total">Total earned: <b>+' + total + '</b> ⭐</div>' +
    '<div class="muted">You are now ' + lvl.level.emoji + ' <b>' + lvl.level.name + '</b>' +
    (lvl.next ? ' · ' + lvl.progress + '% to ' + lvl.next.name : '') + '</div>' +
    '<div class="btn-row">' +
    '<button class="btn big" id="btnReplay">' + (l.id === 'surprise' ? '🎲 Another surprise quiz' : '🔁 Play again') + '</button>' +
    '<button class="btn big primary" id="btnHome">🏠 Home</button>' +
    '</div>' +
    (AI.online ? '<button class="btn ghost" id="btnFoxQ">➕ Ask the Fox for a brand-new question</button>' : '') +
    '</div>';
  $('#btnReplay').addEventListener('click', () => {
    if (l.id === 'surprise') startSurpriseQuiz();
    else { openLesson(l.id); startQuiz(); }
  });
  $('#btnHome').addEventListener('click', () => { switchView('home'); renderHome(); });
  const fx = $('#btnFoxQ');
  if (fx) fx.addEventListener('click', () => foxNewQuestion(l));
}

async function foxNewQuestion(l) {
  const qbtn = $('#btnFoxQ');
  qbtn.disabled = true;
  const res = await AI.generateQuestion(l);
  if (!res.ok) { toast(res.error || 'Fox failed to make a question.', 'toast-error'); qbtn.disabled = false; return; }
  session.queue.push(res.question);
  session.index = session.queue.length - 1;
  session.mistakes = 0;
  renderQuestion();
  toast('🦊 The Fox made you a brand-new question!', 'toast-ok');
}

async function askStory() {
  const btn = $('#btnStory');
  const clip = document.createElement('div');
  clip.className = 'fox-story';
  clip.innerHTML = '<div class="fox-typing">🦊 thinking up a story…</div>';
  btn.parentElement.appendChild(clip);
  if (!AI.online) {
    clip.innerHTML = '🦊 I need my brain awake for that. Plug in a brain in Brain settings (or install Ollama — see README), then try again!';
    return;
  }
  const res = await AI.story(session.lesson);
  clip.innerHTML = res.ok ? res.text : res.error;
}

function initChat() {
  addMsg('Hi! I am Professor Fox 🦊. Ask me anything about money, trading, shares, or your homework lesson. I explain everything in kid words!', 'fox');
}

function addMsg(text, who) {
  const box = $('#chatMessages');
  const el = document.createElement('div');
  el.className = 'msg ' + who;
  el.innerHTML = '<div class="bubble">' + (who === 'fox' ? '🦊 ' : '') + escapeHtml(text) + '</div>';
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toggleChat() { $('#chatShell').classList.toggle('hidden'); }
function closeChat() { $('#chatShell').classList.add('hidden'); }

async function onSend(e) {
  e.preventDefault();
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addMsg(text, 'user');
  if (!AI.online) {
    addMsg('My brain is asleep! Plug one in: open Brain settings (the pill up top) and choose a provider, or install Ollama — the README shows you how. Then press ↻ to wake me up.', 'fox');
    return;
  }
  const typing = addMsg('', 'fox typing');
  typing.querySelector('.bubble').innerHTML = '<div class="fox-typing"><span></span><span></span><span></span></div>';
  const res = await AI.chat([{ role: 'system', content: AI.SYSTEM }, { role: 'user', content: text }]);
  typing.remove();
  addMsg(res.ok ? res.text : res.error, 'fox');
}

async function connectBrain() {
  const pill = $('#brainPill');
  pill.textContent = '🧠 checking brain…';
  pill.classList.remove('on', 'off');
  const res = await AI.status();
  if (AI.online) {
    pill.textContent = '🧠 ' + AI.getProvider().name.split(' (')[0] + ' · ' + AI.model;
    pill.classList.add('on');
    $('#chatBrainStatus').textContent = '🧠 Brain online (' + AI.getProvider().name + ')';
    fillModelSelect();
  } else {
    pill.textContent = '🧠 Brain offline';
    pill.classList.add('off');
    $('#chatBrainStatus').textContent = '🧠 Offline: ' + (AI.lastError || 'connect a brain first.');
    fillModelSelect();
  }
  syncBrainSettings();
}

function populateProviders() {
  const sel = $('#chatProvider');
  sel.innerHTML = Object.keys(AI.PROVIDERS).map((id) => {
    const p = AI.PROVIDERS[id];
    return '<option value="' + id + '"' + (AI.cfg.provider === id ? ' selected' : '') + '>' + p.name + '</option>';
  }).join('');
  sel.addEventListener('change', () => {
    AI.cfg.provider = $('#chatProvider').value;
    AI.persist();
    syncBrainSettings();
    connectBrain();
  });
}

function syncBrainSettings() {
  const p = AI.getProvider();
  $('#keyWrap').classList.toggle('hidden', !p.needsKey);
  $('#baseWrap').classList.toggle('hidden', !p.editableBase);
  $('#inKey').value = AI.cfg.keys[p.id] || '';
  $('#inBase').value = AI.cfg.bases[p.id] || p.defaultBase;
  $('#inOther').value = AI.cfg.models[p.id] && !(AI.discovered || []).includes(AI.cfg.models[p.id]) ? AI.cfg.models[p.id] : '';
}

function fillModelSelect() {
  const sel = $('#chatModel');
  const pool = (AI.discovered && AI.discovered.length ? AI.discovered : AI.getProvider().catalog || []);
  if (!pool.length) { sel.innerHTML = '<option value="">(none found)</option>'; return; }
  sel.innerHTML = pool.map((m) => '<option value="' + escapeHtml(m) + '"' + (AI.model === m ? ' selected' : '') + '>' + escapeHtml(m) + '</option>').join('');
}

function saveBrainSettingsAndConnect() {
  const p = AI.getProvider();
  if (p.needsKey) {
    const k = $('#inKey').value.trim();
    if (k) AI.cfg.keys[p.id] = k;
  } else {
    AI.cfg.keys = AI.cfg.keys || {};
  }
  if (p.editableBase) {
    const b = $('#inBase').value.trim();
    AI.cfg.bases[p.id] = b || p.defaultBase;
  }
  const other = $('#inOther').value.trim();
  if (other) AI.setModel(other);
  AI.persist();
  connectBrain();
}

function boot() {
  renderHome();
  initChat();
  populateProviders();
  syncBrainSettings();
  fillModelSelect();
  connectBrain();
  $('#chatFab').addEventListener('click', toggleChat);
  $('#chatClose').addEventListener('click', closeChat);
  $('#chatForm').addEventListener('submit', onSend);
  $('#btnReconnect').addEventListener('click', saveBrainSettingsAndConnect);
  $('#btnReconnect2').addEventListener('click', saveBrainSettingsAndConnect);
  $('#chatModel').addEventListener('change', () => {
    const m = $('#chatModel').value;
    if (m) AI.setModel(m);
  });
  $('#btnAuth').addEventListener('click', submitAuth);
  $('#btnSurprise').addEventListener('click', startSurpriseQuiz);
  $('#btnGuest').addEventListener('click', guestMode);
  $('#btnSignOut').addEventListener('click', () => signOut('Signed out. See you soon, young trader!'));
  $$('#seg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    setSeg(b.dataset.mode);
    $('#password').value = '';
    $('#loginErr').textContent = '';
  }));
  loadConfig();
  loadServerLessons();
  initAuth();
}
/* ── Companion link ───────────────────────────────────────────────────────
   The Trading Companion needs the little server (it stores your knowledge base
   and proxies nothing else). If this page was opened straight off the disk as a
   file://, the link would go nowhere — so hide it and say why in the tooltip. */
(function () {
  // Defensive: this file also runs inside the test harness's minimal DOM stub,
  // where getElementById may not exist.
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const el = document.getElementById('companionLink');
  if (!el) return;
  const proto = (typeof window !== 'undefined' && window.location && window.location.protocol) || '';
  if (proto === 'file:') {
    el.style.display = 'none';
  } else {
    el.setAttribute('href', 'companion');
    el.addEventListener('mouseenter', function () {
      el.title = 'Trading Companion — feed it videos and links, then let it watch your charts and coach you live';
    });
  }
})();
