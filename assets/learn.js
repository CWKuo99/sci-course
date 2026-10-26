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
    const qs = await loadQuestions(allKcs);
    const main = $('#main');
    main.innerHTML = '<p class="text-sm text-slate-500">' + esc(sem.name) + '・第 ' + ch.no + ' 章</p>' +
      '<h1 class="text-2xl font-bold text-slate-800 mb-4">' + esc(ch.name) + '</h1><div class="space-y-2 mb-8">' +
      ch.sections.map(s => {
        const st = sectionStats(qs.filter(q => s.kcs.includes(q.kc)).map(q => q.id));
        const pct = st.total ? Math.round(st.done / st.total * 100) : 0;
        return '<a href="section.html?s=' + esc(s.id) + '" class="block bg-white rounded-2xl border border-slate-200 p-5 card-hover">' +
          '<div class="flex items-baseline gap-2"><span class="font-bold text-sky-700">' + esc(s.no) + '</span><span class="font-bold text-slate-800">' + esc(s.name) + '</span>' +
          '<span class="ml-auto text-sm text-slate-500">' + (st.done ? '答對 ' + st.ok + ' / ' + st.total : st.total + ' 題') + '</span></div>' +
          '<div class="h-2 bg-slate-100 rounded mt-3"><div class="h-2 bg-sky-500 rounded" style="width:' + pct + '%"></div></div></a>';
      }).join('') + '</div>' +
      '<h2 class="text-xl font-bold text-slate-800 mb-1">章末檢核</h2><p class="text-slate-600 mb-4 text-sm">每節隨機抽 2 題，不含預測題。</p><div id="quiz" class="space-y-4"></div>';
    const pick = ch.sections.flatMap(s => shuffle(qs.filter(q => s.kcs.includes(q.kc) && !q.predict)).slice(0, 2));
    renderQuiz($('#quiz'), pick, ch.id, '章末檢核');
  }

  async function pageSection() {
    const hit = allSections().find(x => x.s.id === param('s'));
    if (!hit) return notFound();
    const { sem, ch, s } = hit;
    document.title = s.no + ' ' + s.name + '｜理化課程';
    header([{ t: '課程', href: 'index.html' }, { t: '第 ' + ch.no + ' 章 ' + ch.name, href: 'chapter.html?c=' + ch.id }, { t: s.no }]);
    const [qs, cards] = await Promise.all([
      loadQuestions(s.kcs),
      Promise.all(s.kcs.map(k => getText('content/' + k + '.md')))
    ]);
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
      cards.map((c, i) => c ? '<article class="card-md bg-white rounded-2xl border border-slate-200 p-5">' + md(c) + '</article>' : '').join('') + '</div>' +
      (s.sims && s.sims.length ? '<h2 class="sec-h">動手模擬</h2><div class="space-y-2 mb-8">' +
        s.sims.map(m => '<a href="' + esc(m.href) + '" class="flex items-center gap-3 bg-white rounded-2xl border border-slate-200 p-4 card-hover min-h-[44px]"><span class="text-2xl">🧪</span><span class="font-medium text-slate-800">' + esc(m.title) + '</span><span class="ml-auto text-sky-600">→</span></a>').join('') + '</div>' : '') +
      '<h2 class="sec-h">快速檢核</h2><p class="text-slate-600 text-sm mb-4">答錯沒關係，看看自己是不是有這些常見的想法。</p><div id="quiz" class="space-y-4"></div>' +
      nav(hit);
    if (predict.length) predict.forEach((q, i) => $('#pred').appendChild(renderQuestion(q, i + 1, { page: s.id })));
    renderQuiz($('#quiz'), check, s.id, s.no + ' 檢核');
  }

  function nav(hit) {
    const secs = hit.ch.sections, i = secs.indexOf(hit.s);
    const prev = secs[i - 1], next = secs[i + 1];
    return '<div class="flex gap-3 mt-10">' +
      (prev ? '<a class="nav-btn" href="section.html?s=' + prev.id + '">← ' + esc(prev.no) + '</a>' : '<span class="flex-1"></span>') +
      (next ? '<a class="nav-btn text-right" href="section.html?s=' + next.id + '">' + esc(next.no) + ' →</a>' : '<a class="nav-btn text-right" href="chapter.html?c=' + hit.ch.id + '">章末檢核 →</a>') +
      '</div>';
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
