/* 理化課程站共用引擎：讀 curriculum.json、題庫與重點卡，產生首頁、章、節三種頁面。
 * localStorage 一律用 pc- 前綴（見 CLAUDE.md）。 */
(function () {
  'use strict';

  const DATA = 'data/';
  const EDITION = 'school';
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];

  /* ---------- 儲存（失敗時退回記憶體） ---------- */
  const mem = {};
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('pc-' + k); return v === null ? d : JSON.parse(v); }
      catch (e) { return k in mem ? mem[k] : d; }
    },
    set(k, v) {
      mem[k] = v;
      try { localStorage.setItem('pc-' + k, JSON.stringify(v)); } catch (e) { /* 無痕模式等情況，略過 */ }
    }
  };

  /* ---------- 小工具 ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  const getText = url => fetch(url, { cache: 'no-cache' }).then(r => (r.ok ? r.text() : ''));
  const param = k => new URLSearchParams(location.search).get(k);
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function md(src) { return window.marked ? window.marked.parse(src) : '<pre>' + esc(src) + '</pre>'; }

  /* ---------- 課程索引 ---------- */
  let CUR, SITE;
  const kcIndex = {}; // kcId -> {kc, code, axis}
  function indexCurriculum(cur) {
    for (const ax of cur.axes) for (const c of ax.codes) for (const kc of c.kcs) kcIndex[kc.id] = { kc, code: c, axis: ax };
  }
  function allSections() {
    const out = [];
    for (const sem of CUR.editions[EDITION].semesters)
      for (const ch of sem.chapters)
        for (const s of ch.sections) out.push({ sem, ch, s });
    return out;
  }
  function findChapter(id) {
    for (const sem of CUR.editions[EDITION].semesters) for (const ch of sem.chapters) if (ch.id === id) return { sem, ch };
    return null;
  }
  function codesOf(kcIds) { return [...new Set(kcIds.map(k => kcIndex[k] && kcIndex[k].code.code).filter(Boolean))]; }

  /* 載入一組 kc 的題目，依 kc 在清單中的順序排列；預測題排最前面 */
  async function loadQuestions(kcIds) {
    const files = await Promise.all(codesOf(kcIds).map(c => getJSON(DATA + 'questions/' + c + '.json').catch(() => [])));
    const qs = files.flat().filter(q => kcIds.includes(q.kc));
    qs.forEach(q => { q.code = kcIndex[q.kc].code.code; });
    return qs.sort((a, b) => (b.predict ? 1 : 0) - (a.predict ? 1 : 0) || kcIds.indexOf(a.kc) - kcIds.indexOf(b.kc));
  }

  /* ---------- 身分與作答回收 ---------- */
  function identity() { return store.get('id', null); }
  function idLabel() { const id = identity(); return id && id.cls ? id.cls + ' 班 ' + id.seat + ' 號' : '未設定（作答只存在這台裝置）'; }

  function askIdentity(onDone) {
    const cur = identity() || {};
    const box = document.createElement('div');
    box.className = 'fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50';
    box.innerHTML =
      '<form class="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 text-base">' +
      '<h2 class="text-xl font-bold text-slate-800">輸入班級與座號</h2>' +
      '<p class="text-slate-600 text-sm">老師用來看全班哪裡卡住。不需要姓名。</p>' +
      '<label class="block">班級（例如 801）<input name="cls" inputmode="numeric" pattern="[0-9]{3}" required class="mt-1 w-full border rounded-lg px-3 py-3 text-base" value="' + esc(cur.cls || '') + '"></label>' +
      '<label class="block">座號<input name="seat" type="number" min="1" max="40" required class="mt-1 w-full border rounded-lg px-3 py-3 text-base" value="' + esc(cur.seat || '') + '"></label>' +
      '<div class="flex gap-3"><button class="flex-1 bg-sky-600 text-white rounded-lg py-3 font-bold">確定</button>' +
      '<button type="button" data-skip class="flex-1 bg-slate-100 text-slate-600 rounded-lg py-3">先不要</button></div></form>';
    document.body.appendChild(box);
    const f = box.querySelector('form');
    f.addEventListener('submit', e => {
      e.preventDefault();
      store.set('id', { cls: f.cls.value.trim(), seat: String(parseInt(f.seat.value, 10)) });
      box.remove(); onDone && onDone(); flush();
    });
    box.querySelector('[data-skip]').addEventListener('click', () => { store.set('id', { skipped: true }); box.remove(); onDone && onDone(); });
  }

  function record(item) {
    const id = identity();
    if (!SITE.submitUrl || !id || !id.cls) return;
    const q = store.get('queue', []);
    q.push(Object.assign({ cls: id.cls, seat: id.seat, ts: new Date().toISOString() }, item));
    store.set('queue', q.slice(-500));
    flush();
  }
  let flushing = false;
  function flush() {
    if (flushing || !SITE || !SITE.submitUrl) return;
    const q = store.get('queue', []);
    if (!q.length) return;
    flushing = true;
    const batch = q.slice(0, 50);
    // text/plain 不會觸發 CORS 預檢；no-cors 拿不到回應，網路沒出錯就視為送達
    fetch(SITE.submitUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ v: 1, items: batch }) })
      .then(() => { store.set('queue', store.get('queue', []).slice(batch.length)); })
      .catch(() => { /* 離線：留在佇列，下次再送 */ })
      .finally(() => { flushing = false; if (store.get('queue', []).length && navigator.onLine) setTimeout(flush, 1000); });
  }
  window.addEventListener('online', flush);

  /* ---------- 進度 ---------- */
  function progress() { return store.get('prog', {}); }
  function saveFirst(qid, ok) {
    const p = progress();
    if (!p[qid]) { p[qid] = { ok, n: 1 }; } else { p[qid].n++; p[qid].last = ok; }
    store.set('prog', p);
  }
  function sectionStats(qids) {
    const p = progress();
    const done = qids.filter(id => p[id]);
    return { total: qids.length, done: done.length, ok: done.filter(id => p[id].ok).length };
  }

  /* ---------- 題目元件 ---------- */
  function renderQuestion(q, no, ctx) {
    const el = document.createElement('div');
    el.className = 'bg-white rounded-2xl border border-slate-200 p-5 shadow-sm';
    const opts = shuffle(q.options.map((o, i) => Object.assign({ i }, o)));
    const tags = '<span class="tag" title="這一題考的是哪一個表徵層">' + esc(q.rep) + '</span>'; // 難度 level 只給老師看，不顯示
    el.innerHTML =
      (q.predict ? '<div class="text-amber-700 font-bold text-sm mb-2">先預測再操作</div>' : '') +
      '<div class="flex items-start gap-2 mb-3"><span class="font-bold text-slate-400">' + no + '.</span>' +
      '<p class="font-medium text-slate-800 leading-relaxed">' + esc(q.stem) + '</p></div>' +
      '<div class="space-y-2" data-opts>' +
      opts.map((o, k) => '<button type="button" class="opt" data-i="' + o.i + '"><b>' + LETTERS[k] + '</b><span>' + esc(o.t) + '</span></button>').join('') +
      '</div><div data-fb class="mt-3"></div><div class="mt-3 flex gap-1">' + tags + '</div>';
    const t0 = Date.now();
    el.querySelectorAll('.opt').forEach(btn => btn.addEventListener('click', () => {
      if (el.dataset.locked) return;
      el.dataset.locked = '1';
      const chosen = q.options[+btn.dataset.i];
      const ok = !!chosen.ok;
      btn.classList.add('chosen');
      const prev = progress()[q.id];
      const attempt = prev ? prev.n + 1 : 1; // 這一題第幾次作答（跨頁面造訪累計）
      saveFirst(q.id, ok);
      record({ qid: q.id, kc: q.kc, code: q.code, page: ctx.page, choice: +btn.dataset.i, ok, mis: ok ? '' : (chosen.mis || ''), predict: !!q.predict, attempt, ms: Date.now() - t0 });
      const reveal = () => {
        el.querySelectorAll('.opt').forEach(b => {
          const o = q.options[+b.dataset.i];
          if (o.ok) b.classList.add('right'); else if (b === btn) b.classList.add('wrong'); else b.classList.add('dim');
        });
        el.querySelector('[data-fb]').innerHTML =
          '<div class="fb ' + (ok ? 'fb-ok' : 'fb-no') + '">' +
          '<p class="font-bold mb-1">' + (ok ? '答對了' : '再想想。常見迷思：' + esc(chosen.mis)) + '</p>' +
          (ok ? '' : '<p class="mb-2">' + esc(chosen.why) + '</p>') +
          '<p>' + esc(q.explain) + '</p></div>';
        ctx.onAnswer && ctx.onAnswer();
      };
      if (q.predict) {
        el.querySelector('[data-fb]').innerHTML =
          '<div class="fb fb-wait"><p class="mb-2">記住你的預測。先去做下面的模擬，再回來揭曉。</p>' +
          '<button type="button" class="btn-sm" data-reveal>我做完了，揭曉答案</button></div>';
        el.querySelector('[data-reveal]').addEventListener('click', reveal);
      } else reveal();
    }));
    return el;
  }

  function renderQuiz(container, qs, page, title) {
    container.innerHTML = '';
    let answered = 0;
    const summary = document.createElement('div');
    const update = () => {
      answered++;
      if (answered < qs.length) return;
      const p = progress();
      const ok = qs.filter(q => p[q.id] && p[q.id].ok).length;
      summary.innerHTML = '<div class="bg-sky-50 border border-sky-200 rounded-2xl p-5 text-center">' +
        '<p class="text-lg font-bold text-sky-800 mb-1">' + esc(title) + '完成</p>' +
        '<p class="text-slate-600 mb-3">第一次作答答對 ' + ok + ' / ' + qs.length + ' 題</p>' +
        '<button type="button" class="btn-sm" data-redo>題目重新排列，再做一次</button></div>';
      summary.querySelector('[data-redo]').addEventListener('click', () => { renderQuiz(container, shuffle(qs), page, title); container.scrollIntoView({ behavior: 'smooth' }); });
    };
    qs.forEach((q, i) => container.appendChild(renderQuestion(q, i + 1, { page, onAnswer: update })));
    container.appendChild(summary);
  }

  /* ---------- 常見難題（資料在 data/problems.json，作圖引擎在 assets/engines.js） ---------- */
  let PROBS = null;
  async function loadProblems() {
    if (!PROBS) {
      const [ps, sk] = await Promise.all([getJSON(DATA + 'problems.json').catch(() => []), getJSON(DATA + 'skills.json').catch(() => [])]);
      PROBS = { ps, sk };
    }
    return PROBS;
  }
  function problemLinks(ps) {
    const p = progress();
    return ps.map(pr => '<a href="problem.html?p=' + encodeURIComponent(pr.id) + '" class="flex items-center gap-3 bg-white rounded-2xl border border-slate-200 p-4 card-hover min-h-[44px]">' +
      '<span class="font-medium text-slate-800">' + esc(pr.title) + '</span>' +
      '<span class="ml-auto text-sm ' + (p[pr.id] ? 'text-emerald-700' : 'text-slate-400') + '">' + (p[pr.id] ? '已預測' : '未作答') + '</span><span class="text-sky-600">→</span></a>').join('');
  }
  function problemsBlock(ps, note) {
    if (!ps.length) return '';
    return '<h2 class="sec-h">常見難題</h2><p class="text-slate-600 text-sm mb-3">' + esc(note) + '</p><div class="space-y-2 mb-8">' + problemLinks(ps) + '</div>';
  }

  /* ---------- 頁首 ---------- */
  function header(crumbs) {
    const h = $('#hdr');
    h.innerHTML =
      '<div class="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2 text-sm">' +
      crumbs.map(c => c.href ? '<a class="text-sky-700 hover:underline" href="' + c.href + '">' + esc(c.t) + '</a>' : '<span class="text-slate-500">' + esc(c.t) + '</span>').join('<span class="text-slate-300">/</span>') +
      '<button type="button" id="who" class="ml-auto text-slate-500 underline decoration-dotted min-h-[44px]">' + esc(idLabel()) + '</button></div>';
    $('#who').addEventListener('click', () => askIdentity(() => { $('#who').textContent = idLabel(); }));
  }

  /* ---------- 三種頁面 ---------- */
  function pageIndex() {
    header([{ t: '理化教學互動網', href: 'https://cwkuo99.github.io/test/' }, { t: '課程' }]);
    const main = $('#main');
    const sems = CUR.editions[EDITION].semesters;
    main.innerHTML = '<h1 class="text-2xl font-bold text-slate-800 mb-2">依章節學習</h1>' +
      '<p class="text-slate-600 mb-6">每一節有重點、模擬和快速檢核。檢核只是看看自己學會了沒有，不計分。</p>' +
      '<a href="problems.html" class="block bg-white rounded-2xl border border-slate-200 p-5 mb-6 card-hover">' +
      '<p class="text-lg font-bold text-slate-800">常見難題</p><p class="text-sm text-slate-500 mt-1">先預測，再用動態解析一步一步拆開容易錯的題目。</p></a>' +
      sems.map(sem => '<section class="mb-6"><h2 class="font-bold text-slate-700 mb-2">' + esc(sem.name) + '</h2>' +
        (sem.chapters.length ? sem.chapters.map(ch => {
          return '<a href="chapter.html?c=' + esc(ch.id) + '" class="block bg-white rounded-2xl border border-slate-200 p-5 mb-2 card-hover">' +
            '<p class="text-sm text-slate-500">第 ' + ch.no + ' 章</p><p class="text-lg font-bold text-slate-800">' + esc(ch.name) + '</p>' +
            '<p class="text-sm text-slate-500 mt-1">' + ch.sections.map(s => esc(s.no + ' ' + s.name)).join('・') + '</p></a>';
        }).join('') : '<p class="text-slate-400 text-sm">建置中</p>') + '</section>').join('');
  }

  async function pageChapter() {
    const found = findChapter(param('c'));
    if (!found) return notFound();
    const { sem, ch } = found;
    document.title = '第 ' + ch.no + ' 章 ' + ch.name + '｜理化課程';
    header([{ t: '課程', href: 'index.html' }, { t: sem.name }, { t: '第 ' + ch.no + ' 章' }]);
    const allKcs = ch.sections.flatMap(s => s.kcs);
    const [qs, P] = await Promise.all([loadQuestions(allKcs), loadProblems()]);
    const chProbs = P.ps.filter(pr => pr.chapter === ch.id);
    const main = $('#main');
    main.innerHTML = '<p class="text-sm text-slate-500">' + esc(sem.name) + '・第 ' + ch.no + ' 章</p>' +
      '<h1 class="text-2xl font-bold text-slate-800 mb-4">' + esc(ch.name) + '</h1><div class="space-y-2 mb-8">' +
      ch.sections.map(s => {
        const st = sectionStats(qs.filter(q => s.kcs.includes(q.kc)).map(q => q.id));
        const pct = st.total ? Math.round(st.done / st.total * 100) : 0;
        return '<a href="section.html?s=' + esc(s.id) + '" class="block bg-white rounded-2xl border border-slate-200 p-5 card-hover">' +
          '<div class="flex items-baseline gap-2"><span class="font-bold text-sky-700">' + esc(s.no) + '</span><span class="font-bold text-slate-800">' + esc(s.name) + '</span>' +
          '<span class="ml-auto text-sm text-slate-500">' + (st.total ? (st.done ? '答對 ' + st.ok + ' / ' + st.total : st.total + ' 題') : '檢核題建置中') + '</span></div>' +
          '<div class="h-2 bg-slate-100 rounded mt-3"><div class="h-2 bg-sky-500 rounded" style="width:' + pct + '%"></div></div></a>';
      }).join('') + '</div>' +
      problemsBlock(chProbs, '整章學完後挑戰。先預測，再看動態解析。') +
      '<h2 class="text-xl font-bold text-slate-800 mb-1">章末檢核</h2><p class="text-slate-600 mb-4 text-sm">每節隨機抽 2 題，不含預測題。</p><div id="quiz" class="space-y-4"></div>';
    const pick = ch.sections.flatMap(s => shuffle(qs.filter(q => s.kcs.includes(q.kc) && !q.predict)).slice(0, 2));
    if (pick.length) renderQuiz($('#quiz'), pick, ch.id, '章末檢核');
    else $('#quiz').innerHTML = '<p class="text-slate-400">本章檢核題建置中。</p>';
  }

  async function pageSection() {
    const hit = allSections().find(x => x.s.id === param('s'));
    if (!hit) return notFound();
    const { sem, ch, s } = hit;
    document.title = s.no + ' ' + s.name + '｜理化課程';
    header([{ t: '課程', href: 'index.html' }, { t: '第 ' + ch.no + ' 章 ' + ch.name, href: 'chapter.html?c=' + ch.id }, { t: s.no }]);
    const [qs, cards, P] = await Promise.all([
      loadQuestions(s.kcs),
      s.draft ? Promise.resolve([]) : Promise.all(s.kcs.map(k => getText('content/' + k + '.md'))), // draft 節的重點卡還沒寫，不去要檔案
      loadProblems()
    ]);
    const secProbs = P.ps.filter(pr => pr.kcs.some(k => s.kcs.includes(k)));
    const hasCards = cards.some(Boolean);
    const codes = codesOf(s.kcs).map(c => {
      const x = Object.values(kcIndex).find(v => v.code.code === c);
      return '<span class="tag" title="' + esc(x.code.text) + '">' + esc(c) + '</span>';
    }).join('');
    const axis = [...new Set(s.kcs.map(k => kcIndex[k].axis.name))].join('、');
    const predict = qs.filter(q => q.predict), check = qs.filter(q => !q.predict);
    const main = $('#main');
    main.innerHTML =
      '<p class="text-sm text-slate-500">' + esc(sem.name) + '・第 ' + ch.no + ' 章 ' + esc(ch.name) + '</p>' +
      '<h1 class="text-2xl font-bold text-slate-800">' + esc(s.no + ' ' + s.name) + '</h1>' +
      '<div class="flex flex-wrap gap-1 mt-2 mb-6"><span class="tag tag-axis">' + esc(axis) + '</span>' + codes + '</div>' +
      (predict.length ? '<h2 class="sec-h">先猜猜看</h2><div id="pred" class="space-y-4 mb-8"></div>' : '') +
      '<h2 class="sec-h">重點</h2><div class="space-y-4 mb-8">' +
      (hasCards ? cards.map((c, i) => c ? '<article class="card-md bg-white rounded-2xl border border-slate-200 p-5">' + md(c) + '</article>' : '').join('')
        : '<p class="text-slate-400">本節重點卡建置中。</p>') + '</div>' +
      (s.sims && s.sims.length ? '<h2 class="sec-h">動手模擬</h2><div class="space-y-2 mb-8">' +
        s.sims.map(m => '<a href="' + esc(m.href) + '" class="flex items-center gap-3 bg-white rounded-2xl border border-slate-200 p-4 card-hover min-h-[44px]"><span class="text-2xl">🧪</span><span class="font-medium text-slate-800">' + esc(m.title) + '</span><span class="ml-auto text-sky-600">→</span></a>').join('') + '</div>' : '') +
      problemsBlock(secProbs, '學完本節後挑戰。先預測，再看動態解析。') +
      '<h2 class="sec-h">快速檢核</h2><p class="text-slate-600 text-sm mb-4">答錯沒關係，看看自己是不是有這些常見的想法。</p><div id="quiz" class="space-y-4"></div>' +
      nav(hit);
    if (predict.length) predict.forEach((q, i) => $('#pred').appendChild(renderQuestion(q, i + 1, { page: s.id })));
    if (check.length) renderQuiz($('#quiz'), check, s.id, s.no + ' 檢核');
    else $('#quiz').innerHTML = '<p class="text-slate-400">本節檢核題建置中。</p>';
  }

  function nav(hit) {
    const secs = hit.ch.sections, i = secs.indexOf(hit.s);
    const prev = secs[i - 1], next = secs[i + 1];
    return '<div class="flex gap-3 mt-10">' +
      (prev ? '<a class="nav-btn" href="section.html?s=' + prev.id + '">← ' + esc(prev.no) + '</a>' : '<span class="flex-1"></span>') +
      (next ? '<a class="nav-btn text-right" href="section.html?s=' + next.id + '">' + esc(next.no) + ' →</a>' : '<a class="nav-btn text-right" href="chapter.html?c=' + hit.ch.id + '">章末檢核 →</a>') +
      '</div>';
  }

  /* ---------- 常見難題：總覽頁 ---------- */
  async function pageProblems() {
    header([{ t: '課程', href: 'index.html' }, { t: '常見難題' }]);
    const { ps, sk } = await loadProblems();
    const chapters = [];
    for (const sem of CUR.editions[EDITION].semesters) for (const ch of sem.chapters) {
      const list = ps.filter(pr => pr.chapter === ch.id);
      if (list.length) chapters.push('<h2 class="sec-h">第 ' + ch.no + ' 章 ' + esc(ch.name) + '</h2><div class="space-y-2 mb-8">' + problemLinks(list) + '</div>');
    }
    const bySkill = sk.map(s => {
      const list = ps.filter(pr => pr.skills.includes(s.id));
      return list.length ? '<div id="skill-' + esc(s.id) + '" class="mb-5"><p class="font-bold text-slate-800">' + esc(s.name) + '</p><p class="text-sm text-slate-600 mb-2">' + esc(s.detail) + '</p><div class="space-y-2">' + problemLinks(list) + '</div></div>' : '';
    }).join('');
    $('#main').innerHTML = '<h1 class="text-2xl font-bold text-slate-800 mb-2">常見難題</h1>' +
      '<p class="text-slate-600 mb-6">每一題都先自己選答案預測，再跟著動態解析一步一步看。做完會告訴你這題用到哪些「招式」，以及還有哪些題目用同一招。</p>' +
      (chapters.join('') || '<p class="text-slate-400">建置中</p>') +
      '<details id="by-skill" class="bg-white rounded-2xl border border-slate-200 p-5"><summary class="font-bold text-slate-800 cursor-pointer min-h-[44px] flex items-center">依招式整理（建議做完題目再看）</summary><div class="mt-4">' + bySkill + '</div></details>';
    const h = location.hash.slice(1);
    if (h.startsWith('skill-') && document.getElementById(h)) { $('#by-skill').open = true; document.getElementById(h).scrollIntoView(); }
  }

  /* ---------- 常見難題：單題動態解析 ---------- */
  async function pageProblem() {
    const { ps, sk } = await loadProblems();
    const pr = ps.find(x => x.id === param('p'));
    const eng = pr && window.PC_ENGINES && window.PC_ENGINES[pr.engine];
    if (!pr || !eng) { header([{ t: '課程', href: 'index.html' }, { t: '常見難題', href: 'problems.html' }]); return notFound(); }
    const found = findChapter(pr.chapter);
    document.title = pr.title + '｜常見難題';
    header([{ t: '課程', href: 'index.html' }, { t: '常見難題', href: 'problems.html' }, { t: pr.title }]);
    const code = kcIndex[pr.kcs[0]].code.code;
    const st = { pred: null, step: 0, max: 0, reached: false, world: null, p: JSON.parse(JSON.stringify(eng.defaults)), anim: 1 };
    const n = eng.steps.length, last = n - 1;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = Date.now();
    const srcTag = pr.license === '公開考題' ? '出處：' + pr.source : '自編題';
    $('#main').innerHTML =
      '<p class="text-sm text-slate-500">' + (found ? esc('第 ' + found.ch.no + ' 章 ' + found.ch.name) + '・' : '') + '常見難題</p>' +
      '<h1 class="text-2xl font-bold text-slate-800">' + esc(pr.title) + '</h1>' +
      '<div class="flex flex-wrap gap-1 mt-2 mb-5"><span class="tag tag-axis">' + esc(kcIndex[pr.kcs[0]].axis.name) + '</span><span class="tag" title="' + esc(kcIndex[pr.kcs[0]].code.text) + '">' + esc(code) + '</span><span class="tag">' + esc(srcTag) + '</span></div>' +
      '<div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm mb-6"><p class="font-medium text-slate-800 leading-relaxed mb-4">' + esc(pr.stem) + '</p>' +
      '<div class="space-y-2" id="popts">' + pr.options.map((o, i) => '<button type="button" class="opt" data-i="' + i + '"><b>' + esc(o.k) + '</b><span>' + esc(o.t) + '</span></button>').join('') + '</div>' +
      '<div id="pstate" class="mt-3"></div></div>' +
      '<h2 class="sec-h">動態解析</h2>' +
      '<div class="bg-white rounded-2xl border border-slate-200 p-3"><div id="cvwrap" class="w-full"><canvas id="pcv" class="block w-full' + (eng.drag ? ' pc-drag' : '') + '" role="img" aria-label="' + esc(pr.title) + '的動態作圖"></canvas></div>' +
      '<div id="pcap" class="text-sm text-slate-600 mt-2 leading-relaxed" aria-live="polite"></div>' +
      '<div class="pc-check mt-2"><span class="pc-ck">檢核</span><span id="pcheck"></span></div></div>' +
      '<div class="mt-5"><div class="flex items-center gap-2 flex-wrap"><span class="text-sm text-slate-500">步驟</span><div id="chips" class="flex gap-2"></div></div>' +
      '<h3 id="stitle" class="text-lg font-bold text-slate-800 mt-4 mb-1"></h3><div id="sbody" class="text-slate-700 leading-relaxed"></div>' +
      '<div class="flex gap-3 mt-4"><button type="button" id="prev" class="nav-btn">← 上一步</button><button type="button" id="next" class="nav-btn">下一步 →</button></div></div>' +
      '<details class="mt-6 bg-white rounded-2xl border border-slate-200 p-5"><summary class="font-bold text-slate-800 cursor-pointer min-h-[44px] flex items-center">改變條件試試看</summary><div class="mt-3 space-y-3">' +
      (eng.sliders || []).map(s => '<label class="pc-sl" for="sl-' + s.k + '"><span>' + esc(s.label) + '</span><input type="range" id="sl-' + s.k + '" data-k="' + s.k + '" min="' + s.min + '" max="' + s.max + '" step="' + s.step + '"><output id="sl-' + s.k + '-o"></output></label>').join('') +
      (eng.dragHint ? '<p class="text-sm text-slate-600">' + esc(eng.dragHint) + '</p>' : '') +
      '<button type="button" id="preset" class="btn-sm">還原題目條件</button></div></details>' +
      '<div id="worlds" class="mt-8" hidden><h2 class="sec-h">每個選項的世界</h2><p class="text-slate-600 text-sm mb-3">點一個選項，圖上會畫出「這個答案成立時」的樣子，看看哪裡說不通。</p><div class="space-y-2">' +
      pr.options.map(o => '<button type="button" class="opt pc-w" data-k="' + esc(o.k) + '"><b>' + esc(o.k) + '</b><span><span class="font-bold">' + esc(o.t) + '</span>' + (o.ok ? '（正解）' : '　常見迷思：' + esc(o.mis)) + '<br><span class="text-slate-600">' + esc(o.why) + '</span></span></button>').join('') + '</div></div>' +
      '<div id="skills" class="mt-8" hidden></div>';

    const cv = $('#pcv');
    const syncSliders = () => (eng.sliders || []).forEach(s => { const inp = $('#sl-' + s.k); inp.value = st.p[s.k]; $('#sl-' + s.k + '-o').textContent = s.fmt(st.p[s.k]); });
    let lastCap = null;
    function draw() {
      const W = Math.round($('#cvwrap').clientWidth); if (!W) return;
      const H = Math.round(Math.max(240, Math.min(560, W * (eng.ratioFor ? eng.ratioFor(W) : eng.ratio)))), dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px'; }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      st.v = eng.view(W, H, st.p);
      const D = window.PC_ENGINES._pen(g, st.v);
      const ease = t => 1 - Math.pow(1 - t, 3);
      const on = k => st.step > k ? 1 : st.step === k ? ease(st.anim) : 0;
      let cap = eng.draw(D, st, st.p, on, g, W, H);
      if (st.world) { const o = pr.options.find(x => x.k === st.world); cap = '<b>(' + esc(o.k) + ') ' + esc(o.t) + '</b>：' + esc(o.why) + (cap ? '<br>' + cap : ''); }
      if (cap !== lastCap) { $('#pcap').innerHTML = cap || ''; lastCap = cap; }
      $('#pcheck').textContent = eng.check(st.p);
    }
    function kick() {
      if (reduce) { st.anim = 1; draw(); return; }
      st.anim = 0; const s0 = performance.now();
      const tick = t => { st.anim = Math.min(1, (t - s0) / 650); draw(); if (st.anim < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }
    function ui() {
      const ans = pr.options.find(o => o.ok);
      document.querySelectorAll('#popts .opt').forEach(b => {
        const o = pr.options[+b.dataset.i];
        b.classList.toggle('chosen', st.pred === o.k && !st.reached);
        b.classList.toggle('right', st.reached && !!o.ok);
        b.classList.toggle('wrong', st.reached && st.pred === o.k && !o.ok);
        b.disabled = !!st.pred && !st.reached;
      });
      const ps2 = $('#pstate');
      if (!st.pred) ps2.innerHTML = '<div class="fb fb-wait"><p class="mb-2">先選一個你認為正確的答案當作預測，再開始看解析。</p><button type="button" class="text-sky-700 underline min-h-[44px]" id="skip">不預測，直接看解析</button></div>';
      else if (!st.reached) ps2.innerHTML = '<div class="fb fb-wait">你的預測：<b>' + (st.pred === 'skip' ? '未預測' : '(' + esc(st.pred) + ')') + '</b>。跟著下面的步驟往下看。</div>';
      else {
        const ok = st.pred === ans.k;
        ps2.innerHTML = '<div class="fb ' + (ok ? 'fb-ok' : 'fb-no') + '"><p class="font-bold">正解 (' + esc(ans.k) + ') ' + esc(ans.t) + '</p>' +
          (st.pred === 'skip' ? '' : ok ? '<p>你的預測正確。</p>' : '<p>你的預測是 (' + esc(st.pred) + ')，到下方「每個選項的世界」點它，看看哪裡說不通。</p>') + '<p class="mt-1">' + esc(pr.explain) + '</p></div>';
      }
      if ($('#skip')) $('#skip').addEventListener('click', () => { st.pred = 'skip'; ui(); });
      $('#chips').innerHTML = eng.steps.map((s, i) => '<button type="button" class="pc-chip' + (st.pred && i === st.step ? ' cur' : st.pred && i <= st.max ? ' done' : '') + '" data-i="' + i + '"' + (!st.pred || i > st.max + 1 ? ' disabled' : '') + ' aria-label="第 ' + (i + 1) + ' 步：' + esc(s.t) + '">' + (i + 1) + '</button>').join('');
      document.querySelectorAll('#chips .pc-chip').forEach(b => b.addEventListener('click', () => go(+b.dataset.i)));
      if (!st.pred) { $('#stitle').textContent = '先預測'; $('#sbody').innerHTML = '<p class="text-slate-500">選好答案後，這裡會一步一步揭示解析。圖上目前是題目原本的配置。</p>'; }
      else { $('#stitle').textContent = eng.steps[st.step].t; $('#sbody').innerHTML = eng.steps[st.step].b(st.p); }
      $('#prev').disabled = !st.pred || st.step === 0; $('#next').disabled = !st.pred || st.step === last;
      $('#next').textContent = st.step === last - 1 ? '看答案 →' : '下一步 →';
      $('#worlds').hidden = !st.reached;
      document.querySelectorAll('.pc-w').forEach(b => b.classList.toggle('chosen', st.world === b.dataset.k));
      $('#skills').hidden = !st.reached;
      if (st.reached && !$('#skills').dataset.done) {
        $('#skills').dataset.done = '1';
        const secs = allSections().filter(x => x.s.kcs.some(k => pr.kcs.includes(k)));
        $('#skills').innerHTML = '<h2 class="sec-h">這題用到的招式</h2><div class="space-y-3 mb-6">' + pr.skills.map(id => {
          const s = sk.find(x => x.id === id); if (!s) return '';
          const others = ps.filter(x => x.id !== pr.id && x.skills.includes(id));
          return '<div class="bg-white rounded-2xl border border-slate-200 p-4"><p class="font-bold text-slate-800">' + esc(s.name) + '</p><p class="text-sm text-slate-600 mt-1">' + esc(s.detail) + '</p>' +
            (others.length ? '<p class="text-sm mt-2">同一招的其他題：' + others.map(x => '<a class="text-sky-700 underline" href="problem.html?p=' + encodeURIComponent(x.id) + '">' + esc(x.title) + '</a>').join('、') + '</p>' : '') + '</div>';
        }).join('') + '</div>' +
          (secs.length ? '<p class="text-sm text-slate-600 mb-2">回去複習觀念：</p><div class="space-y-2">' + secs.map(x => '<a class="nav-btn block" href="section.html?s=' + x.s.id + '">' + esc(x.s.no + ' ' + x.s.name) + '</a>').join('') + '</div>' : '');
      }
    }
    function go(i) {
      if (!st.pred || i < 0 || i > last || i > st.max + 1) return;
      st.step = i; st.max = Math.max(st.max, i);
      if (i === last) st.reached = true;
      if (i !== last) st.world = null;
      if (eng.onStep) eng.onStep(st, i);
      syncSliders(); ui(); kick();
    }
    function setWorld(k) {
      if (!st.reached) return;
      st.world = st.world === k ? null : k;
      if (eng.onWorld) eng.onWorld(st, st.world);
      if (!st.world && eng.onStep) eng.onStep(st, st.step);
      syncSliders(); ui(); draw();
    }
    document.querySelectorAll('#popts .opt').forEach(b => b.addEventListener('click', () => {
      const o = pr.options[+b.dataset.i];
      if (!st.pred) {
        st.pred = o.k;
        const prev = progress()[pr.id];
        saveFirst(pr.id, !!o.ok);
        record({ qid: pr.id, kc: pr.kcs[0], code, page: 'problem', choice: +b.dataset.i, ok: !!o.ok, mis: o.ok ? '' : (o.mis || ''), predict: true, attempt: prev ? prev.n + 1 : 1, ms: Date.now() - t0 });
        ui(); return;
      }
      if (st.reached) setWorld(o.k);
    }));
    document.querySelectorAll('.pc-w').forEach(b => b.addEventListener('click', () => setWorld(b.dataset.k)));
    $('#prev').addEventListener('click', () => go(st.step - 1));
    $('#next').addEventListener('click', () => go(st.step + 1));
    document.querySelectorAll('.pc-sl input').forEach(inp => inp.addEventListener('input', () => { st.p[inp.dataset.k] = +inp.value; st.world = null; syncSliders(); draw(); ui(); }));
    $('#preset').addEventListener('click', () => { st.p = JSON.parse(JSON.stringify(eng.defaults)); st.world = null; if (eng.onStep) eng.onStep(st, st.step); syncSliders(); draw(); ui(); });
    if (eng.drag) {
      let key = null;
      const toW = e => { const r = cv.getBoundingClientRect(), v = st.v; return [(e.clientX - r.left - v.ox) / v.sx, (e.clientY - r.top - v.oy) / v.sy]; };
      cv.addEventListener('pointerdown', e => { const h = eng.hit(st.p, toW(e)); if (!h) return; key = h; cv.setPointerCapture(e.pointerId); e.preventDefault(); });
      cv.addEventListener('pointermove', e => { if (!key) { cv.style.cursor = eng.hit(st.p, toW(e)) ? 'grab' : 'default'; return; } eng.move(st.p, key, toW(e)); draw(); if (st.pred) $('#sbody').innerHTML = eng.steps[st.step].b(st.p); });
      const end = () => { key = null; }; cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    }
    new ResizeObserver(draw).observe($('#cvwrap'));
    syncSliders(); ui(); draw();
  }

  function notFound() { $('#main').innerHTML = '<p class="text-slate-600">找不到這個頁面。<a class="text-sky-700 underline" href="index.html">回課程首頁</a></p>'; }

  /* ---------- 啟動 ---------- */
  async function boot() {
    try {
      [CUR, SITE] = await Promise.all([getJSON(DATA + 'curriculum.json'), getJSON(DATA + 'site.json').catch(() => ({}))]);
      indexCurriculum(CUR);
      const page = document.body.dataset.page;
      if (page === 'chapter') await pageChapter();
      else if (page === 'section') await pageSection();
      else if (page === 'problems') await pageProblems();
      else if (page === 'problem') await pageProblem();
      else pageIndex();
      if (SITE.submitUrl && !identity()) askIdentity(() => { $('#who') && ($('#who').textContent = idLabel()); });
      flush();
    } catch (e) {
      console.error(e);
      $('#main').innerHTML = '<p class="text-red-700">資料載入失敗，請重新整理。（' + esc(e.message) + '）</p>';
    }
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
