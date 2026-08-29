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

const auth = { token: Store.get('token') || null, user: Store.get('user') || null };

let syncT = null;

function saveState() { Store.set('state', state); scheduleSync(); }

async function apiFetch(path, opts) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), (opts && opts.timeout) || 6000);
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
    timeout: 8000
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
  const h = await apiFetch('/api/health');
  if (!h.ok) {
    toast('🦊 Server offline — running as guest. Progress stays on this device. Start the server (node server.js) or use a hosted link to log in.', 'toast-error');
    return;
  }
  if (auth.token) {
    const r = await apiFetch('/api/me', { headers: { 'Authorization': 'Bearer ' + auth.token } });
    if (r.ok) { applyServerProgress(r.data.progress); setSignedIn(r.data.user); }
    else if (r.status === 401) { auth.token = null; Store.set('token', null); auth.user = null; Store.set('user', null); showLogin(); }
    else showLogin();
  } else {
    showLogin();
  }
}

function showLogin() {
  $('#loginScreen').classList.remove('hidden');
}

function setSignedIn(user) {
  auth.user = user;
  Store.set('user', user);
  $('#userPill').textContent = '👤 ' + user;
  $('#userPill').classList.remove('hidden');
  $('#btnSignOut').classList.remove('hidden');
  $('#loginScreen').classList.add('hidden');
  renderHome();
  syncNow();
  toast('Welcome, ' + user + '! Your levels are saved to your account. 🎉', 'toast-ok');
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
  const r = await apiFetch('/api/' + mode, { method: 'POST', body: JSON.stringify({ username: u, password: pw }), timeout: 15000 });
  $('#btnAuth').disabled = false;
  $('#btnAuth').textContent = mode === 'login' ? 'Sign in 🚀' : 'Create account 🎉';
  if (!r.ok) { err.textContent = r.error || 'Could not reach the server.'; return; }
  auth.token = r.data.token;
  Store.set('token', auth.token);
  applyServerProgress(r.data.progress || null);
  setSignedIn(r.data.user);
}

function guestMode() {
  $('#loginScreen').classList.add('hidden');
  renderHome();
  toast('Guest mode — progress stays in this browser. Create an account to keep it anywhere!', 'toast-error');
}

function signOut(msg) {
  auth.token = null;
  auth.user = null;
  Store.set('token', null);
  Store.set('user', null);
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
  window.scrollTo(0, 0);
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
  grid.innerHTML = LESSONS.map((l) => lessonCard(l)).join('');
  grid.querySelectorAll('.lesson-card').forEach((el) => el.addEventListener('click', () => openLesson(el.dataset.id)));
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

function openLesson(id) {
  const lesson = LESSONS.find((l) => l.id === id);
  if (!lesson) return;
  session = { lesson, index: -1, mistakes: 0, earned: 0, correct: 0, queue: [], locked: false };
  renderLesson();
  switchView('lesson');
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
  const firstTime = !state.done[l.id];
  let bonus = 0;
  let stars = 1;
  if (session.mistakes === 0) stars = 3;
  else if (session.mistakes <= 2) stars = 2;
  if (firstTime) bonus = SCORES.bonus;
  const total = session.earned + bonus;
  state.score += total;
  state.done[l.id] = true;
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
    '<button class="btn big" id="btnReplay">🔁 Play again</button>' +
    '<button class="btn big primary" id="btnHome">🏠 Home</button>' +
    '</div>' +
    (AI.online ? '<button class="btn ghost" id="btnFoxQ">➕ Ask the Fox for a brand-new question</button>' : '') +
    '</div>';
  $('#btnReplay').addEventListener('click', () => { openLesson(l.id); startQuiz(); });
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
  $('#btnGuest').addEventListener('click', guestMode);
  $('#btnSignOut').addEventListener('click', () => signOut('Signed out. See you soon, young trader!'));
  $$('#seg .seg-btn').forEach((b) => b.addEventListener('click', () => {
    setSeg(b.dataset.mode);
    $('#password').value = '';
    $('#loginErr').textContent = '';
  }));
  initAuth();
}