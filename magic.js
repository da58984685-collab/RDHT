/* [THEME:MAGICAL] 마법소녀 테마 스위치
 *
 * 하는 일
 *   - 서버가 '마법소녀 이벤트 진행 중'이라고 알려 줄 때만 magic.css 를 불러오고, 반짝이·별똥별·초승달·하트·리본 장식을 화면에 올립니다.
 *   - 이벤트가 꺼지면(관리자 페이지 '끄기') 다음 접속·5분 안에 자동으로 오리지널 화면으로 돌아옵니다.
 *   - 이 파일이 없어도(또는 index.html 의 <script src="/magic.js"> 한 줄을 지워도) 게임은 원래대로 동작합니다.
 *
 * 미리 보기: 주소 끝에 ?mgl=1 (해제는 ?mgl=0). 이벤트 상태와 상관없이 이 브라우저 탭에서만 적용됩니다.
 */
(function () {
  "use strict";
  var KEY = "mgl_theme", CSS = "/magic.css?v=1";
  try { var cs = document.currentScript && document.currentScript.src; if (cs) CSS = cs.replace(/[^\/]*$/, "") + "magic.css?v=1"; } catch (e) {}      // 이 파일과 같은 폴더에서 불러옴 (파일을 직접 열어 미리보기할 때도 동작)
  var on = false, deco = null, foot = null, saved = {}, FORCE = null, night = false, NKEY = "mgl_night", sws = [];

  function lsGet() { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function lsSet(v) { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch (e) {} }
  try {
    var q = /[?&]mgl=([01])/.exec(location.search);
    if (q) sessionStorage.setItem("mgl_force", q[1]);
    FORCE = sessionStorage.getItem("mgl_force");
  } catch (e) {}

  function nGet() { try { return localStorage.getItem(NKEY) === "1"; } catch (e) { return false; } }
  function nSet(v) { try { localStorage.setItem(NKEY, v ? "1" : "0"); } catch (e) {} }
  night = nGet();
  /* 낮·밤 하늘 스위치 (Lucian UX/UI Prompt #021 · MIT License (c) 2026 Seokwoooo): 마법소녀 화면에서만 나타나는 밤 모드 스위치 */
  function mkSwitch(cls) {
    var w = document.createElement("div"); w.className = "u021" + (cls ? " " + cls : "") + (night ? " is-night" : "");
    w.innerHTML = '<button class="u021-sw" type="button" role="switch" aria-checked="' + night + '" aria-label="밤 모드">' +
      '<span class="u021-halo" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<span class="u021-stars" aria-hidden="true"><i style="left:30px;top:20px"></i><i style="left:58px;top:56px;animation-delay:-.6s;width:3px;height:3px"></i><i style="left:86px;top:26px;animation-delay:-1.2s"></i><i style="left:44px;top:72px;animation-delay:-1.8s;width:3px;height:3px"></i><i style="left:110px;top:60px;animation-delay:-.9s;width:2px;height:2px"></i><i style="left:20px;top:46px;animation-delay:-1.5s;width:2px;height:2px"></i></span>' +
      '<span class="u021-clouds" aria-hidden="true"><i></i><i></i></span>' +
      '<span class="u021-knob" aria-hidden="true"><span class="u021-moon"><i></i><i></i><i></i></span></span></button>';
    w.querySelector("button").addEventListener("click", function () { setNight(!night); });
    sws.push(w); return w;
  }
  /* ── 낮 ↔ 밤 전환: 리퀴드 트랜지션 ──
     Motion Prompt #019 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#019
     원본: 물감 같은 액체가 위에서 흘러내려 화면을 채우고 다음 화면이 됨. 원본의 두 번째 층(다음 화면을 액체 모양으로 자른 것)은
     화면(DOM)을 캔버스에 그릴 수 없어서, 색 액체가 화면을 다 덮은 순간 테마를 바꾸고 같은 모양의 액체 앞면이 색 층을 지워 새 화면을 드러내는 방식으로 옮김.
     모양·모션 값은 원본 그대로: 앞면 -110px → 높이+130px, 2차 이징(easeInOutQuad), 물결 13px·8px, 물방울 7개(굵기 30~54px), 블러 7px + 알파 임계값. */
  var LQ = (function () {
    function rand(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
    var lerp = function (a, b, x) { return a + (b - a) * x; }, clamp = function (x) { return Math.min(1, Math.max(0, x)); };
    var eIOs = function (x) { return x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; };
    var K = 0.4;      // 계산용 캔버스 배율 (전체 화면을 그대로 블러·임계값 처리하면 무거워서 40% 크기로 그리고 늘림)
    var cv = null, g = null, G0 = null, g0 = null, busy = false;
    function drips(set, w) { var R = rand(190 + set * 7), a = [], n = Math.max(7, Math.round(w / 78)); for (var i = 0; i < n; i++) a.push({ x: 36 + i * (w / n) + (R() - 0.5) * 30, len: 30 + R() * 80, wd: 15 + R() * 12 }); return a; }
    function shape(c, w, h, p, set, u, D) {
      var base = lerp(-110, h + 130, p), amp = Math.sin(Math.PI * clamp(p * 1.1));
      c.beginPath(); c.moveTo(-20, -40);
      for (var x = -20; x <= w + 20; x += 10) c.lineTo(x, base + amp * (13 * Math.sin(x * 0.021 + u * 3 + set) + 8 * Math.sin(x * 0.05 + u * 4.3)));
      c.lineTo(w + 20, -40); c.closePath(); c.fill();
      D.forEach(function (d) { var L = d.len * (0.25 + amp * 0.9), y0 = base - 20; c.beginPath(); if (c.roundRect) c.roundRect(d.x - d.wd, y0, d.wd * 2, L + 20, d.wd); else c.rect(d.x - d.wd, y0, d.wd * 2, L + 20); c.fill(); c.beginPath(); c.arc(d.x, y0 + L + 18, d.wd * 1.25, 0, 7); c.fill(); });
    }
    // goo: 흰색으로 그리고 → 블러 7px → 알파 임계값(112~144) → 결과 모양
    function goo(W, H, draw) {
      g0.setTransform(1, 0, 0, 1, 0, 0); g0.clearRect(0, 0, W, H); g0.fillStyle = "#fff"; g0.setTransform(K, 0, 0, K, 0, 0); draw(g0); g0.setTransform(1, 0, 0, 1, 0, 0);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "copy"; g.filter = "blur(" + (7 * K) + "px)"; g.drawImage(G0, 0, 0); g.filter = "none"; g.restore();
      var im = g.getImageData(0, 0, W, H), d = im.data;
      for (var i = 3; i < d.length; i += 4) { var al = d[i]; d[i] = al < 112 ? 0 : al > 144 ? 255 : (al - 112) * 8; }
      return im;
    }
    function run(toNight, swap) {
      var rm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (rm || busy || !document.body) { swap(); return; }
      busy = true;
      var vw = window.innerWidth, vh = window.innerHeight, W = Math.ceil(vw * K), H = Math.ceil(vh * K);
      cv = document.createElement("canvas"); cv.width = W; cv.height = H; cv.setAttribute("aria-hidden", "true");
      cv.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483000;pointer-events:none";
      g = cv.getContext("2d", { willReadFrequently: true }); G0 = document.createElement("canvas"); G0.width = W; G0.height = H; g0 = G0.getContext("2d");
      document.body.appendChild(cv);
      // 물감 색: 넘어갈 테마의 바탕색에 맞춘 차분한 색 (낮→밤: 밤 모드의 어두운 자두색, 밤→낮: 낮 모드의 연한 분홍) · 채도 낮게
      var col = toNight ? "#3b2531" : "#f2dde6";
      var D0 = drips(0, vw), D1 = drips(1, vw), t0 = performance.now(), swapped = false;
      var A = 1150, B = 1100;      // 원본 구간: 색 액체 0.35~1.5s(1.15s) · 다음 화면 0.7~1.8s(1.1s)
      var tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H; var tg = tmp.getContext("2d");
      function frame(now) {
        var t = now - t0, u = t / 1000;
        if (t < A) {      // 1단계: 색 액체가 위에서 흘러내려 화면을 덮음
          var p1 = eIOs(clamp(t / A)), m1 = goo(W, H, function (c) { shape(c, vw, vh, p1, 0, u, D0); });
          g.putImageData(m1, 0, 0); g.globalCompositeOperation = "source-atop"; g.fillStyle = col; g.fillRect(0, 0, W, H); g.globalCompositeOperation = "source-over";
        } else {
          if (!swapped) { swapped = true; swap(); }
          var p2 = eIOs(clamp((t - A) / B));      // 2단계: 두 번째 액체 앞면이 색 층을 지우며 새 화면을 드러냄
          var m2 = goo(W, H, function (c) { shape(c, vw, vh, p2, 1, u + 1, D1); });
          tg.putImageData(m2, 0, 0);
          g.globalCompositeOperation = "copy"; g.fillStyle = col; g.fillRect(0, 0, W, H);
          g.globalCompositeOperation = "destination-out"; g.drawImage(tmp, 0, 0); g.globalCompositeOperation = "source-over";
          if (p2 >= 1) { cv.remove(); cv = null; busy = false; return; }
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
    return { run: run };
  })();
  function setNight(v) {
    var to = !!v;
    if (to !== night && on && document.documentElement.classList.contains("mgl")) {      // 마법소녀 화면에서 스위치를 눌렀을 때만 리퀴드 전환
      sws.forEach(function (w) { w.classList.toggle("is-night", to); w.querySelector("button").setAttribute("aria-checked", String(to)); });
      LQ.run(to, function () { applyNight(to); });
      return;
    }
    applyNight(to);
  }
  function applyNight(v) {
    night = !!v; nSet(night);
    document.documentElement.classList.toggle("mgn", night && on);
    sws.forEach(function (w) { w.classList.toggle("is-night", night); w.querySelector("button").setAttribute("aria-checked", String(night)); });
  }
  function addSwitches() {
    var hero = document.querySelector(".hero .body"), gate = document.querySelector("#gate .gate"), hud = document.querySelector(".hud-r");
    [[hero, "big"], [gate, "big"], [hud, ""]].forEach(function (p) {
      if (!p[0]) return;
      var w = mkSwitch(p[1]), ref = p[0].querySelector(".fxlink");
      if (p[1]) p[0].insertBefore(w, ref || null); else p[0].insertBefore(w, p[0].firstChild);
    });
  }
  function removeSwitches() { sws.forEach(function (w) { w.remove(); }); sws = []; document.documentElement.classList.remove("mgn"); }

  function ready(fn) {
    if (document.body) fn(); else document.addEventListener("DOMContentLoaded", fn);
  }
  function el(cls, style) { var d = document.createElement("i"); d.className = cls; if (style) d.style.cssText = style; return d; }

  function decorate() {
    if (deco || !on) return;      // 페이지가 다 그려지기 전에 서버가 '꺼짐'이라고 답했으면 장식하지 않음
    document.documentElement.classList.add("mgl");
    if (night) document.documentElement.classList.add("mgn");
    addSwitches();
    deco = document.createElement("div"); deco.id = "mgd"; deco.setAttribute("aria-hidden", "true");
    // 초승달·별똥별은 배경(#bg) 안에 두어 패널과 버튼을 가리지 않게 합니다
    var bg = document.getElementById("bg") || deco;
    saved.bgDeco = [el("mg-moon"), el("mg-shoot")];
    saved.bgDeco.forEach(function (n) { bg.appendChild(n); });
    // 반짝이: [위 %, 왼쪽 %, 주기 s, 시작 지연 s, 종류]
    [[7, 12, 3.4, 0, "l"], [14, 46, 2.8, -1.1, "b"], [5, 70, 3.9, -2.2, ""], [26, 88, 3.1, -0.6, "b"], [33, 6, 4.2, -2.9, ""],
     [48, 94, 3.6, -1.7, "l"], [62, 3, 2.9, -0.3, "b"], [74, 90, 3.3, -2.4, ""], [85, 18, 4.0, -1.4, "l b"], [92, 64, 3.0, -0.9, ""]].forEach(function (s) {
      deco.appendChild(el("mg-tw " + s[4], "top:" + s[0] + "%;left:" + s[1] + "%;--d:" + s[2] + "s;--w:" + s[3] + "s"));
    });
    document.body.appendChild(deco);
    // 문서 맨 아래 장식 줄 (화면을 가리지 않도록 일반 흐름 안에 둠)
    foot = document.createElement("div"); foot.className = "mg-foot"; foot.setAttribute("aria-hidden", "true");
    ["mn", "st s", "ht", "wd", "rb", "st", "ht", "mn"].forEach(function (c) { foot.appendChild(el(c)); });
    document.body.appendChild(foot);
    // 문구
    saved.text = [];
    [[".eyebrow", "RED MOON GATE", "STARLIGHT GATE"], [".hero .desc", "게이트가 열렸습니다.", "별빛이 내린 밤, 게이트가 열렸습니다."]].forEach(function (r) {
      Array.prototype.forEach.call(document.querySelectorAll(r[0]), function (n) {
        if (n.textContent.trim() === r[1]) { saved.text.push([n, r[1], r[2]]); n.textContent = r[2]; }
      });
    });
    // 탭 아이콘: 분홍 별
    var ic = document.querySelector('link[rel="icon"]');
    if (ic && saved.icon === undefined) {
      saved.icon = ic.getAttribute("href");
      ic.setAttribute("href", "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><path fill="#ff8fc8" d="M3 0h2v2H3zM0 2h8v2H0zM1 4h6v1H1zM1 5h2v2H1zM5 5h2v2H5zM0 7h2v1H0zM6 7h2v1H6z"/><path fill="#fff6fb" d="M3 2h1v1H3z"/></svg>'));
    }
  }
  function undecorate() {
    document.documentElement.classList.remove("mgl");
    removeSwitches();
    if (deco) { deco.remove(); deco = null; }
    if (foot) { foot.remove(); foot = null; }
    (saved.bgDeco || []).forEach(function (n) { n.remove(); }); saved.bgDeco = [];
    (saved.text || []).forEach(function (t) { if (t[0].textContent.trim() === t[2]) t[0].textContent = t[1]; });
    saved.text = [];
    var ic = document.querySelector('link[rel="icon"]');
    if (ic && saved.icon !== undefined) ic.setAttribute("href", saved.icon);
    saved.icon = undefined;
  }

  function setOn(v, early) {
    v = !!v;
    if (v === on) return;
    on = v;
    if (v) {
      if (early && document.readyState === "loading") document.write('<link rel="stylesheet" id="mglcss" href="' + CSS + '">');
      else if (!document.getElementById("mglcss")) { var l = document.createElement("link"); l.rel = "stylesheet"; l.id = "mglcss"; l.href = CSS; document.head.appendChild(l); }
      ready(decorate);
    } else {
      var c = document.getElementById("mglcss"); if (c) c.remove();
      undecorate();
    }
  }
  window.mglSet = setOn;

  // 1) 첫 화면: 지난번에 켜져 있었으면 깜빡임 없이 바로 적용
  setOn(FORCE === "1" || (FORCE !== "0" && lsGet()), true);

  // 2) 서버에 물어서 확정 (이벤트가 끝났으면 여기서 원래대로 돌아감)
  function ask() {
    if (FORCE !== null) return;
    fetch("/api/maintenance", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j) return;
      var v = !!j.mgl; lsSet(v); setOn(v, false);
    }).catch(function () {});
  }
  ask();
  setInterval(function () { if (!document.hidden) ask(); }, 300000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) ask(); });
})();
