'use strict';

const AI = {};

(function () {
  const STORE_KEY = 'ai';

  function loadStore(k, d) {
    try { const v = localStorage.getItem('pf_' + k); return v === null ? d : JSON.parse(v); } catch { return d; }
  }
  function saveStore(k, v) {
    try { localStorage.setItem('pf_' + k, JSON.stringify(v)); } catch {}
  }

  const fetchFn = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : (globalThis && globalThis.fetch ? globalThis.fetch.bind(globalThis) : null);

  async function httpJson(url, opts) {
    if (!fetchFn) throw new Error('No fetch available in this environment');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), (opts && opts.timeout) || 240000);
    try {
      const res = await fetchFn(url, Object.assign({ signal: ctl.signal }, opts && opts.init));
      if (!res.ok) {
        let body = '';
        try { body = (await res.text()).slice(0, 300); } catch {}
        throw new Error('HTTP ' + res.status + (body ? ' — ' + body : ''));
      }
      return await res.json();
    } finally { clearTimeout(t); }
  }

  const PROVIDERS = {
    ollama: {
      id: 'ollama',
      name: 'Ollama (free, on your PC)',
      needsKey: false,
      editableBase: true,
      defaultBase: 'http://localhost:11434',
      catalog: [],
      async listModels(ctx) {
        try {
          const j = await httpJson((ctx.base || this.defaultBase) + '/api/tags', { timeout: 7000 });
          const models = (j.models || []).map(m => m.name);
          return { ok: true, models };
        } catch (e) { return { ok: false, models: [], error: e.message }; }
      },
      async chat(ctx, messages) {
        const j = await httpJson((ctx.base || this.defaultBase) + '/api/chat', {
          timeout: 240000,
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: ctx.model, messages: messages, stream: false, temperature: 0.7 })
          }
        });
        return { ok: true, text: (j.message && j.message.content) || '' };
      }
    },
    lmstudio: openAICompatible('lmstudio', 'LM Studio (free, on your PC)', false, true, 'http://localhost:1234/v1', []),
    openai: openAICompatible('openai', 'OpenAI (ChatGPT)', true, false, 'https://api.openai.com/v1',
      ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-3.5-turbo']),
    groq: openAICompatible('groq', 'Groq (free tier)', true, false, 'https://api.groq.com/openai/v1',
      ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'mixtral-8x7b-32768']),
    openrouter: openAICompatible('openrouter', 'OpenRouter (many models)', true, false, 'https://openrouter.ai/api/v1',
      ['openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct', 'anthropic/claude-3.5-haiku', 'google/gemini-2.0-flash-lite']),
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      needsKey: true,
      editableBase: false,
      defaultBase: 'https://api.anthropic.com',
      catalog: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest', 'claude-3-haiku', 'claude-sonnet-4-20250514'],
      async listModels(ctx) {
        try {
          const j = await httpJson((ctx.base || this.defaultBase) + '/v1/models', {
            timeout: 7000,
            init: { headers: { 'x-api-key': ctx.key || '', 'anthropic-version': '2023-06-01' } }
          });
          const models = (j.data || []).map(m => m.id).filter(Boolean);
          return { ok: true, models };
        } catch (e) { return { ok: false, models: this.catalog, error: e.message }; }
      },
      async chat(ctx, messages) {
        const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
        const rest = messages.filter(m => m.role !== 'system');
        const j = await httpJson((ctx.base || this.defaultBase) + '/v1/messages', {
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.key || '', 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: ctx.model, max_tokens: 800, system: sys, messages: rest, temperature: 0.7 })
          }
        });
        const text = (j.content || []).filter(p => p.type === 'text').map(p => p.text).join('\n');
        return { ok: true, text };
      }
    },
    gemini: {
      id: 'gemini',
      name: 'Google Gemini (free tier)',
      needsKey: true,
      editableBase: false,
      defaultBase: 'https://generativelanguage.googleapis.com',
      catalog: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-2.5-pro'],
      async listModels(ctx) { return { ok: true, models: this.catalog }; },
      async chat(ctx, messages) {
        const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
        const contents = messages
          .filter(m => m.role !== 'system')
          .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
        const base = (ctx.base || this.defaultBase) + '/v1beta/models/';
        const id = encodeURIComponent(ctx.model);
        const j = await httpJson(base + id + ':generateContent?key=' + encodeURIComponent(ctx.key || ''), {
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: contents, generationConfig: { temperature: 0.7 } })
          }
        });
        const text = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts || [])
          .map(p => p.text || '').join('\n');
        return { ok: true, text };
      }
    }
  };

  function openAICompatible(id, name, needsKey, editableBase, defaultBase, catalog) {
    return {
      id, name, needsKey, editableBase, defaultBase, catalog,
      async listModels(ctx) {
        const base = (ctx.base || this.defaultBase);
        const headers = { 'Content-Type': 'application/json' };
        if (ctx.key) headers.Authorization = 'Bearer ' + ctx.key;
        try {
          const j = await httpJson(base + '/models', { timeout: 7000, init: { headers } });
          const list = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
          const models = list.map(m => m.id || m.name).filter(Boolean);
          return { ok: true, models };
        } catch (e) { return { ok: false, models: this.catalog, error: e.message }; }
      },
      async chat(ctx, messages) {
        const j = await httpJson((ctx.base || this.defaultBase) + '/chat/completions', {
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (ctx.key || '') },
            body: JSON.stringify({ model: ctx.model, messages: messages, temperature: 0.7, stream: false })
          }
        });
        const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
        return { ok: true, text };
      }
    };
  }

  const PREF = {
    ollama: ['llama3.2', 'llama3.1', 'llama3', 'mistral', 'qwen2.5', 'gemma2', 'tinyllama', 'phi3', 'llava', 'phi'],
    openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
    groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'],
    openrouter: ['openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct'],
    anthropic: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'],
    gemini: ['gemini-2.0-flash', 'gemini-2.5-flash'],
    lmstudio: []
  };

  AI.PROVIDERS = PROVIDERS;

  AI.cfg = Object.assign({ provider: 'ollama', keys: {}, bases: {}, models: {} }, loadStore(STORE_KEY, {}));

  AI.persist = function () { saveStore(STORE_KEY, AI.cfg); };

  AI.getProvider = function () { return PROVIDERS[AI.cfg.provider] || PROVIDERS.ollama; };

  AI.providerBase = function () { const p = AI.getProvider(); return (AI.cfg.bases[p.id] || '').trim() || p.defaultBase; };

  AI.status = async function () {
    const p = AI.getProvider();
    const key = (AI.cfg.keys[p.id] || '').trim();
    if (p.needsKey && !key) {
      AI.online = false; AI.discovered = p.catalog || []; AI.model = AI.cfg.models[p.id] || (p.catalog || [])[0];
      AI.lastError = 'Add your API key in Brain settings to wake the fox.';
      return { ok: false, error: AI.lastError };
    }
    const list = await p.listModels({ base: AI.providerBase(), key });
    AI.discovered = list.models || [];
    const pool = (list.ok && list.models.length) ? list.models : (p.catalog || []);
    if (!sourceHas(pool, AI.cfg.models[p.id])) AI.model = pickModel(p.id, pool);
    else AI.model = AI.cfg.models[p.id];
    AI.online = list.ok && !!AI.model;
    AI.lastError = list.error || (AI.online ? '' : 'Could not reach the brain server. Check it is running and the address is right.');
    return { ok: AI.online, error: AI.lastError, models: AI.discovered, model: AI.model, provider: p.id, providerName: p.name };
  };

  function sourceHas(pool, m) { return !!m && pool.some(x => x === m); }

  function pickModel(pId, pool) {
    const listed = PREF[pId] || [];
    for (const pref of listed) { const m = pool.find(x => x === pref || x.startsWith(pref + ':')); if (m) return m; }
    return pool[0] || (PROVIDERS[pId].catalog || [])[0] || null;
  }

  AI.setModel = function (m) {
    if (!m) return;
    AI.model = m;
    AI.cfg.models[AI.getProvider().id] = m;
    AI.persist();
  };

  AI.chat = async function (messages) {
    if (!AI.online) return { ok: false, error: AI.lastError || 'Brain offline.' };
    const p = AI.getProvider();
    try {
      const res = await p.chat({ base: AI.providerBase(), key: (AI.cfg.keys[p.id] || '').trim(), model: AI.model }, messages.slice(0));
      if (!res.ok || !res.text) { AI.online = false; AI.lastError = 'The brain replied with an empty answer.'; return { ok: false, error: AI.lastError }; }
      return { ok: true, text: res.text.trim() };
    } catch (e) {
      AI.online = false;
      AI.lastError = 'Brain error: ' + e.message;
      return { ok: false, error: AI.lastError };
    }
  };

  AI.SYSTEM = 'You are Professor Fox, a friendly robot fox who teaches kids (10-year-olds) about money and trading. ' +
    'Talk in short sentences with easy words. Use fun examples: lemonade stands, piggy banks, trading cards, playground games. ' +
    'Never tell kids to spend real money or take big risks. Always remind them to practise with pretend money first. ' +
    'Be positive, kind, and never boring. Keep answers under about 140 words unless the child asks for a long one. ' +
    'This is education, not financial advice.';

  AI.ask = async function (system, user) {
    if (!AI.online) return { ok: false, error: AI.lastError || 'Brain offline.' };
    return AI.chat([{ role: 'system', content: system }, { role: 'user', content: user }]);
  };

  AI.explainAnswer = async function (q, chosenIdx, correctIdx) {
    const user = 'A 10-year-old answered a quiz question wrong. Be super kind, super simple, 2 short sentences.\n' +
      'Question: ' + q.q + '\n' +
      'Options: ' + q.options.map(function (o, i) { return (i === chosenIdx ? 'CHOSE ' : '') + o; }).join(' | ') + '\n' +
      'They chose: "' + q.options[chosenIdx] + '"\nCorrect answer: "' + q.options[correctIdx] + '"\n' +
      'Explain why the correct one is right and the chosen one is wrong. No jargon.';
    return AI.ask(AI.SYSTEM, user);
  };

  AI.explainTerm = async function (term) {
    return AI.ask(AI.SYSTEM, 'Explain "' + term + '" to a 10-year-old in 3 or 4 light-hearted sentences with a tiny example. No big words.');
  };

  AI.story = async function (lesson) {
    const user = 'Tell a short bedtime-style story (max 200 words) that teaches a 10-year-old this lesson: "' +
      lesson.title + ' — ' + lesson.easy + '". Use a fun character and a playground or shop setting. End with the one big rule of the lesson.';
    return AI.ask(AI.SYSTEM, user);
  };

  AI.generateQuestion = async function (lesson) {
    const topic = lesson.easy + ' ' + (lesson.sections[0] ? lesson.sections[0].h : '') + ' ' + lesson.tip;
    const sys = 'You make one multiple-choice quiz question for a 10-year-old learning about trading and money. Simple words only.';
    const user = 'Make ONE brand-new quiz question about this lesson: "' + lesson.title + '".\nSummary: ' + topic + '\n' +
      'Rules:\n- A brand-new little scenario or analogy (NOT a plain recap of the reading).\n- 4 options, exactly one clearly correct.\n- Return ONLY JSON, nothing else, in this shape: ' +
      '{"q":"question text","options":["a","b","c","d"],"answer":0,"why":"short kid-friendly explanation of why the answer is right"}.\n' +
      '- "answer" is the index (0,1,2,3) of the correct option.';
    const res = await AI.ask(sys, user);
    if (!res.ok) return res;
    const q = parseQuestionJSON(res.text);
    if (!q) return { ok: false, error: 'The brain sent a question I could not read. Try again.' };
    return { ok: true, question: q };
  };

  function parseQuestionJSON(raw) {
    let text = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    if (!data) {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { data = JSON.parse(m[0]); } catch {} }
    }
    if (!data || typeof data !== 'object') return null;
    const q = String(data.q || '').trim();
    const options = Array.isArray(data.options) && data.options.length === 4 ? data.options.map(function (o) { return String(o).trim(); }) : null;
    const answer = Number(data.answer);
    if (!q || !options || !options.every(Boolean) || isNaN(answer) || answer < 0 || answer > 3) return null;
    return { q: q, options: options, answer: answer, why: String(data.why || '').trim() || 'The fox says: trust the lesson rule.' };
  }

  if (typeof globalThis !== 'undefined') globalThis.AI = AI;
  if (typeof window !== 'undefined') window.AI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})();