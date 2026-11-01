/* Lucian UX/UI Prompt #228 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#228 */
/* Lucian UX/UI Prompt #013 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#013 */
/* 화면 다듬기 (ui.css 와 짝). 이 파일이 없어도 게임은 그대로 동작합니다.
 *   1) 창 테두리 커서 빛 (#228): 같은 무리(게임 격자·첫 화면·대화창)의 창마다 커서 좌표를 넣어, 한 점 조명이 여러 창을 함께 비춥니다.
 *   2) 늘어나는 스위치 (#013): 설정 스위치를 바꿀 때 손잡이가 잠깐 늘어났다 튕기도록 .is-stretch 를 붙입니다. */
(function () {
  "use strict";
  var rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var GROUP = ".g-grid,.hero,.gate,.dialog";
  var cur = null, live = [];

  function cards(g) {
    var list = g.matches("section,.dialog") ? [g] : [];
    return list.concat([].slice.call(g.querySelectorAll("section")));
  }
  /* 렉 줄이기: 창 위치(rect)는 무리에 들어올 때·스크롤·크기 변경 때만 다시 재고(읽기와 쓰기를 섞지 않음),
     커서에서 먼(빛이 닿지 않는) 창은 한 번만 꺼 두고 매 프레임 다시 칠하지 않습니다. 빛 모양·세기·움직임은 그대로. */
  var REACH = 240;      // 빛 반경(220px) + 여유: 창 가장자리에서 이보다 멀면 빛이 보이지 않음
  function measure(s) { s.rects = s.cards.map(function (el) { var r = el.getBoundingClientRect(); return { l: r.left + el.clientLeft, t: r.top + el.clientTop, L: r.left, T: r.top, R: r.right, B: r.bottom }; }); s.dirty = false; }
  function apply(s) {
    if (s.dirty || !s.rects || s.rects.length !== s.cards.length) measure(s);
    for (var i = 0; i < s.cards.length; i++) {
      var el = s.cards[i], r = s.rects[i];
      var dx = Math.max(r.L - s.x, 0, s.x - r.R), dy = Math.max(r.T - s.y, 0, s.y - r.B), near = dx * dx + dy * dy < REACH * REACH;
      if (!near) { if (el.__uiOn) { el.__uiOn = false; el.style.setProperty("--o", "0"); } continue; }
      el.__uiOn = true;
      el.style.setProperty("--cx", (s.x - r.l).toFixed(1) + "px");
      el.style.setProperty("--cy", (s.y - r.t).toFixed(1) + "px");
      el.style.setProperty("--o", s.o.toFixed(3));
    }
  }
  function dirtyAll() { live.forEach(function (s) { s.dirty = true; }); if (cur) state(cur).dirty = true; }
  window.addEventListener("scroll", dirtyAll, { passive: true, capture: true });
  window.addEventListener("resize", dirtyAll, { passive: true });
  function frame(now) {
    live = live.filter(function (s) {
      var dt = Math.min(0.05, Math.max(0, (now - s.last) / 1000)); s.last = now;
      s.o += (s.oT - s.o) * (rm ? 1 : Math.min(1, dt * (s.oT ? 8 : 2.5)));
      if (!s.oT && s.o < 0.005) s.o = 0;
      apply(s); s.moved = false;
      if (Math.abs(s.oT - s.o) > 0.005) return true;
      s.run = false; return false;
    });
    if (live.length) requestAnimationFrame(frame);
  }
  function kick(s) {
    if (s.run) return;
    s.run = true; s.last = performance.now();
    if (live.push(s) === 1) requestAnimationFrame(frame);
  }
  function state(g) { return g.__uiLight || (g.__uiLight = { x: -500, y: -500, o: 0, oT: 0, run: false, last: 0, cards: [], rects: null, dirty: true, moved: false }); }
  function leave() { if (cur) { var s = state(cur); s.oT = 0; kick(s); cur = null; } }

  if (window.matchMedia("(hover: hover)").matches) {
    document.addEventListener("pointermove", function (e) {
      var g = e.target && e.target.closest ? e.target.closest(GROUP) : null;
      if (g !== cur) { leave(); cur = g; if (g) { var st0 = state(g); st0.cards = cards(g); st0.dirty = true; } }
      if (!g) return;
      var s = state(g); s.x = e.clientX; s.y = e.clientY; s.oT = 1;
      if (!s.run) { s.o = Math.max(s.o, 0); }
      s.moved = true; kick(s);      /* 칠하기는 다음 프레임(requestAnimationFrame)에서 한 번만 */
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
  }

  var SW = "#gpriv,input[id^='gwn-'],input[id^='hpn-']";
  document.addEventListener("change", function (e) {
    var el = e.target;
    if (rm || !el.matches || !el.matches(SW)) return;
    el.classList.add("is-stretch");
    clearTimeout(el.__uiT);
    el.__uiT = setTimeout(function () { el.classList.remove("is-stretch"); }, 170);
  });
})();
