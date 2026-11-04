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
    document.head.appendChild(s);
  }

  window.FARM = { mount: mount };
})();
