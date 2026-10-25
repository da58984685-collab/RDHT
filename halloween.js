/* [THEME:HALLOWEEN] 할로윈 테마 스위치
 *
 * 하는 일
 *   - 서버가 '할로윈 테마가 켜져 있다고 알려 줄 때만 halloween.css 를 불러오고, 박쥐·거미·유령·잭오랜턴 장식을 화면에 올립니다.
 *   - 관리자 페이지 '화면 테마'에서 할로윈을 고르면 켜지고, 다른 테마를 고르면 다음 접속·5분 안에 오리지널 화면으로 돌아옵니다. (기간이 끝났다고 저절로 꺼지지 않음)
 *   - 이 파일이 없어도(또는 index.html 의 <script src="/halloween.js"> 한 줄을 지워도) 게임은 원래대로 동작합니다.
 *
 * 미리 보기: 주소 끝에 ?hlw=1 (해제는 ?hlw=0). 이벤트 상태와 상관없이 이 브라우저 탭에서만 적용됩니다.
 */
(function () {
  "use strict";
  var KEY = "hlw_theme", CSS = "/halloween.css?v=1";
  try { var cs = document.currentScript && document.currentScript.src; if (cs) CSS = cs.replace(/[^\/]*$/, "") + "halloween.css?v=1"; } catch (e) {}      // 이 파일과 같은 폴더에서 불러옴
  var on = false, deco = null, foot = null, saved = {}, FORCE = null;

  function lsGet() { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function lsSet(v) { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch (e) {} }
  try {
    var q = /[?&]hlw=([01])/.exec(location.search);
    if (q) sessionStorage.setItem("hlw_force", q[1]);
    FORCE = sessionStorage.getItem("hlw_force");
  } catch (e) {}

  function ready(fn) {
    if (document.body) fn(); else document.addEventListener("DOMContentLoaded", fn);
  }
  function el(cls, style) { var d = document.createElement("i"); d.className = cls; if (style) d.style.cssText = style; return d; }

  function decorate() {
    if (deco) return;
    document.documentElement.classList.add("hlw");
    deco = document.createElement("div"); deco.id = "hwd"; deco.setAttribute("aria-hidden", "true");
    deco.appendChild(el("hw-web l")); deco.appendChild(el("hw-web r")); deco.appendChild(el("hw-spw"));
    [[9, 26, 0, ""], [21, 31, -11, "s2"], [38, 23, -17, ""], [63, 34, -6, "s2"], [80, 28, -21, ""]].forEach(function (b) {
      deco.appendChild(el("hw-bat " + b[3], "top:" + b[0] + "%;--d:" + b[1] + "s;--w:" + b[2] + "s"));
    });
    document.body.appendChild(deco);
    // 문서 맨 아래 장식 줄 (화면을 가리지 않도록 일반 흐름 안에 둠)
    foot = document.createElement("div"); foot.className = "hw-foot"; foot.setAttribute("aria-hidden", "true");
    ["cn", "pk b", "sk", "pk", "hat", "gh", "pk b", "cn"].forEach(function (c) { foot.appendChild(el(c)); });
    document.body.appendChild(foot);
    // 아이콘: 하트 모양 → 작은 잭오랜턴 (로그인 화면 제목·회원가입 버튼·상단 바에 쓰임)
    var sym = document.getElementById("i-heart");
    if (sym && saved.heart === undefined) {
      saved.heart = sym.innerHTML;
      sym.innerHTML = '<path d="M3 0h1v1H3zM1 1h5v1H1zM0 2h7v1H0zM0 3h1v1H0zM2 3h3v1H2zM6 3h1v1H6zM0 4h7v1H0zM0 5h1v1H0zM2 5h1v1H2zM4 5h1v1H4zM6 5h1v1H6zM1 6h5v1H1z"/>';
    }
    // 문구
    saved.text = [];
    [[".eyebrow", "RED MOON GATE", "HALLOWEEN GATE"], [".hero .desc", "게이트가 열렸습니다.", "할로윈 밤, 게이트가 열렸습니다."]].forEach(function (r) {
      Array.prototype.forEach.call(document.querySelectorAll(r[0]), function (n) {
        if (n.textContent.trim() === r[1]) { saved.text.push([n, r[1], r[2]]); n.textContent = r[2]; }
      });
    });
    // 탭 아이콘
    var ic = document.querySelector('link[rel="icon"]');
    if (ic && saved.icon === undefined) {
      saved.icon = ic.getAttribute("href");
      ic.setAttribute("href", "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><path fill="#6cc04a" d="M4 0h1v1H4z"/><path fill="#ff8a1f" d="M2 1h4v1H2zM1 2h6v4H1zM2 6h4v1H2z"/><path fill="#14081f" d="M2 3h1v1H2zM5 3h1v1H5zM3 5h2v1H3z"/></svg>'));
    }
  }
  function undecorate() {
    document.documentElement.classList.remove("hlw");
    if (deco) { deco.remove(); deco = null; }
    if (foot) { foot.remove(); foot = null; }
    var sym = document.getElementById("i-heart");
    if (sym && saved.heart !== undefined) { sym.innerHTML = saved.heart; }
    saved.heart = undefined;
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
      if (early && document.readyState === "loading") document.write('<link rel="stylesheet" id="hlwcss" href="' + CSS + '">');
      else if (!document.getElementById("hlwcss")) { var l = document.createElement("link"); l.rel = "stylesheet"; l.id = "hlwcss"; l.href = CSS; document.head.appendChild(l); }
      ready(decorate);
    } else {
      var c = document.getElementById("hlwcss"); if (c) c.remove();
      undecorate();
    }
  }
  window.hlwSet = setOn;

  // 1) 첫 화면: 지난번에 켜져 있었으면 깜빡임 없이 바로 적용
  setOn(FORCE === "1" || (FORCE !== "0" && lsGet()), true);

  // 2) 서버에 물어서 확정 (이벤트가 끝났으면 여기서 원래대로 돌아감)
  function ask() {
    if (FORCE !== null) return;
    fetch("/api/maintenance", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || typeof j.hlw !== "boolean") return;      // 서버가 분명하게 true/false 로 알려 줄 때만 바꿈 (이상한 응답이면 지금 상태 유지)
      var v = j.hlw; lsSet(v); setOn(v, false);
    }).catch(function () {});
  }
  ask();
  setInterval(function () { if (!document.hidden) ask(); }, 300000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) ask(); });
})();
