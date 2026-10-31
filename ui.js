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
  function apply(s) {
    s.cards.forEach(function (el) {
      var r = el.getBoundingClientRect();
      el.style.setProperty("--cx", (s.x - r.left - el.clientLeft).toFixed(1) + "px");
      el.style.setProperty("--cy", (s.y - r.top - el.clientTop).toFixed(1) + "px");
      el.style.setProperty("--o", s.o.toFixed(3));
    });
  }
  function frame(now) {
    live = live.filter(function (s) {
      var dt = Math.min(0.05, Math.max(0, (now - s.last) / 1000)); s.last = now;
      s.o += (s.oT - s.o) * (rm ? 1 : Math.min(1, dt * (s.oT ? 8 : 2.5)));
      if (!s.oT && s.o < 0.005) s.o = 0;
      apply(s);
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
  function state(g) { return g.__uiLight || (g.__uiLight = { x: -500, y: -500, o: 0, oT: 0, run: false, last: 0, cards: [] }); }
  function leave() { if (cur) { var s = state(cur); s.oT = 0; kick(s); cur = null; } }

  if (window.matchMedia("(hover: hover)").matches) {
    document.addEventListener("pointermove", function (e) {
      var g = e.target && e.target.closest ? e.target.closest(GROUP) : null;
      if (g !== cur) { leave(); cur = g; if (g) state(g).cards = cards(g); }
      if (!g) return;
      var s = state(g); s.x = e.clientX; s.y = e.clientY; s.oT = 1;
      apply(s); kick(s);
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
