/* 농장 앱 (기기 → 농장): 밭 · 정원 · 출하 · 도감
 * 서버: api/_farm.js — 판정·보상은 모두 서버가 정하고, 이 파일은 화면만 그립니다.
 * index.html 의 기기 앱 목록에서 window.FARM.mount(화면) 으로 엽니다. */
(function () {
  "use strict";
  var TIER = { c: "일반", r: "희귀", e: "영웅", l: "전설" };
  var INST = [];      // 화면에 떠 있는 칸들 (농장 칸 · 화분 칸) — 한 칸에서 무언가 하면 다른 칸도 같은 결과로 다시 그림

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function btn(c, x, fn) { var b = el("button", c, x); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; }
  function call(m, p, b) { return window.api ? window.api(m, p, b) : Promise.resolve({ error: "no_api" }); }
  function dur(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    return h ? h + "시간 " + (m < 10 ? "0" : "") + m + "분" : m ? m + "분 " + (ss < 10 ? "0" : "") + ss + "초" : ss + "초";
  }
  function mins(n) { return n >= 60 ? (n / 60 % 1 ? (n / 60).toFixed(1) : n / 60) + "시간" : n + "분"; }
  var ERR = { no_gold: "골드가 모자라요.", busy: "이미 무언가 심겨 있어요.", no_water: "지금은 물을 줄 수 없어요. (30분에 한 번 · 작물마다 4번까지)", not_ready: "아직 다 자라지 않았어요.",
    max: "더는 늘릴 수 없어요.", no_item: "가진 게 없어요.", rate_limited: "조금만 천천히 해 주세요.", not_found: "찾을 수 없어요." };

  // ── 그림 ──
  // 꽃: 7×7 도트 (꽃잎 색 · 가운데 노랑 · 줄기 초록)
  function flowerSvg(hex, stage) {
    var px = [];
    function r(x, y, w, h, c) { px.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '"/>'); }
    if (stage <= 0) { r(2, 5, 3, 1, "#7a5a3a"); r(3, 4, 1, 1, "#9a7a4a"); }
    else if (stage === 1) { r(3, 3, 1, 3, "#5aa04a"); r(2, 3, 1, 1, "#7cc05a"); r(4, 2, 1, 1, "#7cc05a"); }
    else if (stage === 2) { r(3, 3, 1, 3, "#5aa04a"); r(2, 4, 1, 1, "#7cc05a"); r(3, 1, 1, 2, hex || "#c8b8c0"); r(2, 2, 1, 1, hex || "#c8b8c0"); r(4, 2, 1, 1, hex || "#c8b8c0"); }
    else { r(3, 4, 1, 2, "#5aa04a"); r(2, 5, 1, 1, "#7cc05a"); r(4, 4, 1, 1, "#7cc05a"); var c = hex || "#e8b8d0"; r(2, 0, 3, 1, c); r(1, 1, 5, 2, c); r(2, 3, 3, 1, c); r(3, 1, 1, 2, "#f2c94c"); r(2, 2, 3, 1, "#f2c94c"); r(3, 2, 1, 1, "#e8a020"); }
    return '<svg viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">' + px.join("") + "</svg>";
  }
  function plotArt(p, c) {
    var a = el("div", "fm-art s" + p.stage);
    if (p.stage === 3) a.textContent = c.em;
    else if (p.stage === 2) a.textContent = "🌿";
    else if (p.stage === 1) a.textContent = "🌱";
    else a.innerHTML = '<i></i><i></i><i></i>';
    return a;
  }
  function drops(n, max) { var s = ""; for (var i = 0; i < max; i++) s += i < n ? "💧" : "·"; return s; }

  // ── 화면 (칸마다 하나씩) ── mode: 'farm' = 밭 · 출하 · 작물 도감, 'pot' = 화분 · 출하 · 꽃 도감
  function create(scr, mode) {
  var pot = mode === "pot", TAB_KEY = "farm_tab_" + mode, cur = pot ? "pot" : "plot", D = null, off = 0, tick = 0, box = null, note = "";
  try { cur = sessionStorage.getItem(TAB_KEY) || cur; } catch (e) {}
  function now() { return Date.now() + off; }
  function draw() {
    if (!box || !box.isConnected || !D) return;
    box.innerHTML = "";
    var top = el("div", "fm-top");
    top.appendChild(el("b", "fm-gold", "보유 골드 " + D.gold.toLocaleString() + " G"));
    var tabs = el("div", "fm-tabs");
    (pot ? [["pot", "화분"], ["ship", "꽃 출하"], ["dex", "꽃 도감"]] : [["plot", "밭"], ["ship", "작물 출하"], ["dex", "작물 도감"]]).forEach(function (t) {
      var b = btn("fm-tab" + (cur === t[0] ? " on" : ""), t[1], function () { cur = t[0]; try { sessionStorage.setItem(TAB_KEY, cur); } catch (e) {} note = ""; draw(); });
      b.setAttribute("aria-pressed", cur === t[0] ? "true" : "false"); tabs.appendChild(b);
    });
    top.appendChild(tabs); box.appendChild(top);
    var msg = el("p", "fm-msg", note); msg.setAttribute("role", "status"); box.appendChild(msg);
    (({ plot: vPlot, pot: vPot, ship: vShip, dex: vDex })[cur] || (pot ? vPot : vPlot))(box);
  }
  function act(path, body, okFn) {
    return call("POST", path, body).then(function (r) {
      if (r && r.ok) { set(r); note = r.msg || ""; if (okFn) okFn(r); draw(); INST.forEach(function (o) { if (o !== self && o.alive()) { o.set(r); o.draw(); } }); if (window.pollState) window.pollState(false); }
      else { note = ERR[r && r.error] || "처리하지 못했어요."; draw(); }
      return r;
    });
  }

  // 밭
  function vPlot(w) {
    w.appendChild(el("p", "fm-sub", "씨앗을 심으면 시간이 지나 자라요. 물을 주면 남은 시간이 15% 줄고(30분에 한 번 · 4번까지), 물을 2번 이상 준 작물은 수확량 +1. 가끔 ✨ 황금 수확!"));
    var row = el("div", "fm-row");
    var anyReady = D.plots.some(function (p) { return p.crop && p.stage === 3; }), anyWater = D.plots.some(function (p) { return p.crop && p.waterIn === 0; });
    var hb = btn("fm-go", "다 자란 것 모두 수확", function () { hb.disabled = true; act("/api/farm/harvest", { idx: -1 }); }); hb.disabled = !anyReady; row.appendChild(hb);
    var wb = btn("fm-go ghost", "💧 모두 물 주기", function () { wb.disabled = true; act("/api/farm/water", { idx: -1 }); }); wb.disabled = !anyWater; row.appendChild(wb);
    w.appendChild(row);
    var g = el("div", "fm-grid");
    D.plots.forEach(function (p) {
      var cell = el("div", "fm-cell"), c = p.crop && D.crops.filter(function (x) { return x.k === p.crop; })[0];
      if (!c) {
        cell.classList.add("empty"); cell.appendChild(el("div", "fm-art s0 soil"));
        cell.appendChild(el("b", null, (p.idx + 1) + "번 밭")); cell.appendChild(el("small", null, "비어 있어요"));
        cell.appendChild(btn("fm-go fm-sm", "씨앗 심기", function () { seedPick(p.idx); }));
      } else {
        cell.appendChild(plotArt(p, c)); cell.appendChild(el("b", null, c.name));
        var t = el("small", "fm-time" + (p.stage === 3 ? " ready" : ""), p.stage === 3 ? "다 자랐어요!" : dur(p.readyIn) + " 남음"); t.dataset.ready = String(D.now + p.readyIn); cell.appendChild(t);
        cell.appendChild(el("small", "fm-drop", drops(p.waterN, D.waterMax)));
        var bs = el("div", "fm-bs");
        if (p.stage === 3) bs.appendChild(btn("fm-go fm-sm", "수확", function () { act("/api/farm/harvest", { idx: p.idx }); }));
        else {
          var wb2 = btn("fm-go fm-sm ghost", p.waterIn > 0 ? "💧 " + dur(p.waterIn) : p.waterIn < 0 ? "물 충분" : "💧 물 주기", function () { act("/api/farm/water", { idx: p.idx }); });
          wb2.disabled = p.waterIn !== 0; bs.appendChild(wb2);
        }
        bs.appendChild(btn("fm-x", "뽑기", function (e) { var b = e.currentTarget; if (b.dataset.arm !== "1") { b.dataset.arm = "1"; b.textContent = "정말 뽑기"; setTimeout(function () { if (b.isConnected) { b.dataset.arm = ""; b.textContent = "뽑기"; } }, 2500); return; } act("/api/farm/clear", { kind: "plot", idx: p.idx }); }));
        cell.appendChild(bs);
      }
      g.appendChild(cell);
    });
    w.appendChild(g);
    if (D.plotCost) w.appendChild(btn("fm-go ghost wide", "밭 한 칸 늘리기 · " + D.plotCost.toLocaleString() + " G (" + D.plots.length + " / " + D.plotMax + ")", function (e) { e.currentTarget.disabled = true; act("/api/farm/expand", { kind: "plot" }); }));
  }
  function seedPick(idx) {
    var dlg = el("div", "fm-pick"); dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-label", "씨앗 고르기");
    dlg.appendChild(el("b", "fm-ph", (idx + 1) + "번 밭에 심을 씨앗"));
    var ul = el("div", "fm-plist");
    D.crops.forEach(function (c) {
      var it = btn("fm-pi t-" + c.tier, "", function () { close(); act("/api/farm/plant", { idx: idx, crop: c.k }); });
      it.disabled = D.gold < c.price;
      it.appendChild(el("span", "fm-pem", c.em));
      var tx = el("span", "fm-ptx"); tx.appendChild(el("b", null, c.seed + " · " + c.price + " G"));
      tx.appendChild(el("small", null, c.name + " " + c.y[0] + (c.y[1] > c.y[0] ? "~" + c.y[1] : "") + "개 · " + mins(c.min) + " · 출하 " + c.sell + " G · " + TIER[c.tier]));
      it.appendChild(tx); ul.appendChild(it);
    });
    dlg.appendChild(ul); dlg.appendChild(btn("fm-go ghost wide", "닫기", close));
    box.appendChild(dlg); dlg.scrollIntoView({ block: "nearest" });
    function close() { dlg.remove(); }
  }

  // 정원
  function vPot(w) {
    w.appendChild(el("p", "fm-sub", "화분에 꽃씨를 심어 피워요. 꽃마다 좋아하는 자리(창가 ☀️ · 그늘 🌙)가 있어서, 좋아하는 자리에 두고 물을 자주 줄수록 희귀한 색이 잘 나와요. 무슨 색일지는 꺾어 봐야 알아요!"));
    var row = el("div", "fm-row");
    var anyWater = D.pots.some(function (p) { return p.flower && p.waterIn === 0; });
    var wb = btn("fm-go ghost", "💧 모두 물 주기", function () { wb.disabled = true; act("/api/garden/water", { idx: -1 }); }); wb.disabled = !anyWater; row.appendChild(wb);
    w.appendChild(row);
    var g = el("div", "fm-grid pots");
    D.pots.forEach(function (p) {
      var cell = el("div", "fm-cell pot " + p.spot), f = p.flower && D.flowers.filter(function (x) { return x.k === p.flower; })[0];
      var sp = btn("fm-spot", p.spot === "sun" ? "☀️ 창가" : "🌙 그늘", function () { act("/api/garden/spot", { idx: p.idx, spot: p.spot === "sun" ? "shade" : "sun" }); });
      sp.title = "눌러서 자리 옮기기"; cell.appendChild(sp);
      var art = el("div", "fm-pot"); var fl = el("div", "fm-fl"); fl.innerHTML = flowerSvg(null, f ? p.stage : -1); art.appendChild(fl); art.appendChild(el("i", "fm-potb")); cell.appendChild(art);
      if (!f) {
        cell.appendChild(el("b", null, (p.idx + 1) + "번 화분")); cell.appendChild(el("small", null, "비어 있어요"));
        cell.appendChild(btn("fm-go fm-sm", "꽃씨 심기", function () { flowerPick(p.idx, p.spot); }));
      } else {
        cell.appendChild(el("b", null, f.name + (f.like === p.spot ? " ♥" : "")));
        var t = el("small", "fm-time" + (p.stage === 3 ? " ready" : ""), p.stage === 3 ? "꽃이 피었어요!" : dur(p.readyIn) + " 남음"); t.dataset.ready = String(D.now + p.readyIn); cell.appendChild(t);
        cell.appendChild(el("small", "fm-drop", drops(p.waterN, D.waterMax)));
        var bs = el("div", "fm-bs");
        if (p.stage === 3) bs.appendChild(btn("fm-go fm-sm", "꺾기", function () { act("/api/garden/pick", { idx: p.idx }); }));
        else { var w2 = btn("fm-go fm-sm ghost", p.waterIn > 0 ? "💧 " + dur(p.waterIn) : p.waterIn < 0 ? "물 충분" : "💧 물 주기", function () { act("/api/garden/water", { idx: p.idx }); }); w2.disabled = p.waterIn !== 0; bs.appendChild(w2); }
        bs.appendChild(btn("fm-x", "뽑기", function (e) { var b = e.currentTarget; if (b.dataset.arm !== "1") { b.dataset.arm = "1"; b.textContent = "정말 뽑기"; setTimeout(function () { if (b.isConnected) { b.dataset.arm = ""; b.textContent = "뽑기"; } }, 2500); return; } act("/api/farm/clear", { kind: "pot", idx: p.idx }); }));
        cell.appendChild(bs);
      }
      g.appendChild(cell);
    });
    w.appendChild(g);
    if (D.potCost) w.appendChild(btn("fm-go ghost wide", "화분 하나 더 들이기 · " + D.potCost.toLocaleString() + " G (" + D.pots.length + " / " + D.potMax + ")", function (e) { e.currentTarget.disabled = true; act("/api/farm/expand", { kind: "pot" }); }));
  }
  function flowerPick(idx, spot) {
    var dlg = el("div", "fm-pick"); dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-label", "꽃씨 고르기");
    dlg.appendChild(el("b", "fm-ph", (idx + 1) + "번 화분(" + (spot === "sun" ? "창가" : "그늘") + ")에 심을 꽃씨"));
    var ul = el("div", "fm-plist");
    D.flowers.forEach(function (f) {
      var it = btn("fm-pi t-" + f.tier, "", function () { close(); act("/api/garden/plant", { idx: idx, flower: f.k }); });
      it.disabled = D.gold < f.price;
      var em = el("span", "fm-pem fl"); em.innerHTML = flowerSvg(f.colors[0].hex, 3); it.appendChild(em);
      var tx = el("span", "fm-ptx"); tx.appendChild(el("b", null, f.name + " 꽃씨 · " + f.price + " G"));
      tx.appendChild(el("small", null, mins(f.min) + " · 좋아하는 자리 " + (f.like === "sun" ? "☀️ 창가" : "🌙 그늘") + (f.like === spot ? " (지금 자리 ♥)" : "") + " · 색 " + f.colors.length + "가지 · " + TIER[f.tier]));
      it.appendChild(tx); ul.appendChild(it);
    });
    dlg.appendChild(ul); dlg.appendChild(btn("fm-go ghost wide", "닫기", close));
    box.appendChild(dlg); dlg.scrollIntoView({ block: "nearest" });
    function close() { dlg.remove(); }
  }

  // 출하
  function vShip(w) {
    w.appendChild(el("p", "fm-sub", pot ? "화분에서 꺾은 꽃을 골드로 팔아요. 희귀한 색의 꽃은 3배 값! (요리에 쓰는 꽃도 있어요)" : "밭에서 거둔 작물을 골드로 팔아요. 요리에 쓸 작물은 남겨 두세요!"));
    var list = D.ship.filter(function (s) { return s.kind === (pot ? "flower" : "crop"); });
    if (!list.length) { w.appendChild(el("p", "fm-empty", pot ? "출하할 수 있는 꽃이 없어요." : "출하할 수 있는 작물이 없어요.")); return; }
    var total = list.reduce(function (a, s) { return a + s.sell * s.qty; }, 0);
    w.appendChild(el("p", "fm-sub", "모두 팔면 " + total.toLocaleString() + " G"));
    var ul = el("div", "fm-ship");
    list.forEach(function (s) {
      var r = el("div", "fm-si t-" + s.tier);
      var ic = el("span", "fm-pem" + (s.kind === "flower" ? " fl" : "")); if (s.kind === "flower") ic.innerHTML = flowerSvg(s.color, 3); else ic.textContent = s.em; r.appendChild(ic);
      var tx = el("span", "fm-ptx"); tx.appendChild(el("b", null, s.item + " ×" + s.qty)); tx.appendChild(el("small", null, "1개 " + s.sell + " G · " + TIER[s.tier])); r.appendChild(tx);
      r.appendChild(btn("fm-go fm-sm ghost", "1개", function (e) { e.currentTarget.disabled = true; act("/api/farm/ship", { item: s.item, qty: 1 }); }));
      r.appendChild(btn("fm-go fm-sm", "모두 " + (s.sell * s.qty).toLocaleString() + " G", function (e) { e.currentTarget.disabled = true; act("/api/farm/ship", { item: s.item, qty: s.qty }); }));
      ul.appendChild(r);
    });
    w.appendChild(ul);
  }

  // 도감
  function vDex(w) {
    if (pot) return vFdex(w);
    var got = D.crops.filter(function (c) { return c.got; }).length;
    w.appendChild(el("p", "fm-h", "작물 도감 · " + got + " / " + D.crops.length + "종 · 수확 " + D.harvests + "번"));
    var g = el("div", "fm-dex");
    D.crops.forEach(function (c) { var d = el("div", "fm-dx t-" + c.tier + (c.got ? "" : " no")); d.appendChild(el("span", "fm-pem", c.got ? c.em : "?")); d.appendChild(el("b", null, c.got ? c.name : "???")); d.appendChild(el("small", null, c.got ? "모은 수 " + c.got : TIER[c.tier])); g.appendChild(d); });
    w.appendChild(g);
  }
  function vFdex(w) {
    w.appendChild(el("p", "fm-h", "꽃 도감 · " + D.colorsGot + " / " + D.colorTotal + "색 · 꽃 " + D.blooms + "송이"));
    D.flowers.forEach(function (f) {
      var r = el("div", "fm-frow"); r.appendChild(el("b", null, f.name));
      var cs = el("div", "fm-chips");
      f.colors.forEach(function (c) { var ch = el("span", "fm-chip" + (c.got ? "" : " no") + (c.rare ? " rare" : "")); var sw = el("i"); sw.style.background = c.got ? c.hex : ""; ch.appendChild(sw); ch.appendChild(document.createTextNode(c.got ? c.name + (c.rare ? " ✨" : "") : "???")); cs.appendChild(ch); });
      r.appendChild(cs); w.appendChild(r);
    });
  }

  // 남은 시간을 1초마다 줄이고, 다 자란 칸이 생기면 다시 불러옵니다
  function tickFn() {
    if (!box || !box.isConnected) { clearInterval(tick); tick = 0; return; }
    var t = now(), reload = false;
    Array.prototype.forEach.call(box.querySelectorAll(".fm-time[data-ready]"), function (s) {
      if (s.classList.contains("ready")) return;
      var left = Number(s.dataset.ready) - t;
      if (left <= 0) reload = true; else s.textContent = dur(left) + " 남음";
    });
    if (reload && !document.hidden) load();
  }
  function set(r) { D = r; off = r.now - Date.now(); }
  function load() {
    return call("GET", "/api/farm").then(function (r) {
      if (!box || !box.isConnected) return;
      if (!r || !r.plots) { box.innerHTML = ""; box.appendChild(el("p", "fm-empty", "불러오지 못했어요.")); return; }
      set(r); draw();
    });
  }
  var self = { set: set, draw: draw, load: load, mode: mode, alive: function () { return !!(box && box.isConnected); } };
  box = el("div", "fm"); scr.appendChild(box); box.appendChild(el("p", "fm-empty", "불러오는 중…"));
  load();
  tick = setInterval(tickFn, 1000);
  var slow = setInterval(function () { if (!box || !box.isConnected) { clearInterval(slow); return; } if (!document.hidden && !box.querySelector(".fm-pick")) load(); }, 60000);      // 1분마다 새로고침 (물 주기 대기 시간 등)
  return self;
  }
  function mount(scr, mode) {
    if (!scr) return;
    css();
    scr.innerHTML = "";
    INST = INST.filter(function (o) { return o.alive() && o.mode !== (mode || "farm"); });
    INST.push(create(scr, mode || "farm"));
  }

  // ═════════ 아지트 꾸미기 ═════════
  // 7×7 방(확장 계약서로 10×10 → 15×15) · 한 칸을 2×2로 나눠 반 칸 단위로 놓기 · 가구는 크기만큼의 네모 칸에 이름만 써서 보여 줌 · 보관함에서 고른 뒤 방의 칸을 눌러 놓기
  var HERR = { no_gold: "골드가 모자라요.", have: "이미 계약했어요.", no_contract: "먼저 아지트 계약서를 사 주세요.", too_many: "가구는 100개까지 가질 수 있어요.",
    none_free: "보관함에 남은 가구가 없어요.", no_room: "거기에는 놓을 수 없어요. (방 밖이거나 다른 가구와 겹쳐요)", busy: "잠시 뒤에 다시 해 주세요.", rate_limited: "조금만 천천히 해 주세요.",
    not_friend: "친구의 아지트만 구경할 수 있어요.", not_found: "찾을 수 없어요." };
  var FCOL = ["#f6d8c8", "#d8e8f6", "#e0f0d0", "#f2e0f4", "#f6efc8", "#d8f0ec", "#f4d8dc", "#e4e0f4"];
  function fcol(k) { var h = 0; for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0; return FCOL[h % FCOL.length]; }
  function szt(v) { return v === 0.5 ? "½" : v % 1 ? Math.floor(v) + "½" : String(v); }      // 0.5 → ½
  function sz(w, h) { return szt(w) + "×" + szt(h); }
  function roomEl(H, opt) {
    opt = opt || {};
    var N = H.room || 7, U = H.sub || 2, S = N * U, cat = {}, narrow = window.innerWidth < 560; (H.catalog || []).forEach(function (c) { cat[c.k] = c; });
    var wrap = el("div", "hd-room"); wrap.style.setProperty("--n", N); wrap.style.setProperty("--s", S); wrap.style.setProperty("--wall", (H.walls || {})[H.wall] || "#f4ecdc"); wrap.style.setProperty("--floor", (H.floors || {})[H.floor] || "#c8a070");
    wrap.style.setProperty("--cell", (N > 10 ? (narrow ? 26 : 40) : N > 7 ? (narrow ? 32 : 52) : (narrow ? 44 : 64)) + "px");
    var sc = el("div", "hd-scroll"); wrap.appendChild(sc);
    var grid = el("div", "hd-grid"); sc.appendChild(grid);
    for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) { var c = el("i", "hd-c"); c.dataset.x = x; c.dataset.y = y; grid.appendChild(c); }      // 반 칸(4분의 1 칸)마다 하나
    (H.items || []).forEach(function (it) {
      var f = cat[it.k]; if (!f) return;
      var w = it.r ? f.h : f.w, h = it.r ? f.w : f.h;
      var b = el("div", "hd-f" + (f.layer === "floor" ? " floor" : "") + (opt.sel === it.id ? " sel" : ""));
      b.style.left = it.x / S * 100 + "%"; b.style.top = it.y / S * 100 + "%"; b.style.width = w * U / S * 100 + "%"; b.style.height = h * U / S * 100 + "%";
      if (w < 1 || h < 1) b.classList.add("thin");
      b.style.setProperty("--fc", fcol(it.k)); b.appendChild(el("span", null, f.name)); b.title = f.name + " (" + sz(w, h) + ")";
      if (opt.onItem) { b.setAttribute("role", "button"); b.tabIndex = 0; b.addEventListener("click", function (e) { e.stopPropagation(); opt.onItem(it); }); }
      grid.appendChild(b);
    });
    return wrap;
  }
  function hideout(scr) {
    css();
    var box = el("div", "fm hdo"), H = null, tab = "room", sel = null, rot = 0, note = "", visit = null, armC = false;
    scr.appendChild(box); box.appendChild(el("p", "fm-empty", "불러오는 중…"));
    function cat(k) { return H.catalog.filter(function (c) { return c.k === k; })[0]; }
    function act(path, body) {
      return call("POST", path, body).then(function (r) {
        if (r && r.ok) { H = r; note = r.msg || ""; if (window.pollState) window.pollState(false); }
        else note = HERR[r && r.error] || "처리하지 못했어요.";
        draw(); return r;
      });
    }
    function draw() {
      if (!box.isConnected) return;
      box.innerHTML = "";
      var top = el("div", "fm-top"); top.appendChild(el("b", "fm-gold", "보유 골드 " + H.gold.toLocaleString() + " G"));
      if (H.contract) {
        var tabs = el("div", "fm-tabs");
        [["room", "꾸미기"], ["shop", "가구 상점"], ["visit", "친구 아지트"]].forEach(function (t) { var b = btn("fm-tab" + (tab === t[0] ? " on" : ""), t[1], function () { tab = t[0]; note = ""; sel = null; draw(); }); tabs.appendChild(b); });
        top.appendChild(tabs);
      }
      box.appendChild(top);
      var msg = el("p", "fm-msg", note); msg.setAttribute("role", "status"); box.appendChild(msg);
      if (!H.contract) return vContract();
      ({ room: vRoom, shop: vShop, visit: vVisit })[tab]();
    }
    function vContract() {
      var c = el("div", "hd-ct");
      c.appendChild(el("b", "hd-ctt", "📜 아지트 임대 계약서"));
      c.appendChild(el("p", "fm-sub", "7×7 크기의 나만의 방을 얻어 가구를 들여 꾸밀 수 있어요."));
      c.appendChild(el("p", "hd-price", H.price.toLocaleString() + " G"));
      var b = btn("fm-go wide", "계약서 구매하기", function () {
        if (!armC) { armC = true; b.textContent = "한 번 더 누르면 " + H.price.toLocaleString() + " G를 내고 계약해요"; setTimeout(function () { armC = false; if (b.isConnected) b.textContent = "계약서 구매하기"; }, 3000); return; }
        b.disabled = true; act("/api/hideout/contract", {});
      });
      b.disabled = H.gold < H.price; c.appendChild(b);
      if (H.gold < H.price) c.appendChild(el("p", "fm-sub", "골드가 " + (H.price - H.gold).toLocaleString() + " G 모자라요."));
      box.appendChild(c);
    }
    var armE = false;
    function vRoom() {
      var placedN = H.items.length;
      if (H.next) {
        var ex = el("div", "hd-ex"), nx = H.next;
        ex.appendChild(el("span", null, "지금 방 " + H.room + "×" + H.room + " · " + nx.n + "번째 확장 계약서를 사면 " + nx.size + "×" + nx.size + (nx.size === 10 ? "으로" : "로") + " 넓어져요 (가구 자리는 그대로)"));
        var eb = btn("fm-go fm-sm", "📜 확장 계약서 " + nx.price.toLocaleString() + " G", function () {
          if (!armE) { armE = true; eb.textContent = "한 번 더 누르면 " + nx.price.toLocaleString() + " G로 확장해요"; setTimeout(function () { armE = false; if (eb.isConnected) eb.textContent = "📜 확장 계약서 " + nx.price.toLocaleString() + " G"; }, 3000); return; }
          eb.disabled = true; act("/api/hideout/expand", {});
        });
        eb.disabled = H.gold < nx.price; ex.appendChild(eb); box.appendChild(ex);
      }
      // 이름 · 벽지 · 바닥
      var nm = el("div", "hd-name");
      var inp = el("input"); inp.type = "text"; inp.maxLength = 20; inp.placeholder = "아지트 이름 (최대 20자)"; inp.value = H.name || ""; inp.setAttribute("aria-label", "아지트 이름");
      nm.appendChild(inp); nm.appendChild(btn("fm-go fm-sm ghost", "이름 저장", function () { act("/api/hideout/edit", { name: inp.value }); }));
      box.appendChild(nm);
      var deco = el("div", "hd-deco");
      function chips(label, map, curv, key) {
        var r = el("div", "hd-chips"); r.appendChild(el("small", null, label));
        Object.keys(map).forEach(function (k) { var b = btn("hd-chip" + (curv === k ? " on" : ""), "", function () { var o = {}; o[key] = k; act("/api/hideout/edit", o); }); b.style.background = map[k]; b.title = label + " " + k; b.setAttribute("aria-label", label + " " + k); r.appendChild(b); });
        deco.appendChild(r);
      }
      chips("벽지", H.walls, H.wall, "wall"); chips("바닥", H.floors, H.floor, "floor");
      box.appendChild(deco);
      // 안내 · 도구
      var tool = el("div", "hd-tool");
      if (sel) {
        var f = cat(sel.k), w = rot ? f.h : f.w, h = rot ? f.w : f.h;
        tool.appendChild(el("b", null, (sel.id ? "옮기는 중: " : "놓는 중: ") + f.name + " (" + sz(w, h) + ")"));
        tool.appendChild(el("small", null, "방의 작은 칸(한 칸의 4분의 1)을 누르면 그 자리가 가구의 왼쪽 위가 돼요. 반 칸씩 옮겨 놓을 수 있어요."));
        var bs = el("div", "fm-row");
        if (f.w !== f.h) bs.appendChild(btn("fm-go fm-sm ghost", "↻ 돌리기", function () {
          rot = rot ? 0 : 1;
          if (sel.id) { var it = H.items.filter(function (z) { return z.id === sel.id; })[0]; act("/api/hideout/edit", { id: sel.id, x: it.x, y: it.y, r: rot }); } else draw();
        }));
        if (sel.id) bs.appendChild(btn("fm-go fm-sm ghost", "보관함으로", function () { var id = sel.id; sel = null; act("/api/hideout/edit", { id: id, del: true }); }));
        bs.appendChild(btn("fm-go fm-sm ghost", "선택 취소", function () { sel = null; note = ""; draw(); }));
        tool.appendChild(bs);
      } else tool.appendChild(el("small", null, "보관함에서 가구를 고르거나, 방에 놓인 가구를 눌러 옮기거나 돌려 보세요."));
      box.appendChild(tool);
      // 방
      var room = roomEl(H, { sel: sel && sel.id, onItem: function (it) { sel = { id: it.id, k: it.k }; rot = it.r ? 1 : 0; note = ""; draw(); } });
      if (H.name) room.insertBefore(el("p", "hd-rn", H.name), room.firstChild);
      var grid = room.querySelector(".hd-grid"), ghost = el("div", "hd-ghost"); ghost.hidden = true; grid.appendChild(ghost);
      var U = H.sub || 2, S = H.room * U;
      function cellAt(e) { var t = e.target.closest ? e.target.closest(".hd-c") : null; if (t) return [Number(t.dataset.x), Number(t.dataset.y)]; var r = grid.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * S), Math.floor((e.clientY - r.top) / r.height * S)]; }
      if (sel) {
        grid.classList.add("placing");
        grid.addEventListener("mousemove", function (e) {
          var p = cellAt(e), f = cat(sel.k), w = (rot ? f.h : f.w) * U, h = (rot ? f.w : f.h) * U;
          ghost.hidden = false; ghost.style.left = p[0] / S * 100 + "%"; ghost.style.top = p[1] / S * 100 + "%"; ghost.style.width = w / S * 100 + "%"; ghost.style.height = h / S * 100 + "%";
          ghost.classList.toggle("bad", p[0] + w > S || p[1] + h > S);
        });
        grid.addEventListener("mouseleave", function () { ghost.hidden = true; });
        grid.addEventListener("click", function (e) {
          if (e.target.closest && e.target.closest(".hd-f") && !e.target.closest(".hd-f.floor")) return;
          var p = cellAt(e), s = sel;
          if (s.id) act("/api/hideout/edit", { id: s.id, x: p[0], y: p[1], r: rot }).then(function (r) { if (r && r.ok) { sel = null; draw(); } });
          else act("/api/hideout/edit", { k: s.k, x: p[0], y: p[1], r: rot }).then(function (r) { if (r && r.ok) { var c = cat(s.k); if (!(c && c.own > c.placed)) sel = null; draw(); } });
        });
      }
      box.appendChild(room);
      // 보관함
      box.appendChild(el("p", "fm-h", "보관함 · 방(" + H.room + "×" + H.room + ")에 놓인 가구 " + placedN + "개"));
      var free = H.catalog.filter(function (c) { return c.own > 0; });
      if (!free.length) box.appendChild(el("p", "fm-sub", "가진 가구가 없어요. '가구 상점'에서 사 보세요."));
      var st = el("div", "hd-store");
      free.forEach(function (c) {
        var left = c.own - c.placed;
        var b = btn("hd-si" + (sel && !sel.id && sel.k === c.k ? " on" : ""), "", function () { sel = { k: c.k }; rot = 0; note = ""; draw(); });
        b.disabled = left <= 0;
        var sw = el("i", "hd-sw"); sw.style.setProperty("--fc", fcol(c.k)); sw.style.setProperty("--w", c.w); sw.style.setProperty("--h", c.h); b.appendChild(sw);
        var tx = el("span"); tx.appendChild(el("b", null, c.name)); tx.appendChild(el("small", null, sz(c.w, c.h) + " · 남은 " + left + " / " + c.own + (c.layer === "floor" ? " · 바닥에 깔림" : ""))); b.appendChild(tx);
        st.appendChild(b);
      });
      box.appendChild(st);
      if (placedN) box.appendChild(btn("fm-go ghost wide", "가구 모두 보관함으로", function (e) { var b = e.currentTarget; if (b.dataset.arm !== "1") { b.dataset.arm = "1"; b.textContent = "한 번 더 누르면 모두 치워요"; return; } sel = null; act("/api/hideout/edit", { all: true }); }));
    }
    function vShop() {
      box.appendChild(el("p", "fm-sub", "가구를 사면 보관함에 들어가요. 크기(가로×세로)만큼 방의 칸을 차지해요. 러그·매트·마법진은 바닥에 깔려서 위에 다른 가구를 놓을 수 있어요. (가구는 100개까지 · 방에 놓지 않은 가구는 절반 값에 되팔 수 있어요)"));
      var ul = el("div", "fm-plist hd-shop");
      H.catalog.forEach(function (c) {
        var r = el("div", "fm-si");
        var sw = el("i", "hd-sw"); sw.style.setProperty("--fc", fcol(c.k)); sw.style.setProperty("--w", c.w); sw.style.setProperty("--h", c.h); r.appendChild(sw);
        var tx = el("span", "fm-ptx"); tx.appendChild(el("b", null, c.name + " · " + c.price.toLocaleString() + " G")); tx.appendChild(el("small", null, sz(c.w, c.h) + " 칸" + (c.layer === "floor" ? " · 바닥에 깔림" : "") + (c.own ? " · 가진 수 " + c.own : ""))); r.appendChild(tx);
        if (c.own > c.placed) r.appendChild(btn("fm-x", "되팔기", function (e) { var b = e.currentTarget; if (b.dataset.arm !== "1") { b.dataset.arm = "1"; b.textContent = "+" + Math.floor(c.price / 2) + " G?"; return; } act("/api/hideout/sell", { k: c.k }); }));
        var bb = btn("fm-go fm-sm", "사기", function () { bb.disabled = true; act("/api/hideout/buy", { k: c.k }); }); bb.disabled = H.gold < c.price; r.appendChild(bb);
        ul.appendChild(r);
      });
      box.appendChild(ul);
    }
    function vVisit() {
      box.appendChild(el("p", "fm-sub", "친구의 헌터 코드를 넣으면 그 친구의 아지트를 구경할 수 있어요."));
      var f = el("form", "hd-name"), inp = el("input"); inp.type = "text"; inp.placeholder = "친구 코드 (예: HPW8-T6BR)"; inp.maxLength = 12; inp.value = visit && visit.code || ""; inp.setAttribute("aria-label", "친구 코드");
      f.appendChild(inp); f.appendChild(btn("fm-go fm-sm", "구경하기")); box.appendChild(f);
      f.addEventListener("submit", function (e) {
        e.preventDefault(); var code = inp.value.trim(); if (!code) return;
        call("GET", "/api/hideout/visit?code=" + encodeURIComponent(code)).then(function (r) { if (!r || r.error) { note = HERR[r && r.error] || "불러오지 못했어요."; visit = null; } else { visit = r; visit.code = code; note = ""; } draw(); });
      });
      if (visit) {
        if (!visit.contract) box.appendChild(el("p", "fm-empty", visit.hn + " 님은 아직 아지트가 없어요."));
        else { box.appendChild(el("p", "fm-h", visit.hn + " 님의 아지트")); var rm = roomEl(visit); if (visit.name) rm.insertBefore(el("p", "hd-rn", visit.name), rm.firstChild); box.appendChild(rm); }
      }
    }
    call("GET", "/api/hideout").then(function (r) { if (!box.isConnected) return; if (!r || r.error) { box.innerHTML = ""; box.appendChild(el("p", "fm-empty", "아지트를 불러오지 못했어요.")); return; } H = r; draw(); });
  }
  var HIDE_CSS = [
    ".hd-ct{display:grid;gap:10px;padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--field);text-align:center}",
    ".hd-ctt{font-size:1.05rem}.hd-price{margin:0;font-size:1.4rem;font-weight:800;color:var(--deep)}",
    ".hd-name{display:flex;gap:6px}.hd-name input{flex:1;min-width:0;min-height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;background:var(--field);color:var(--text);font:inherit;font-size:.85rem}",
    ".hd-deco{display:grid;gap:6px}.hd-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.hd-chips small{width:30px;font-size:.74rem;color:var(--sub)}",
    ".hd-chip{width:24px;height:24px;border-radius:6px;border:1px solid rgba(0,0,0,.25);cursor:pointer;padding:0}.hd-chip.on{outline:2px solid var(--red2);outline-offset:2px}",
    ".hd-tool{display:grid;gap:4px;padding:8px 10px;border:1px dashed var(--line);border-radius:10px}.hd-tool b{font-size:.85rem}.hd-tool small{font-size:.74rem;color:var(--sub)}",
    ".hd-room{box-sizing:border-box;width:100%;margin:0 auto;padding:12px;border-radius:12px;background:var(--wall);box-shadow:inset 0 0 0 2px rgba(0,0,0,.18)}",
    ".hd-scroll{overflow:auto;max-height:min(70vh,820px);border-radius:4px}",
    ".hd-ex{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--field);font-size:.78rem;color:var(--sub)}",
    ".hd-rn{margin:0 0 8px;text-align:center;font-weight:800;font-size:.9rem;color:#3a2a2a;text-shadow:0 1px 0 rgba(255,255,255,.6)}",
    ".hd-grid{position:relative;display:grid;grid-template-columns:repeat(var(--s),calc(var(--cell) / 2));grid-auto-rows:calc(var(--cell) / 2);width:calc(var(--n) * var(--cell));background-image:linear-gradient(to right,rgba(0,0,0,.42) 1.5px,transparent 1.5px),linear-gradient(to bottom,rgba(0,0,0,.42) 1.5px,transparent 1.5px);background-size:var(--cell) var(--cell);margin:0 auto;background-color:var(--floor);border:2px solid rgba(0,0,0,.3);border-radius:4px;overflow:hidden}",
    ".hd-c{box-shadow:inset -.5px -.5px 0 rgba(0,0,0,.2)}",
    ".hd-f.thin{padding:0 2px;font-size:max(8px,calc(var(--cell) * .2));border-width:1.5px}",
    ".hd-grid.placing{cursor:crosshair}.hd-grid.placing .hd-c:hover{background:rgba(255,255,255,.25)}",
    ".hd-f{position:absolute;z-index:2;box-sizing:border-box;padding:2px;display:grid;place-items:center;text-align:center;background:var(--fc);border:2px solid rgba(40,24,24,.55);border-radius:4px;color:#2a1a1a;font-weight:700;font-size:max(9px,calc(var(--cell) * .3));line-height:1.15;overflow:hidden;cursor:pointer;box-shadow:0 2px 0 rgba(0,0,0,.2)}",
    ".hd-f span{overflow-wrap:anywhere;word-break:keep-all}",
    ".hd-f.floor{z-index:1;background:color-mix(in srgb,var(--fc) 70%,transparent);border-style:dashed;place-items:start;padding:3px 5px;font-weight:600}",
    ".hdo{width:100%;box-sizing:border-box;grid-template-columns:minmax(0,1fr)}",".hdo>*{min-width:0}",
    ".hd-f.sel{outline:3px solid var(--red2);outline-offset:-1px;z-index:3}",
    ".hd-grid.placing .hd-f:not(.floor){pointer-events:auto}.hd-grid.placing .hd-f.floor{pointer-events:none}",
    ".hd-ghost{position:absolute;z-index:4;box-sizing:border-box;border:2px dashed #2a9a5a;background:rgba(80,200,120,.25);border-radius:4px;pointer-events:none}.hd-ghost.bad{border-color:#d0404a;background:rgba(220,60,70,.25)}",
    ".hd-store{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}",
    ".hd-si{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--line);border-radius:10px;background:var(--field);color:var(--text);font:inherit;text-align:left;cursor:pointer}",
    ".hd-si.on{border-color:var(--red2);box-shadow:0 0 0 2px var(--red2) inset}.hd-si:disabled{opacity:.45;cursor:default}",
    ".hd-si span{display:grid;gap:2px;min-width:0}.hd-si b{font-size:.8rem}.hd-si small{font-size:.68rem;color:var(--sub)}",
    ".hd-sw{flex:none;width:calc(var(--w) * 11px);height:calc(var(--h) * 11px);background:var(--fc);border:1.5px solid rgba(40,24,24,.5);border-radius:2px}",
  ].join("\n");

  function css() {
    if (document.getElementById("fm-css")) return;
    var s = document.createElement("style"); s.id = "fm-css";
    s.textContent = [
      ".fm{display:grid;gap:10px;color:var(--text)}",
      ".fm-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px}",
      ".fm-gold{font-size:.85rem;color:var(--deep)}",
      ".fm-tabs{display:flex;gap:6px}",
      ".fm-tab{min-height:34px;padding:0 14px;border:1px solid var(--line);border-radius:999px;background:var(--field);color:var(--text);font-family:inherit;font-weight:600;font-size:.82rem;line-height:1;cursor:pointer}",
      ".fm-tab.on{border-color:var(--red2);background:var(--red2);color:#fff}",
      ".fm-msg{margin:0;min-height:1.3em;font-size:.84rem;color:var(--deep);font-weight:600}",
      ".fm-sub{margin:0;font-size:.8rem;line-height:1.55;color:var(--sub)}",
      ".fm-h{margin:8px 0 2px;font-weight:700;font-size:.9rem}",
      ".fm-empty{margin:14px 0;text-align:center;color:var(--sub);font-size:.88rem}",
      ".fm-row{display:flex;flex-wrap:wrap;gap:6px}",
      ".fm-go{min-height:36px;padding:0 14px;border:1px solid var(--red2);border-radius:10px;background:var(--red2);color:#fff;font-family:inherit;font-weight:600;font-size:.8rem;line-height:1.2;cursor:pointer}",
      ".fm-go.ghost{background:transparent;color:var(--deep)}",
      ".fm-go.fm-sm{min-height:30px;padding:0 10px;font-size:.74rem}",
      ".fm-go.wide{width:100%}",
      ".fm-go:disabled{opacity:.45;cursor:default}",
      ".fm-x{padding:2px 6px;border:0;background:none;color:var(--sub);font-family:inherit;font-weight:400;font-size:.7rem;line-height:1;cursor:pointer;text-decoration:underline dotted}",
      ".fm-x[data-arm='1']{color:#e0505a}",
      ".fm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}",
      ".fm-grid.pots{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}",
      
      ".fm-cell{display:grid;justify-items:center;gap:3px;padding:10px 6px;border:1px solid var(--line);border-radius:12px;background:var(--field);text-align:center;min-width:0}",
      ".fm-cell b{font-size:.84rem;overflow-wrap:anywhere}.fm-cell small{font-size:.72rem;color:var(--sub)}",
      ".fm-time.ready{color:var(--deep);font-weight:700}",
      ".fm-drop{letter-spacing:1px}",
      ".fm-bs{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:4px;margin-top:2px}",
      ".fm-art{width:64px;height:48px;display:grid;place-items:center;font-size:30px;line-height:1;border-radius:8px;background:linear-gradient(180deg,transparent 55%,#7a5236 55%,#5e3e28);position:relative}",
      ".fm-art.s3{font-size:34px;animation:fmbob 2.4s ease-in-out infinite}",
      ".fm-art.s0 i{position:absolute;bottom:12px;width:5px;height:5px;border-radius:50%;background:#e8d0a0}.fm-art.s0 i:nth-child(1){left:18px}.fm-art.s0 i:nth-child(2){left:30px}.fm-art.s0 i:nth-child(3){left:42px}",
      ".fm-art.soil{opacity:.7}",
      "@keyframes fmbob{50%{transform:translateY(-3px)}}",
      ".fm-spot{justify-self:end;padding:2px 8px;border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--sub);font-family:inherit;font-weight:500;font-size:.68rem;line-height:1.4;cursor:pointer}",
      ".fm-cell.pot.sun{background:linear-gradient(180deg,rgba(255,214,120,.16),transparent 60%),var(--field)}",
      ".fm-cell.pot.shade{background:linear-gradient(180deg,rgba(120,140,220,.16),transparent 60%),var(--field)}",
      ".fm-pot{position:relative;width:56px;height:62px;display:grid;justify-items:center}",
      ".fm-fl{width:42px;height:42px}.fm-fl svg{width:100%;height:100%;display:block}",
      ".fm-potb{width:40px;height:20px;margin-top:-4px;background:linear-gradient(180deg,#c86a3a 0 4px,#a4502a 4px);clip-path:polygon(0 0,100% 0,88% 100%,12% 100%);border-radius:2px}",
      ".fm-pick{display:grid;gap:8px;padding:12px;border:1px solid var(--red2);border-radius:12px;background:var(--field);box-shadow:0 8px 22px rgba(0,0,0,.25)}",
      ".fm-ph{font-size:.9rem}",
      ".fm-plist,.fm-ship{display:grid;gap:6px;max-height:360px;overflow:auto}",
      ".fm-ship{max-height:none}",
      ".fm-pi,.fm-si{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:1px solid var(--line);border-left:3px solid var(--line);border-radius:10px;background:transparent;color:var(--text);font:inherit;text-align:left;cursor:pointer}",
      ".fm-si{cursor:default}",
      ".fm-pi:disabled{opacity:.45;cursor:default}",
      ".fm-pi:hover:not(:disabled){border-color:var(--red2)}",
      ".t-r{border-left-color:#6a9ae0!important}.t-e{border-left-color:#a07ad8!important}.t-l{border-left-color:#e8b040!important}",
      ".fm-pem{flex:none;width:34px;height:34px;display:grid;place-items:center;font-size:24px}.fm-pem.fl svg{width:30px;height:30px}",
      ".fm-ptx{display:grid;gap:2px;flex:1;min-width:0}.fm-ptx b{font-size:.84rem}.fm-ptx small{font-size:.72rem;color:var(--sub)}",
      ".fm-dex{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px}",
      ".fm-dx{display:grid;justify-items:center;gap:2px;padding:8px 4px;border:1px solid var(--line);border-bottom:3px solid var(--line);border-radius:10px;background:var(--field);text-align:center}",
      ".fm-dx.t-r{border-bottom-color:#6a9ae0}.fm-dx.t-e{border-bottom-color:#a07ad8}.fm-dx.t-l{border-bottom-color:#e8b040}",
      ".fm-dx b{font-size:.78rem}.fm-dx small{font-size:.68rem;color:var(--sub)}.fm-dx.no{opacity:.55}",
      ".fm-frow{display:grid;grid-template-columns:72px 1fr;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed var(--line)}",
      ".fm-frow b{font-size:.8rem}",
      ".fm-chips{display:flex;flex-wrap:wrap;gap:5px}",
      ".fm-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border:1px solid var(--line);border-radius:999px;font-size:.72rem}",
      ".fm-chip i{width:10px;height:10px;border-radius:50%;background:var(--line)}",
      ".fm-chip.no{color:var(--sub)}.fm-chip.rare:not(.no){border-color:#e8b040}",
      "@media (prefers-reduced-motion:reduce){.fm-art.s3{animation:none}}",
    ].join("\n");
    s.textContent += "\n" + HIDE_CSS;
    document.head.appendChild(s);
  }

  window.FARM = { mount: mount, hideout: hideout };
})();
