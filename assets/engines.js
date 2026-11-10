/* 常見難題的動態解析引擎。每個引擎負責一道題的作圖、分步說明與「錯誤選項的世界」。
 * 題目文字、選項與迷思在 data/problems.json；這裡只放會隨參數變動的部分。
 * 由 learn.js 的 problem 頁面呼叫：window.PC_ENGINES[engine]。 */
(function () {
  'use strict';
  const RAD = Math.PI / 180;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, s) => [a[0] * s, a[1] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1], neg = a => [-a[0], -a[1]];
  const len = a => Math.hypot(a[0], a[1]), unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
  const rot = (a, d) => { const c = Math.cos(d * RAD), s = Math.sin(d * RAD); return [a[0] * c - a[1] * s, a[0] * s + a[1] * c]; };
  const refl = (d, n) => sub(d, mul(n, 2 * dot(d, n)));
  function refr(d, nf, eta) { const c = -dot(nf, d), k = 1 - eta * eta * (1 - c * c); if (k < 0) return null; return add(mul(d, eta), mul(nf, eta * c - Math.sqrt(k))); }
  const angDeg = (u, v) => Math.acos(Math.max(-1, Math.min(1, dot(unit(u), unit(v))))) / RAD;
  const f1 = x => (Math.round(x * 10) / 10).toFixed(1), f0 = x => String(Math.round(x)), fn = x => String(+(+x).toFixed(3));
  const mid = (a, b) => mul(add(a, b), 0.5);
  function hitSeg(p, d, a, b) {
    const e = sub(b, a), den = d[0] * e[1] - d[1] * e[0]; if (Math.abs(den) < 1e-9) return null;
    const w = sub(a, p), t = (w[0] * e[1] - w[1] * e[0]) / den, u = (w[0] * d[1] - w[1] * d[0]) / den;
    return (t > 1e-6 && u >= 0 && u <= 1) ? { t, pt: add(p, mul(d, t)) } : null;
  }
  const FB = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif', FM = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
  /* 與 learn.css 一致的淺色配色 */
  const C = {
    ink: '#1e293b', ink2: '#475569', ink3: '#94a3b8', line: '#e2e8f0', line2: '#cbd5e1', surface: '#ffffff',
    accent: '#0284c7', ray: '#d97706', mirror: '#2563eb', normal: '#64748b', img: '#7c3aed', obj: '#0f766e', tan: '#0d9488',
    bad: '#dc2626', good: '#16a34a', water: 'rgba(37,99,235,.08)', cone: 'rgba(217,119,6,.14)', tri: 'rgba(2,132,199,.10)', fgood: 'rgba(22,163,74,.12)'
  };
  const lg = (col, t, dash) => '<span class="lg"><i style="background:' + (dash ? 'repeating-linear-gradient(90deg,' + col + ' 0 4px,transparent 4px 7px)' : col) + '"></i>' + t + '</span>';
  const M = s => '<span class="num">' + s + '</span>';

  function fit(W, H, b, pad, yUp, ky) {
    ky = ky || 1;
    const sx = Math.min((W - 2 * pad) / (b.x1 - b.x0), (H - 2 * pad) / ((b.y1 - b.y0) * ky)), sy = sx * ky;
    const cw = (b.x1 - b.x0) * sx, ch = (b.y1 - b.y0) * sy, ox = (W - cw) / 2 - b.x0 * sx;
    return yUp ? { ox, oy: (H - ch) / 2 + b.y1 * sy, sx, sy: -sy } : { ox, oy: (H - ch) / 2 - b.y0 * sy, sx, sy };
  }

  /* 畫筆：世界座標 → 畫面座標 */
  function pen(g, v) {
    const T = p => [v.ox + p[0] * v.sx, v.oy + p[1] * v.sy];
    const sd = d => { const x = d[0] * v.sx, y = d[1] * v.sy, l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    const P = {
      T,
      line(a, b, col, w, dash, frac, alpha) { if (frac === undefined) frac = 1; if (frac <= 0) return; const A = T(a), B = T(b); g.save(); g.globalAlpha = alpha === undefined ? 1 : alpha; g.strokeStyle = col; g.lineWidth = w || 1.6; g.setLineDash(dash || []); g.lineCap = 'round'; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(A[0] + (B[0] - A[0]) * frac, A[1] + (B[1] - A[1]) * frac); g.stroke(); g.restore(); },
      poly(pts, fill, alpha) { g.save(); g.globalAlpha = alpha === undefined ? 1 : alpha; g.fillStyle = fill; g.beginPath(); pts.forEach((p, i) => { const q = T(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.fill(); g.restore(); },
      rect(a, b, fill, stroke, w, dash, alpha) { const A = T(a), B = T(b), x = Math.min(A[0], B[0]), y = Math.min(A[1], B[1]), ww = Math.abs(B[0] - A[0]), hh = Math.abs(B[1] - A[1]); g.save(); g.globalAlpha = alpha === undefined ? 1 : alpha; if (fill) { g.fillStyle = fill; g.fillRect(x, y, ww, hh); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = w || 1.5; g.setLineDash(dash || []); g.strokeRect(x, y, ww, hh); } g.restore(); },
      arrow(at, dir, col, sz, alpha) { sz = sz || 9; const A = T(at), u = sd(dir), a = Math.atan2(u[1], u[0]), tx = A[0] + u[0] * sz * 0.5, ty = A[1] + u[1] * sz * 0.5; g.save(); g.globalAlpha = alpha === undefined ? 1 : alpha; g.fillStyle = col; g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - sz * Math.cos(a - 0.42), ty - sz * Math.sin(a - 0.42)); g.lineTo(tx - sz * Math.cos(a + 0.42), ty - sz * Math.sin(a + 0.42)); g.closePath(); g.fill(); g.restore(); },
      circle(c, r, fill, stroke, w) { const A = T(c), R = Math.abs(r * v.sx); g.beginPath(); g.arc(A[0], A[1], R, 0, Math.PI * 2); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = w || 1.5; g.setLineDash([]); g.stroke(); } },
      dot(p, r, col, alpha) { const A = T(p); g.save(); g.globalAlpha = alpha === undefined ? 1 : alpha; g.fillStyle = col; g.beginPath(); g.arc(A[0], A[1], r, 0, Math.PI * 2); g.fill(); g.restore(); },
      text(p, s, col, o) {
        o = o || {}; const A = T(p); const x = A[0] + (o.dx || 0), y = A[1] + (o.dy || 0);
        g.save(); g.globalAlpha = o.alpha === undefined ? 1 : o.alpha; g.font = (o.weight || 500) + ' ' + (o.size || 13) + 'px ' + (o.mono ? FM : FB); g.textBaseline = 'middle'; g.textAlign = o.align || 'left';
        if (o.bg) { const tw = g.measureText(s).width, h = (o.size || 13) + 7; let bx = x - 3; if (g.textAlign === 'center') bx = x - tw / 2 - 4; else if (g.textAlign === 'right') bx = x - tw - 5; g.fillStyle = C.surface; g.fillRect(bx, y - h / 2, tw + 8, h); }
        g.fillStyle = col; g.fillText(s, x, y); g.restore();
      },
      arc(c, v1, v2, r, col, label, o) {
        o = o || {}; const A = T(c), a = sd(v1), b = sd(v2); let a1 = Math.atan2(a[1], a[0]), a2 = Math.atan2(b[1], b[0]), d = a2 - a1;
        while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) / RAD < 0.6) return;
        g.save(); g.globalAlpha = o.alpha === undefined ? 1 : o.alpha; g.strokeStyle = col; g.lineWidth = o.w || 1.6; g.setLineDash([]); g.beginPath(); g.arc(A[0], A[1], r, a1, a1 + d, d < 0); g.stroke(); g.restore();
        if (label) { const am = a1 + d / 2, off = o.off || 15; P.text([0, 0], label, col, { dx: A[0] - v.ox + Math.cos(am) * (r + off), dy: A[1] - v.oy + Math.sin(am) * (r + off), align: 'center', mono: true, size: 12, bg: true, alpha: o.alpha, weight: 600 }); }
      },
      rmark(p, u, n, col, sz) { sz = sz || 8; const A = T(p), a = sd(u), b = sd(n); g.save(); g.strokeStyle = col; g.lineWidth = 1.1; g.beginPath(); g.moveTo(A[0] + a[0] * sz, A[1] + a[1] * sz); g.lineTo(A[0] + a[0] * sz + b[0] * sz, A[1] + a[1] * sz + b[1] * sz); g.lineTo(A[0] + b[0] * sz, A[1] + b[1] * sz); g.stroke(); g.restore(); },
      dim(a, b, label, col, alpha) {
        const A = T(a), B = T(b), u = unit(sub(B, A)), n = [-u[1], u[0]];
        g.save(); g.globalAlpha = alpha === undefined ? 1 : alpha; g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]);
        [A, B].forEach(Q => { g.moveTo(Q[0] - n[0] * 5, Q[1] - n[1] * 5); g.lineTo(Q[0] + n[0] * 5, Q[1] + n[1] * 5); }); g.stroke(); g.restore();
        P.text([0, 0], label, col, { dx: (A[0] + B[0]) / 2 - v.ox, dy: (A[1] + B[1]) / 2 - v.oy, align: 'center', mono: true, size: 12, bg: true, alpha });
      },
      letter(p, ch, col, size, flip, alpha) { const A = T(p); g.save(); g.globalAlpha = alpha === undefined ? 1 : alpha; g.translate(A[0], A[1]); if (flip) g.scale(1, -1); g.font = '700 ' + size + 'px ' + FM; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(ch, 0, 1); g.restore(); }
    };
    return P;
  }

  /* ───── Ka-IV-8-901：水滴折射（95 年基測） ───── */
  function geoDrop(p) {
    const h = p.h, n = p.n, s = Math.sqrt(1 - h * h), Cp = [-s, h], Dp = [s, h], tir = n * h > 0.9999;
    const o = { h, n, s, Cp, Dp, tir, r: Math.asin(h) / RAD }; if (tir) return o;
    o.out = refr([-1, 0], [s, -h], n); o.outF = refr([1, 0], [-s, -h], n);
    o.Adir = [o.out[0], -o.out[1]]; o.Edir = [o.outF[0], -o.outF[1]];
    o.iB = Math.asin(n * h) / RAD; o.iA = angDeg(Cp, o.Adir); return o;
  }
  const tirMsg = g => '目前 n·h = ' + M((g.n * g.h).toFixed(2)) + ' &gt; 1，沒有任何外部光線能折射出這條弦。請把 h 調低再看這一步。';
  const n1Msg = 'n = 1 時水和空氣沒有差別，光完全不偏折，A 與 B、E 與 F 重合成同一條線。';
  const droplet = {
    ratio: 0.58, defaults: { h: 0.3, n: 1.33 },
    sliders: [{ k: 'h', label: '弦 CD 高度 h/R', min: 0, max: 0.95, step: 0.01, fmt: v => (+v).toFixed(2) }, { k: 'n', label: '水的折射率 n', min: 1, max: 1.6, step: 0.01, fmt: v => (+v).toFixed(2) }],
    view: (W, H) => fit(W, H, { x0: -3.1, x1: 3.1, y0: -1.45, y1: 1.45 }, 14, true),
    steps: [
      { t: '讀圖：四條候選路徑', b: () => 'C、D 兩點各有兩種偏折方向，組合成四個選項。先想一件事：判斷光「往哪邊偏」時，要拿哪一條線當基準？' },
      { t: '畫法線：曲面上的法線就是半徑', b: () => '曲面上取入射點的切線當作界面，法線垂直於切線。圓的切線垂直於半徑，所以水滴每一點的法線都通過球心 O。題目特別說「平面通過球心」，就是保證法線落在這張圖上。' },
      { t: 'C 點：空氣進入水，偏向法線', b: p => { const g = geoDrop(p); if (g.tir) return tirMsg(g); if (g.n < 1.005) return n1Msg; return '光進入水時偏向法線，所以<b>空氣中的角度要比水中的大</b>。水中 CD 與法線夾 ' + M(f1(g.r) + '°') + '；B 在空氣中夾 ' + M(f1(g.iB) + '°') + '，比較大 ✓；A 只夾 ' + M(f1(g.iA) + '°') + '，比較小 ✗。入射光來自 B。'; } },
      { t: 'D 點：水進入空氣，偏離法線', b: p => { const g = geoDrop(p); if (g.tir) return tirMsg(g); if (g.n < 1.005) return n1Msg; return '光離開水時偏離法線，空氣中的角度同樣要比水中的大。F 夾 ' + M(f1(g.iB) + '°') + ' ✓，E 只夾 ' + M(f1(g.iA) + '°') + ' ✗。出射光往 F。'; } },
      { t: '完整路徑', b: p => { const g = geoDrop(p); if (g.tir) return tirMsg(g); return 'B → C → D → F，答案 <b>(D)</b>。兩次偏折都往球心那一側彎，共偏轉 2(i − r) = ' + M(f1(2 * (g.iB - g.r)) + '°') + '，水滴對這條光線的作用就像凸透鏡。把 h 拖到 0，光沿半徑入射，i = r = 0°，直線穿過不偏折。'; } }
    ],
    check: p => { const g = geoDrop(p); if (g.tir) return 'n·h = ' + (g.n * g.h).toFixed(3) + ' > 1：sin i 不可能大於 1'; return 'C 點 n₁ sin i = n₂ sin r：1 × ' + (g.n * g.h).toFixed(3) + ' = ' + g.n.toFixed(2) + ' × ' + g.h.toFixed(3) + '　｜　總偏向 2(i − r) = ' + f1(2 * (g.iB - g.r)) + '°'; },
    draw(D, st, p, on) {
      const g = geoDrop(p), O = [0, 0], Cp = g.Cp, Dp = g.Dp, step = st.step, fin = step >= 4, W = st.world;
      D.circle(O, 1, C.water, C.mirror, 1.6); D.dot(O, 3, C.ink2); D.text(O, 'O', C.ink2, { dx: 7, dy: 11, mono: true });
      D.text([0, -0.6], '水滴', C.ink3, { align: 'center' }); D.text([-3, -1.25], '空氣', C.ink3);
      const k1 = on(1);
      if (k1 > 0) {
        [Cp, Dp].forEach(X => { D.line(O, mul(X, 1.62), C.normal, 1.2, [5, 4], k1); const t = [-X[1], X[0]]; D.line(add(X, mul(t, -0.5)), add(X, mul(t, 0.5)), C.tan, 1.8, null, k1); if (k1 > 0.85) D.rmark(X, t, neg(X), C.tan, 7); });
        if (k1 > 0.85) { D.text(mul(Cp, 1.62), '法線', C.normal, { dy: -10, align: 'center' }); D.text(add(Cp, mul([-Cp[1], Cp[0]], 0.5)), '切線', C.tan, { dx: -4, dy: 9, align: 'right' }); }
      }
      if (g.tir) { D.line(Cp, Dp, C.bad, 2); return '<b>n·h = ' + (g.n * g.h).toFixed(2) + ' &gt; 1</b>：沒有任何外部光線能折射出這條弦。'; }
      const L = 1.95, Ap = add(Cp, mul(g.Adir, L)), Bp = add(Cp, mul(g.out, L)), Ep = add(Dp, mul(g.Edir, L)), Fp = add(Dp, mul(g.outF, L)), gray = C.ink3;
      const seg = (a, b, col, w, dash, alpha) => { D.line(a, b, col, w, dash, 1, alpha); D.arrow(mid(a, b), sub(b, a), col, 9, alpha); };
      if (!fin) {
        seg(Ap, Cp, step >= 2 ? C.bad : gray, step >= 2 ? 1.8 : 1.5, step >= 2 ? [6, 5] : null);
        seg(Bp, Cp, step >= 2 ? C.ray : gray, step >= 2 ? 2.4 : 1.5);
        seg(Cp, Dp, step >= 2 ? C.ray : gray, step >= 2 ? 2.4 : 1.5);
        seg(Dp, Ep, step >= 3 ? C.bad : gray, step >= 3 ? 1.8 : 1.5, step >= 3 ? [6, 5] : null);
        seg(Dp, Fp, step >= 3 ? C.ray : gray, step >= 3 ? 2.4 : 1.5);
      } else {
        const inA = W === 'A' || W === 'B', outE = W === 'A' || W === 'C';
        seg(Ap, Cp, inA ? C.bad : gray, inA ? 2.6 : 1.2, inA ? [7, 5] : [4, 4], inA ? 1 : 0.45);
        seg(Bp, Cp, inA ? gray : C.ray, inA ? 1.2 : 3, null, inA ? 0.45 : 1);
        seg(Cp, Dp, C.ray, 3);
        seg(Dp, Ep, outE ? C.bad : gray, outE ? 2.6 : 1.2, outE ? [7, 5] : [4, 4], outE ? 1 : 0.45);
        seg(Dp, Fp, outE ? gray : C.ray, outE ? 1.2 : 3, null, outE ? 0.45 : 1);
        if (inA) { const dIn = refr(neg(g.Adir), Cp, 1 / g.n), t = -2 * dot(Cp, dIn), X = add(Cp, mul(dIn, t)); D.line(Cp, X, C.bad, 2, [4, 4]); D.arrow(mid(Cp, X), dIn, C.bad); D.text(X, 'A 實際走這裡', C.bad, { dx: 6, dy: 14, bg: true, size: 12 }); }
        if (outE) D.text(Ep, '需偏向法線 ✗', C.bad, { dx: -4, dy: -14, align: 'right', bg: true, size: 12 });
      }
      const lab = (P0, s, dx, dy) => D.text(P0, s, C.ink, { dx, dy, mono: true, weight: 700, size: 14 });
      lab(Ap, 'A', -14, 0); lab(Bp, 'B', -14, 0); lab(Ep, 'E', 8, 0); lab(Fp, 'F', 8, 0); lab(Cp, 'C', -14, -10); lab(Dp, 'D', 7, -10);
      D.dot(Cp, 3, C.ink); D.dot(Dp, 3, C.ink);
      const k2 = on(2), k3 = on(3);
      if ((k2 > 0.6 && !fin) || (fin && !W)) { D.arc(Cp, neg(Cp), [1, 0], 30, C.accent, f1(g.r) + '°'); if (step < 4) { D.arc(Cp, Cp, g.out, 50, C.ray, f1(g.iB) + '°', { off: 26 }); D.arc(Cp, Cp, g.Adir, 86, C.bad, f1(g.iA) + '°', { off: 18 }); } }
      if ((k3 > 0.6 && !fin) || (fin && !W)) { D.arc(Dp, neg(Dp), [-1, 0], 30, C.accent, f1(g.r) + '°'); if (step < 4) { D.arc(Dp, Dp, g.outF, 50, C.ray, f1(g.iB) + '°', { off: 26 }); D.arc(Dp, Dp, g.Edir, 86, C.bad, f1(g.iA) + '°', { off: 18 }); } }
      if (fin && !W) { D.arc(Cp, Cp, g.out, 50, C.ray, f1(g.iB) + '°', { off: 26 }); D.arc(Dp, Dp, g.outF, 50, C.ray, f1(g.iB) + '°', { off: 26 }); }
      if (step === 0) return '灰線是四條候選路徑。下方滑桿可以改變弦的高度與折射率。';
      if (step === 1) return lg(C.normal, '法線（通過球心）', true) + lg(C.tan, '切線（界面）');
      if (step === 2) return '<b>C 點</b>（空氣 → 水）：B ' + f1(g.iB) + '° &gt; 水中 ' + f1(g.r) + '° ✓　A ' + f1(g.iA) + '° &lt; ' + f1(g.r) + '° ✗';
      if (step === 3) return '<b>D 點</b>（水 → 空氣）：F ' + f1(g.iB) + '° &gt; 水中 ' + f1(g.r) + '° ✓　E ' + f1(g.iA) + '° &lt; ' + f1(g.r) + '° ✗';
      if (W) return null;
      return lg(C.ray, '正確路徑 B → C → D → F') + lg(C.accent, '水中的角度');
    }
  };

  /* ───── Ka-IV-8-902：兩面鏡子之間的光（自編） ───── */
  function geoTwo(p) {
    const ph = p.phi, gg = p.g, uA = [Math.cos(ph * RAD), Math.sin(ph * RAD)], OA = 5.4, OB = 6.6, O = [0, 0];
    const P = mul(uA, 3), s = rot(uA, -gg), S = add(P, mul(s, 3.4)), d = neg(s), nA = [Math.sin(ph * RAD), -Math.cos(ph * RAD)], r1 = refl(d, nA);
    const o = { ph, gg, uA, OA, OB, O, P, s, S, d, nA, r1, Q: null };
    const h = hitSeg(P, r1, O, [OB, 0]);
    if (h) { o.Q = h.pt; o.qa = angDeg(sub(P, o.Q), [-1, 0]); o.ri = angDeg([0, 1], sub(P, o.Q)); o.r2 = [r1[0], -r1[1]]; const h2 = hitSeg(o.Q, o.r2, O, mul(uA, OA)); o.R = h2 ? h2.pt : null; o.rot = angDeg(d, o.r2); }
    return o;
  }
  const missMsg = '目前的角度下，反射光沒有打到 M₂。請調整兩個角度。';
  const twoMirrors = {
    ratio: 0.8, defaults: { phi: 65, g: 45 },
    sliders: [{ k: 'phi', label: '兩鏡夾角', min: 30, max: 90, step: 1, fmt: v => v + '°' }, { k: 'g', label: '光與 M₁ 鏡面夾角', min: 15, max: 85, step: 1, fmt: v => v + '°' }],
    view: (W, H) => fit(W, H, { x0: -0.9, x1: 7.3, y0: -0.8, y1: 6 }, 14, true),
    steps: [
      { t: '標出已知的角', b: p => '兩鏡夾角 ' + M(p.phi + '°') + '；入射光與 M₁ <b>鏡面</b>夾 ' + M(p.g + '°') + '。題目給的是光與鏡面的夾角，不是入射角，這一點是後面陷阱的來源。' },
      { t: '在 M₁ 反射', b: p => '入射角 = 反射角，兩者都等於 90° 減去「光與鏡面的夾角」，所以反射光與鏡面的夾角也是 ' + M(p.g + '°') + '。反射光朝 M₂ 前進。' },
      { t: '三角形 OPQ 的內角和', b: p => { const g = geoTwo(p); if (!g.Q) return missMsg; return 'O、P、Q 三點圍成三角形：' + M(p.phi + '° + ' + p.g + '° + ∠Q = 180°') + '，所以 ∠Q = ' + M(f0(g.qa) + '°') + '。∠Q 是光線與 <b>M₂ 鏡面</b>的夾角。'; } },
      { t: '反射角要從法線量', b: p => { const g = geoTwo(p); if (!g.Q) return missMsg; return '在 Q 點畫出垂直 M₂ 的法線。入射角 = 90° − ' + f0(g.qa) + '° = ' + M(f0(g.ri) + '°') + '。'; } },
      { t: '答案', b: p => { const g = geoTwo(p); if (!g.Q) return missMsg; return '反射角 = 入射角 = ' + M(f0(g.ri) + '°') + '，題目條件下答案 <b>(A) 20°</b>。延伸：光連續被兩面夾 ' + p.phi + '° 的鏡子各反射一次，方向一共轉了 2 × ' + p.phi + '° = ' + M(2 * p.phi + '°') + '，和「鏡子轉 θ，反射光轉 2θ」是同一個原理。'; } }
    ],
    check: p => { const g = geoTwo(p); if (!g.Q) return '反射光沒有打到 M₂'; return '反射角 = |夾角 + g − 90°| = |' + p.phi + ' + ' + p.g + ' − 90| = ' + Math.abs(p.phi + p.g - 90) + '°（圖上量得 ' + f1(g.ri) + '°）　｜　兩次反射後方向轉 ' + f1(g.rot) + '° = 2 × 夾角'; },
    draw(D, st, p, on) {
      const g = geoTwo(p), O = g.O, uA = g.uA, nA = g.nA, P = g.P, S = g.S, s = g.s, r1 = g.r1, Q = g.Q, step = st.step, W = st.world, fin = step >= 4;
      const Aend = mul(uA, g.OA), Bend = [g.OB, 0];
      for (let t = 0.25; t < g.OA; t += 0.32) D.line(mul(uA, t), add(mul(uA, t - 0.16), mul(nA, -0.2)), C.mirror, 1);
      for (let t = 0.25; t < g.OB; t += 0.32) D.line([t, 0], [t - 0.16, -0.2], C.mirror, 1);
      D.line(O, Aend, C.mirror, 4); D.line(O, Bend, C.mirror, 4);
      const lab = (P0, s0, dx, dy) => D.text(P0, s0, C.ink, { dx, dy, mono: true, weight: 700, size: 14 });
      lab(Aend, 'M₁', -8, -12); lab(Bend, 'M₂', 8, -12); lab(O, 'O', -16, 8);
      D.arc(O, [1, 0], uA, 34, (fin && W === 'C') ? C.bad : C.ink2, p.phi + '°', { w: (fin && W === 'C') ? 3 : 1.6 });
      D.line(S, P, C.ray, 2.4); D.arrow(mid(S, P), g.d, C.ray);
      D.arc(P, s, uA, 38, C.ray, p.g + '°'); D.dot(P, 3, C.ink); lab(P, 'P', -18, -2);
      const k1 = on(1);
      if (k1 > 0) {
        D.line(add(P, mul(nA, -0.35)), add(P, mul(nA, 1.15)), C.normal, 1.1, [5, 4], k1);
        if (Q) { D.line(P, Q, C.ray, 2.4, null, k1); if (k1 > 0.5) D.arrow(mid(P, Q), r1, C.ray); } else D.line(P, add(P, mul(r1, 3)), C.ray, 2.4, null, k1);
        if (k1 > 0.8) D.arc(P, neg(uA), r1, 38, C.ray, p.g + '°');
      }
      if (!Q) return k1 > 0 ? '反射光沒有打到 M₂，請調整角度。' : '斜線那一側是鏡子背面。';
      if (k1 > 0.9) { D.dot(Q, 3, C.ink); lab(Q, 'Q', 0, 16); }
      const badQ = fin && W === 'D', k2 = on(2), k3 = on(3), k4 = on(4);
      if (k2 > 0) { D.poly([O, P, Q], C.tri, k2); D.arc(Q, sub(P, Q), [-1, 0], 30, badQ ? C.bad : C.accent, f0(g.qa) + '°' + (badQ ? ' ✗' : ''), { alpha: k2, w: badQ ? 3 : 1.6 }); }
      if (k3 > 0) { D.line(Q, add(Q, [0, 1.6]), C.normal, 1.2, [5, 4], k3); if (k3 > 0.8) D.arc(Q, [0, 1], sub(P, Q), 46, C.good, 'i ' + f0(g.ri) + '°', { w: badQ ? 3 : 1.6, off: 14 }); }
      if (k4 > 0) {
        const end = g.R || add(Q, mul(g.r2, 3.8)); D.line(Q, end, C.ray, 2.4, null, k4); if (k4 > 0.6) D.arrow(mid(Q, end), g.r2, C.ray);
        if (g.R && k4 > 0.9) { const r3 = refl(g.r2, nA); D.line(g.R, add(g.R, mul(r3, 2.5)), C.ray, 1.6, [5, 4], 1, 0.5); }
        if (k4 > 0.8) D.arc(Q, [0, 1], g.r2, 66, C.good, 'r ' + f0(g.ri) + '°', { off: 22 });
      }
      if (fin && W === 'B') D.arc(Q, sub(P, Q), [-1, 0], 80, C.bad, '45°?', { w: 2.6 });
      if (step === 0) return '斜線那一側是鏡子背面。黃線是入射光，' + p.g + '° 是它和 M₁ 鏡面的夾角。';
      if (step === 1) return lg(C.ray, '光線') + lg(C.normal, 'P 點法線', true);
      if (step === 2) return M(p.phi + '° + ' + p.g + '° + ∠Q = 180°') + '　→　<b>∠Q = ' + f0(g.qa) + '°</b>';
      if (step === 3) return M('i = 90° − ' + f0(g.qa) + '° = ' + f0(g.ri) + '°');
      if (W) return null;
      return lg(C.good, '入射角 i ＝ 反射角 r') + lg(C.accent, '光線與鏡面的夾角');
    }
  };

  /* ───── Ka-IV-8-903：從小鏡子看身後的公布欄（自編） ───── */
  function geoBoard(p) {
    const a = p.a / 100, L = p.L / 100, X = p.X, Bd = p.B, xm = X + a, xi = 2 * xm, w = L * (X + 2 * a) / a;
    return { a, L, X, Bd, half: Bd / 2, xm, xi, w, hw: w / 2, vis: Math.min(w / 2, Bd / 2), xmin: Bd * a / L - 2 * a, eyeImg: X + 2 * a };
  }
  const mirrorBoard = {
    ratio: 0.64, ratioFor: W => (W < 520 ? 1.05 : 0.64), defaults: { X: 4, a: 25, L: 8, B: 2.4 },
    sliders: [{ k: 'X', label: '人到公布欄 x', min: 1, max: 9, step: 0.05, fmt: v => (+v).toFixed(2) + ' m' }, { k: 'a', label: '鏡子到眼睛', min: 10, max: 40, step: 1, fmt: v => v + ' cm' }, { k: 'L', label: '鏡子長度', min: 4, max: 20, step: 1, fmt: v => v + ' cm' }],
    worldX: { A: 3.75, B: 7, C: 7.25, D: 7.5 },
    view: (W, H) => fit(W, H, { x0: -1, x1: 19.4, y0: -2.95, y1: W < 520 ? 5.2 : 4.0 }, 12, true, W < 520 ? 2.6 : 1.6),
    steps: [
      { t: '看的是公布欄的「像」', b: () => '這是俯視圖：公布欄在左，鏡子在右，人站在中間。小安背對公布欄、面向鏡子，他看到的其實是鏡中公布欄的像。設人到公布欄的距離為 x。' },
      { t: '像在鏡後多遠', b: p => { const g = geoBoard(p); return '公布欄到鏡子是 ' + M('x + ' + fn(g.a)) + ' 公尺，像就在鏡後同樣遠的地方。所以眼睛到像 = ' + M(fn(g.a) + ' + (x + ' + fn(g.a) + ') = x + ' + fn(2 * g.a)) + ' 公尺。'; } },
      { t: '視線必須通過鏡子兩端', b: () => '看得到的範圍，由眼睛穿過鏡子兩端的兩條視線決定。視線在像上框住的寬度，就是看得到的公布欄寬度。黃色實線是真正的光：從公布欄出發，經鏡子反射後進入眼睛。' },
      { t: '相似三角形', b: p => { const g = geoBoard(p); return '鏡長 ÷ 眼到鏡 = 可見寬 ÷ 眼到像：' + M(fn(g.L) + ' ÷ ' + fn(g.a) + ' = ' + fn(g.Bd) + ' ÷ (x + ' + fn(2 * g.a) + ')') + '，所以 ' + M('x + ' + fn(2 * g.a) + ' = ' + fn(g.Bd * g.a / g.L)) + '。'; } },
      { t: '答案', b: p => { const g = geoBoard(p); return 'x = ' + fn(g.Bd * g.a / g.L) + ' − ' + fn(2 * g.a) + ' = ' + M(fn(g.xmin) + ' 公尺') + '，題目條件下答案 <b>(B) 7.0 公尺</b>，此時恰好看到整面。陷阱：' + fn(g.Bd * g.a / g.L) + ' 公尺是眼睛到「像」的距離。'; } }
    ],
    onStep(st, k) { if (k === 4 && !st.world) { const g = geoBoard(st.p); st.p.X = Math.min(9, Math.max(1, Math.round(g.xmin * 100) / 100)); } },
    onWorld(st, k) { if (k) { st.p.a = 25; st.p.L = 8; st.p.X = this.worldX[k]; } },
    check: p => { const g = geoBoard(p); return '可見寬 w = L(x + 2a) ÷ a = ' + fn(g.L) + ' × ' + fn(g.eyeImg) + ' ÷ ' + fn(g.a) + ' = ' + fn(Math.round(g.w * 100) / 100) + ' m ' + (g.w >= g.Bd - 1e-6 ? '≥' : '<') + ' ' + g.Bd + ' m　｜　最少 x = Ba/L − 2a = ' + fn(g.xmin) + ' m'; },
    draw(D, st, p, on, g2, Wpx, Hpx) {
      const g = geoBoard(p), X = g.X, xm = g.xm, xi = g.xi, hw = g.hw, vis = g.vis, hb = g.half, E = [X, 0], step = st.step, W = st.world, short = g.w < g.Bd - 1e-6;
      const k1 = on(1), k2 = on(2), k3 = on(3);
      D.line([xm, -2.3], [xm, 1.9], C.normal, 1, [4, 5], 1, 0.7);
      D.line([0, -hb], [0, hb], C.obj, 5); D.text([0, hb], '公布欄 ' + g.Bd + ' m', C.obj, { dx: -4, dy: -12, weight: 700 });
      D.rect([X - 0.3, -0.4], [xm + 0.3, 0.4], null, C.ink3, 1, [3, 3]);
      D.dim([0, -1.8], [X, -1.8], 'x = ' + fn(Math.round(X * 100) / 100) + ' m', C.ink2);
      if (k1 > 0) {
        D.line([xi, -hb], [xi, hb], C.img, 4, [8, 5], k1); if (k1 > 0.8) D.text([xi, hb], '公布欄的像', C.img, { dy: -12, align: 'center', weight: 700 });
        if (k1 > 0.8) { D.dim([0, -2.3], [xm, -2.3], 'x + ' + fn(g.a), C.ink2); D.dim([xm, -2.3], [xi, -2.3], 'x + ' + fn(g.a), C.img); }
      }
      if (k2 > 0) {
        const top = [xi, hw], bot = [xi, -hw], mt = [xm, g.L / 2], mb = [xm, -g.L / 2];
        D.poly([E, top, bot], C.cone, k2); D.line(mt, top, C.ray, 1.4, [5, 4], k2); D.line(mb, bot, C.ray, 1.4, [5, 4], k2); D.line(E, mt, C.ray, 1.4, null, k2); D.line(E, mb, C.ray, 1.4, null, k2);
        if (k2 > 0.7) {
          D.line([xi, -vis], [xi, vis], C.good, 6); D.line([0, -vis], [0, vis], C.good, 6);
          if (short) { [[hb, vis], [-hb, -vis]].forEach(([a, b]) => { D.line([xi, a], [xi, b], C.bad, 6); D.line([0, a], [0, b], C.bad, 6); }); D.text([0, -hb], '看不到 ' + f1(hb - vis) + ' m', C.bad, { dx: 8, dy: 10, size: 12, bg: true }); }
          const ym = vis * g.a / (X + 2 * g.a);
          [[vis, ym], [-vis, -ym]].forEach(([yb, yy]) => { D.line([0, yb], [xm, yy], C.ray, 1.8); D.line([xm, yy], E, C.ray, 1.8); D.arrow(mid([0, yb], [xm, yy]), sub([xm, yy], [0, yb]), C.ray, 8); });
        }
      }
      if (k3 > 0) D.dim([X, -2.8], [xi, -2.8], '眼到像 x + ' + fn(2 * g.a), C.accent, k3);
      D.line([xm, -g.L / 2], [xm, g.L / 2], C.mirror, 5); D.dot(E, 4.5, C.ink); D.text(E, '眼', C.ink, { dx: -8, dy: 13, align: 'right', weight: 700 });
      /* 左上角放大插圖：眼睛與鏡子 */
      const iw = Math.min(250, Wpx * 0.44), ih = Math.min(122, Hpx * (Wpx < 520 ? 0.28 : 0.34)), bx = 10, by = 10;
      g2.save(); g2.fillStyle = C.surface; g2.strokeStyle = C.line2; g2.lineWidth = 1; g2.beginPath(); if (g2.roundRect) g2.roundRect(bx, by, iw, ih, 8); else g2.rect(bx, by, iw, ih); g2.fill(); g2.stroke();
      g2.font = '500 12px ' + FB; g2.fillStyle = C.ink2; g2.textBaseline = 'top'; g2.fillText('虛線框放大：眼睛與鏡子', bx + 9, by + 6);
      g2.beginPath(); g2.rect(bx + 1, by + 22, iw - 2, ih - 23); g2.clip();
      const ix0 = bx + 22, ix1 = bx + iw - 82, sxI = (ix1 - ix0) / g.a, cy = by + 22 + (ih - 22) / 2, syI = ((ih - 40) / 2) / (g.L / 2 * 1.15);
      const I = (x, y) => [ix0 + (x - X) * sxI, cy - y * syI];
      const ext = (g.a + (bx + iw - ix1) / sxI) / g.a;
      g2.strokeStyle = C.ray; g2.lineWidth = 1.4;
      [1, -1].forEach(sg => { const e = I(X, 0), m = I(xm, sg * g.L / 2), f = I(X + g.a * ext, sg * g.L / 2 * ext); g2.setLineDash([]); g2.beginPath(); g2.moveTo(e[0], e[1]); g2.lineTo(m[0], m[1]); g2.stroke(); g2.setLineDash([4, 3]); g2.beginPath(); g2.moveTo(m[0], m[1]); g2.lineTo(f[0], f[1]); g2.stroke(); });
      g2.setLineDash([]); g2.strokeStyle = C.mirror; g2.lineWidth = 4; const m1 = I(xm, g.L / 2), m2 = I(xm, -g.L / 2); g2.beginPath(); g2.moveTo(m1[0], m1[1]); g2.lineTo(m2[0], m2[1]); g2.stroke();
      const e = I(X, 0); g2.fillStyle = C.ink; g2.beginPath(); g2.arc(e[0], e[1], 4, 0, 7); g2.fill();
      g2.font = '600 12px ' + FM; g2.textBaseline = 'middle'; g2.fillStyle = C.mirror; g2.fillText('鏡長 ' + p.L + ' cm', m1[0] + 7, cy - 2);
      g2.fillStyle = C.ink2; g2.textAlign = 'center'; g2.fillText(p.a + ' cm', (e[0] + m1[0]) / 2, cy + 10);
      g2.restore();
      if (step === 0) return '俯視圖（左右依比例，前後方向放大 ' + f1(Math.abs(st.v.sy / st.v.sx)) + ' 倍）。左上角放大了眼睛與鏡子。';
      if (step === 1) return lg(C.img, '公布欄的像', true) + '像距 = 物距 = x + ' + fn(g.a) + ' m';
      if (step === 2) return lg(C.ray, '視線與真實光路') + lg(C.good, '看得到') + (short ? lg(C.bad, '看不到') : '') + '可見寬 <b>' + f1(g.w) + ' m</b>';
      if (step === 3) return M(fn(g.L) + ' ÷ ' + fn(g.a) + ' = ' + fn(g.Bd) + ' ÷ (x + ' + fn(2 * g.a) + ')') + '　→　x + ' + fn(2 * g.a) + ' = ' + fn(g.Bd * g.a / g.L);
      if (W) return '目前 x = ' + fn(X) + ' m，可見寬 <b>' + f1(g.w) + ' m</b>' + (short ? '，看不到整面' : '，看得到整面');
      return '可見寬 ' + f1(g.w) + ' m';
    }
  };

  /* ───── Ka-IV-8-904：方格紙上的平面鏡（自編） ───── */
  const HS = 0.4;
  function visCard(E, c, m) {
    let lo = 1e9, hi = -1e9;
    const res = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([u, w]) => {
      const q = [c[0] + u * HS, c[1] + w * HS], qi = [q[0], 2 * m.y - q[1]], t = (m.y - E[1]) / (qi[1] - E[1]), x = E[0] + t * (qi[0] - E[0]);
      lo = Math.min(lo, x); hi = Math.max(hi, x); return { q, qi, x };
    });
    const status = (lo >= m.x0 - 1e-9 && hi <= m.x1 + 1e-9) ? 'full' : ((hi < m.x0 || lo > m.x1) ? 'none' : 'part');
    return { res, lo, hi, status };
  }
  const ST = { full: '完整', part: '只看到一部分', none: '看不到' };
  const gridMirror = {
    ratio: 0.9, drag: true,
    defaults: { E: [7.5, 1.5], mirror: { x0: 3, x1: 5, y: 4 }, cards: { P: [0.5, 1.5], Q: [2.5, 1.5], R: [4.5, 0.5] } },
    dragHint: '可以在圖上直接拖動 E 或卡片（以 ¼ 格對齊）。',
    focus: { A: 'P', B: 'Q', C: 'R', D: 'P' },
    view: () => null,
    fitView: (W, H) => fit(W, H, { x0: -0.8, x1: 8.6, y0: -0.5, y1: 8.4 }, 12, false),
    steps: [
      { t: '讀圖：俯視的方格紙', b: () => '鏡子豎立在紙上，反射面朝向卡片，E 是眼睛的位置。這是從正上方往下看的俯視圖。' },
      { t: '作出卡片的像', b: () => '以鏡面所在的直線為對稱軸，作出 P、Q、R 的像（像的字會上下顛倒）。作圖時鏡面要延長，像的位置跟鏡子多長無關。' },
      { t: '連線要穿過鏡子本身', b: () => '看得到某一點的像，條件是 E 到那個像的連線必須穿過鏡子。綠線落在鏡子上，紅線只碰到延長線。黃色細線是真正的光路：從卡片出發，在鏡面反射後進入 E。' },
      { t: '另一種看法：鏡中視野', b: () => '把 E 也鏡射成 E′，從 E′ 穿過鏡子兩端畫線，夾出的綠色扇形就是從 E 在鏡中看得到的範圍。整張卡片都在扇形裡，才看得到完整的像。' },
      { t: '答案', b: p => { const s = k => ST[visCard(p.E, p.cards[k], p.mirror).status]; return '目前：P ' + s('P') + '，Q ' + s('Q') + '，R ' + s('R') + '。題目配置下只有 P 完整，答案 <b>(A)</b>。離 E 最遠的 P 反而看得到；正對鏡子的 R 卻看不到。'; } }
    ],
    check: p => ['P', 'Q', 'R'].map(k => k + ' ' + ST[visCard(p.E, p.cards[k], p.mirror).status]).join('　｜　') + '　（條件：連線與鏡面的交點落在鏡子上）',
    draw(D, st, p, on) {
      const step = st.step, W = st.world, fin = step >= 4, focus = W ? this.focus[W] : null, E = p.E, m = p.mirror;
      for (let i = 0; i <= 7; i++) D.line([i, 0], [i, 8], C.line, 1);
      for (let j = 0; j <= 8; j++) D.line([0, j], [7, j], C.line, 1);
      D.rect([0, 0], [7, 8], null, C.line2, 1.2);
      const k1 = on(1), k2 = on(2), k3 = on(3);
      if (k1 > 0) { D.line([-0.8, m.y], [8.6, m.y], C.normal, 1.1, [6, 4], k1); if (k1 > 0.8) D.text([-0.7, m.y], '鏡面延長線', C.normal, { dy: -10, size: 12 }); }
      if (k3 > 0) {
        const Ep = [E[0], 2 * m.y - E[1]]; D.line(E, Ep, C.img, 1, [2, 4], k3);
        const far = x => { const d = sub([x, m.y], Ep), t = (-0.5 - Ep[1]) / d[1]; return add(Ep, mul(d, t)); };
        const a0 = far(m.x0), a1 = far(m.x1);
        D.poly([[m.x0, m.y], [m.x1, m.y], a1, a0], C.fgood, k3); D.line(Ep, a0, C.img, 1.2, [6, 4], k3); D.line(Ep, a1, C.img, 1.2, [6, 4], k3);
        if (k3 > 0.8) { D.dot(Ep, 5, C.img); D.text(Ep, 'E′', C.img, { dx: 10, mono: true, weight: 700, size: 14 }); }
      }
      D.rect([m.x0, m.y], [m.x1, m.y + 0.28], C.mirror, null, 0, null, 0.85); D.line([m.x0, m.y], [m.x1, m.y], C.mirror, 3);
      D.text([(m.x0 + m.x1) / 2, m.y + 0.28], '平面鏡', C.ink2, { dy: 11, align: 'center', size: 12 });
      const cell = Math.abs(D.T([1, 0])[0] - D.T([0, 0])[0]);
      Object.keys(p.cards).forEach(k => {
        const c = p.cards[k], vi = visCard(E, c, m), isF = focus === k, alpha = focus && !isF ? 0.3 : 1;
        if (k1 > 0) { const ci = [c[0], 2 * m.y - c[1]]; D.rect([ci[0] - HS, ci[1] - HS], [ci[0] + HS, ci[1] + HS], null, C.img, 1.5, [4, 3], k1); if (k1 > 0.8) D.letter(ci, k, C.img, cell * 0.5, true, 0.9); }
        if (k2 > 0) {
          const ext = vi.res.slice().sort((a, b) => a.x - b.x), pick = [ext[0], ext[3]];
          pick.forEach(r => {
            const inM = r.x >= m.x0 - 1e-9 && r.x <= m.x1 + 1e-9, col = inM ? C.good : C.bad, w = isF ? 2.6 : 1.5, xp = [r.x, m.y];
            D.line(E, xp, col, w, null, k2, alpha); D.line(xp, r.qi, col, w * 0.8, [4, 4], k2, alpha * 0.6);
            if (k2 > 0.8) { D.dot(xp, 3, col, alpha); if (inM) D.line(r.q, xp, C.ray, 1.4, null, 1, alpha); }
          });
          if (k2 > 0.8) { const ci = [c[0], 2 * m.y - c[1]], col = vi.status === 'full' ? C.good : vi.status === 'part' ? C.ray : C.bad; D.text(ci, ST[vi.status], col, { dy: cell * 0.72, align: 'center', size: 12, weight: 700, bg: true, alpha }); }
        }
        const good = fin && vi.status === 'full';
        D.rect([c[0] - HS, c[1] - HS], [c[0] + HS, c[1] + HS], C.surface, good ? C.good : C.obj, good ? 3 : 1.8); D.letter(c, k, C.ink, cell * 0.5, false);
      });
      D.dot(E, 8, C.surface); D.dot(E, 5.5, C.ink); D.text(E, 'E', C.ink, { dx: 11, mono: true, weight: 700, size: 15 });
      if (step === 0) return lg(C.mirror, '鏡子（反射面朝上）') + lg(C.obj, '卡片') + '可拖動 E 與卡片';
      if (step === 1) return lg(C.img, '卡片的像（上下顛倒）', true) + lg(C.normal, '鏡面延長線', true);
      if (step === 2) return lg(C.good, '連線穿過鏡子') + lg(C.bad, '只碰到延長線') + lg(C.ray, '真實光路');
      if (step === 3) return lg(C.img, 'E 的像 E′', true) + '綠色扇形 = 鏡中視野';
      if (W) return null;
      return this.check(p).split('　（')[0];
    },
    hit(p, w) { if (len(sub(w, p.E)) < 0.55) return 'E'; for (const k of Object.keys(p.cards)) { const c = p.cards[k]; if (Math.abs(w[0] - c[0]) < 0.55 && Math.abs(w[1] - c[1]) < 0.55) return k; } return null; },
    move(p, key, w) {
      const s = x => Math.round(x * 4) / 4, x = Math.max(-0.5, Math.min(8.2, s(w[0]))), y = Math.max(-0.25, Math.min(p.mirror.y - 0.6, s(w[1])));
      if (key === 'E') p.E = [x, y]; else p.cards[key] = [x, y];
    }
  };
  gridMirror.view = gridMirror.fitView;

  window.PC_ENGINES = { droplet, 'two-mirrors': twoMirrors, 'mirror-board': mirrorBoard, 'grid-mirror': gridMirror };
  Object.defineProperty(window.PC_ENGINES, '_pen', { value: pen, enumerable: false });
})();
