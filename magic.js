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
  function setNight(v) {
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
