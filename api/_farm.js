'use strict';
// 농장: 밭(농사) · 정원(화분 가꾸기) · 출하 · 농장 도감
// 판정·보상은 모두 서버(이 파일)가 정하고, 화면(farm.js)은 결과만 그립니다.
//  밭   — 씨앗을 사서 심으면 시간이 지나 자라고, 물을 주면 남은 시간이 15% 줄어듭니다(30분에 한 번 · 작물마다 최대 4번).
//         물을 2번 이상 준 작물은 수확량 +1. 5% 확률로 '황금 수확'(출하가만큼 골드 덤).
//  정원 — 화분에 꽃씨를 심어 피웁니다. 화분은 '창가(햇빛)'·'그늘' 중 한 곳에 두고, 꽃이 좋아하는 자리에 두면 희귀한 색이 잘 나옵니다.
//         물을 줄수록(최대 4번) 희귀한 색 확률이 오르고, 꽃이 피면 '꺾기'로 '색 + 꽃' 아이템을 얻습니다.
//  출하 — 밭·정원에서 얻은 것을 골드로 팝니다.
const HOUR = 3600000, MIN = 60000;
const WATER_CD = 30 * MIN, WATER_MAX = 4, WATER_CUT = 0.85, GOLDEN_P = 0.05;
const PLOT_BASE = 6, PLOT_MAX = 12, POT_BASE = 4, POT_MAX = 8;
const plotCost = n => 1500 * (n - PLOT_BASE + 1);      // 7번째 밭 1500 G, 8번째 3000 G …
const potCost = n => 1200 * (n - POT_BASE + 1);

// 작물: 씨앗 이름 · 가격 · 자라는 시간(분) · 수확량 · 출하가(1개) · 등급 · 그림(이모지)
// 감자·당근·양파·대파·마늘·쌀·찻잎은 요리 재료와 같은 아이템이라 그대로 요리에 쓸 수 있습니다.
const CROPS = [
  { k: 'potato', name: '감자', seed: '씨감자', price: 40, min: 60, y: [2, 4], sell: 18, tier: 'c', em: '🥔' },
  { k: 'carrot', name: '당근', seed: '당근 씨앗', price: 40, min: 60, y: [2, 4], sell: 18, tier: 'c', em: '🥕' },
  { k: 'onion', name: '양파', seed: '양파 모종', price: 30, min: 45, y: [2, 3], sell: 15, tier: 'c', em: '🧅' },
  { k: 'leek', name: '대파', seed: '대파 씨앗', price: 30, min: 40, y: [2, 4], sell: 15, tier: 'c', em: '🌱' },
  { k: 'garlic', name: '마늘', seed: '씨마늘', price: 50, min: 120, y: [3, 5], sell: 20, tier: 'c', em: '🧄' },
  { k: 'rice', name: '쌀', seed: '볍씨', price: 60, min: 180, y: [3, 6], sell: 22, tier: 'c', em: '🌾' },
  { k: 'tea', name: '찻잎', seed: '차나무 묘목', price: 80, min: 240, y: [2, 4], sell: 30, tier: 'c', em: '🍃' },
  { k: 'tomato', name: '토마토', seed: '토마토 모종', price: 50, min: 90, y: [2, 4], sell: 35, tier: 'c', em: '🍅' },
  { k: 'corn', name: '옥수수', seed: '옥수수 씨앗', price: 60, min: 120, y: [2, 3], sell: 45, tier: 'c', em: '🌽' },
  { k: 'cabbage', name: '양배추', seed: '양배추 모종', price: 50, min: 90, y: [1, 2], sell: 60, tier: 'c', em: '🥬' },
  { k: 'chili', name: '고추', seed: '고추 모종', price: 50, min: 90, y: [3, 5], sell: 18, tier: 'c', em: '🌶️' },
  { k: 'sweetpotato', name: '고구마', seed: '고구마 순', price: 60, min: 150, y: [2, 4], sell: 30, tier: 'c', em: '🍠' },
  { k: 'berry', name: '딸기', seed: '딸기 모종', price: 120, min: 180, y: [3, 5], sell: 70, tier: 'r', em: '🍓' },
  { k: 'blueberry', name: '블루베리', seed: '블루베리 묘목', price: 140, min: 210, y: [3, 6], sell: 65, tier: 'r', em: '🫐' },
  { k: 'pumpkin', name: '호박', seed: '호박 씨앗', price: 150, min: 300, y: [1, 2], sell: 200, tier: 'r', em: '🎃' },
  { k: 'melon', name: '수박', seed: '수박 씨앗', price: 200, min: 360, y: [1, 1], sell: 380, tier: 'r', em: '🍉' },
  { k: 'peach', name: '복숭아', seed: '복숭아 묘목', price: 250, min: 420, y: [2, 3], sell: 220, tier: 'r', em: '🍑' },
  { k: 'redchili', name: '적월 고추', seed: '적월 고추 씨앗', price: 400, min: 480, y: [2, 3], sell: 450, tier: 'e', em: '🌶️' },
  { k: 'moongrape', name: '달빛 포도', seed: '달빛 포도 묘목', price: 500, min: 540, y: [2, 3], sell: 480, tier: 'e', em: '🍇' },
  { k: 'starmelon', name: '별빛 멜론', seed: '별빛 멜론 씨앗', price: 1000, min: 720, y: [1, 1], sell: 2600, tier: 'l', em: '🍈' },
];
const CROP_BY = new Map(CROPS.map(c => [c.k, c]));

// 꽃: 꽃씨 가격 · 피는 시간(분) · 좋아하는 자리(sun 창가 · shade 그늘) · 색 [이름, 색 코드, 무게, 희귀 여부] · 출하가(보통 색)
const FLOWERS = [
  { k: 'daisy', name: '데이지', price: 40, min: 60, like: 'sun', tier: 'c', sell: 40, colors: [['흰', '#f6f3ea', 50], ['노란', '#f2c94c', 35], ['분홍', '#f4a6c0', 15, 1]] },
  { k: 'sunflower', name: '해바라기', price: 50, min: 120, like: 'sun', tier: 'c', sell: 55, colors: [['노란', '#f2b632', 60], ['주황', '#ee8a2c', 30], ['적갈색', '#9a4a2a', 10, 1]] },
  { k: 'tulip', name: '튤립', price: 60, min: 90, like: 'sun', tier: 'c', sell: 60, colors: [['빨간', '#e04a4a', 35], ['노란', '#f2d04c', 30], ['보라', '#9a6ad0', 25], ['무지개', '#ff9ad0', 10, 1]] },
  { k: 'lavender', name: '라벤더', price: 70, min: 120, like: 'sun', tier: 'c', sell: 70, colors: [['보라', '#9a7ad8', 70], ['흰', '#efeaf6', 30, 1]] },
  { k: 'rose', name: '장미', price: 80, min: 120, like: 'sun', tier: 'c', sell: 80, colors: [['빨간', '#d4202e', 45], ['분홍', '#f08aa8', 30], ['흰', '#f8f2ee', 17], ['검은', '#3a1a24', 8, 1]] },
  { k: 'hydrangea', name: '수국', price: 90, min: 180, like: 'shade', tier: 'r', sell: 120, colors: [['파란', '#6a9ae0', 35], ['분홍', '#f0a0c8', 30], ['보라', '#a07ad8', 25], ['흰', '#f2f2f8', 10, 1]] },
  { k: 'lily', name: '은방울꽃', price: 100, min: 180, like: 'shade', tier: 'r', sell: 130, colors: [['흰', '#fbfbf4', 80], ['분홍', '#f6c0d4', 20, 1]] },
  { k: 'tigerlily', name: '백합', price: 120, min: 180, like: 'shade', tier: 'r', sell: 150, colors: [['흰', '#fbf8f0', 50], ['주황', '#f08a3a', 35], ['분홍', '#f2a0b8', 15, 1]] },
  { k: 'camellia', name: '동백', price: 150, min: 240, like: 'shade', tier: 'r', sell: 180, colors: [['빨간', '#c81e3a', 55], ['분홍', '#f08aa0', 30], ['흰', '#faf4f0', 15, 1]] },
  { k: 'primrose', name: '달맞이꽃', price: 200, min: 240, like: 'shade', tier: 'e', sell: 260, colors: [['노란', '#f6e06a', 80], ['달빛 은색', '#d8e0f0', 20, 1]] },
  { k: 'redmoon', name: '적월화', price: 500, min: 480, like: 'sun', tier: 'e', sell: 600, colors: [['붉은', '#c0202e', 70], ['핏빛 진홍', '#7a0a1a', 20, 1], ['금빛', '#e8c050', 10, 1]] },
  { k: 'starrose', name: '별빛 장미', price: 1000, min: 720, like: 'shade', tier: 'l', sell: 2000, colors: [['은하', '#8a9af0', 60], ['새벽', '#f0b0d8', 30, 1], ['오로라', '#7af0c8', 10, 1]] },
];
const FLOWER_BY = new Map(FLOWERS.map(f => [f.k, f]));
const flowerItem = (f, c) => c[0] + ' ' + f.name;
const TIER_UP = { c: 'r', r: 'e', e: 'l', l: 'l' };
// 출하할 수 있는 아이템: 이름 → { sell, tier, em(그림), kind }
const SHIP = new Map();
CROPS.forEach(c => SHIP.set(c.name, { sell: c.sell, tier: c.tier, em: c.em, kind: 'crop' }));
FLOWERS.forEach(f => f.colors.forEach(c => SHIP.set(flowerItem(f, c), { sell: c[3] ? f.sell * 3 : f.sell, tier: c[3] ? TIER_UP[f.tier] : f.tier, color: c[1], kind: 'flower' })));
const COLOR_TOTAL = FLOWERS.reduce((a, f) => a + f.colors.length, 0);
// 인벤토리 '조합 아이템' 탭에 들어가는 재료(요리 재료와 이름이 같은 작물은 이미 들어 있음)
const EXTRA_MAT_TIER = new Map(Array.from(SHIP.entries()).map(([n, v]) => [n, v.tier]));

const SQL = [
  "CREATE TABLE IF NOT EXISTS farm_state (user_id INTEGER PRIMARY KEY, plots INTEGER NOT NULL DEFAULT 6, pots INTEGER NOT NULL DEFAULT 4)",
  "CREATE TABLE IF NOT EXISTS farm_plot (user_id INTEGER NOT NULL, idx INTEGER NOT NULL, crop TEXT NOT NULL, planted_at INTEGER NOT NULL, ready_at INTEGER NOT NULL, water_n INTEGER NOT NULL DEFAULT 0, water_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, idx))",
  "CREATE TABLE IF NOT EXISTS garden_pot (user_id INTEGER NOT NULL, idx INTEGER NOT NULL, flower TEXT NOT NULL DEFAULT '', spot TEXT NOT NULL DEFAULT 'sun', planted_at INTEGER NOT NULL DEFAULT 0, ready_at INTEGER NOT NULL DEFAULT 0, water_n INTEGER NOT NULL DEFAULT 0, water_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, idx))",
  "CREATE TABLE IF NOT EXISTS farm_dex (user_id INTEGER NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, k))",
  "CREATE TABLE IF NOT EXISTS hideout (user_id INTEGER PRIMARY KEY, items TEXT NOT NULL DEFAULT '[]', ver INTEGER NOT NULL DEFAULT 0, wall TEXT NOT NULL DEFAULT 'cream', floor TEXT NOT NULL DEFAULT 'oak', name TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL DEFAULT 0)",
  "ALTER TABLE hideout ADD COLUMN lvl INTEGER NOT NULL DEFAULT 0",      // 방 크기 단계 (0: 7×7 · 1: 10×10 · 2: 15×15)
  "CREATE TABLE IF NOT EXISTS hideout_own (user_id INTEGER NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, k))",
];
// ── 아지트 꾸미기: 7×7 방. 계약서(100,000 G)를 사야 꾸밀 수 있고, 가구는 골드로 사서 보관함에 두었다가 방에 놓습니다. ──
// 가구: [키, 이름, 가로, 세로, 가격, 층] — 층 'floor'(러그·마법진)는 바닥에 깔려서 다른 가구 밑에 놓을 수 있고, 같은 층끼리만 겹칠 수 없습니다.
// 방 크기: 기본 7×7 → 확장 계약서 1번째 10×10 → 2번째 15×15. 한 칸은 다시 2×2(4분의 1)로 나뉘어, 가구는 반 칸 단위로 놓을 수 있습니다.
// 가구 크기(w·h)는 칸 단위(0.5 = 반 칸), 위치(x·y)는 반 칸 단위로 저장합니다.
const LEVELS = [7, 10, 15], EXPAND_PRICES = [50000, 100000], CONTRACT_PRICE = 100000, FURN_MAX = 100, SUB = 2;
const FURN = [
  ['chair', '의자', 1, 1, 800], ['stool', '등받이 없는 의자', 1, 1, 500], ['nightstand', '협탁', 1, 1, 900], ['drawer', '서랍장', 1, 1, 1500],
  ['lamp', '스탠드', 1, 1, 700], ['plant', '화분', 1, 1, 600], ['fridge', '냉장고', 1, 1, 3000], ['aquarium', '어항', 1, 1, 2500],
  ['moonlamp', '적월석 램프', 1, 1, 6000], ['trashcan', '휴지통', 1, 1, 200],
  ['bed', '침대', 2, 1, 4000], ['desk', '책상', 2, 1, 2500], ['wardrobe', '옷장', 2, 1, 3500], ['bookshelf', '책장', 2, 1, 3000],
  ['sink', '싱크대', 2, 1, 3500], ['tv', 'TV', 2, 1, 4500], ['piano', '피아노', 2, 1, 9000], ['bathtub', '욕조', 2, 1, 6000],
  ['fireplace', '벽난로', 2, 1, 7000], ['weaponrack', '무기 거치대', 2, 1, 5000], ['trophy', '트로피 진열장', 2, 1, 6500],
  ['sofa', '소파', 3, 1, 5500], ['bigbed', '2인용 침대', 2, 2, 8000], ['table', '식탁', 2, 2, 4000], ['kotatsu', '코타츠', 2, 2, 4500],
  ['partition', '가벽', 1, 0.5, 600],
  ['rug', '러그', 3, 2, 2000, 'floor'], ['mat', '현관 매트', 1, 1, 300, 'floor'], ['magiccircle', '마법진', 3, 3, 15000, 'floor'],
  // ── 추가 가구 22종 (총 50종) ──
  ['armchair', '안락의자', 1, 1, 2200], ['rocking', '흔들의자', 1, 1, 2600], ['beanbag', '빈백', 1, 1, 1800], 
  ['vanity', '화장대', 1, 1, 3200], ['mirror', '전신 거울', 1, 1, 1600], 
  ['clock', '괘종시계', 1, 1, 5000], ['aircon', '에어컨', 1, 1, 4200],
  ['washer', '세탁기', 1, 1, 4500], ['catbed', '고양이 집', 1, 1, 1200],
  ['statue', '수호상', 1, 1, 8000], ['potionrack', '물약 선반', 1, 1, 3500], ['bonsai', '분재', 1, 1, 3000],
  ['tvstand', 'TV 장식장', 3, 1, 4800], ['kitchen', '주방 조리대', 3, 1, 7200], ['bar', '바 카운터', 4, 1, 9500], ['bookwall', '벽면 책장', 4, 1, 9000],
  ['bunk', '2층 침대', 2, 1, 6800], ['gamebox', '오락기', 1, 2, 7800], ['vending', '자판기', 1, 2, 6500],
  ['cauldron', '마법 가마솥', 2, 2, 12000],
  ['grandpiano', '그랜드 피아노', 3, 2, 22000],
  
  ['tatami', '다다미', 2, 2, 2400, 'floor'], 
].map(f => ({ k: f[0], name: f[1], w: f[2], h: f[3], price: f[4], layer: f[5] || 'main' }));
const FURN_BY = new Map(FURN.map(f => [f.k, f]));

const WALLS = { cream: '#f4ecdc', mint: '#d8eee2', sky: '#d8e6f4', rose: '#f4dce2', lilac: '#e4dcf2', night: '#2a2238', brick: '#8a4a3a', wood: '#a8784a' };
const FLOORS = { oak: '#c8a070', walnut: '#7a5236', tile: '#d8d8d0', mint: '#b8dcc8', carpet: '#c8a0b0', stone: '#8a8a90', tatami: '#c8c88a', red: '#7a2a32' };
const PURGE = ['farm_state', 'farm_plot', 'garden_pot', 'farm_dex', 'hideout', 'hideout_own'].map(t => ['DELETE FROM ' + t + ' WHERE user_id = ?']);

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
// 받침에 따라 을/를
const eul = w => { const k = String(w).charCodeAt(String(w).length - 1); return w + (k >= 0xAC00 && k <= 0xD7A3 && (k - 0xAC00) % 28 ? '을' : '를'); };

function install(d) {
  const { db, route, send, fail, limited, grantGold, grantExp, logAcquire, giveItem, userByCode, isFriend, normCode } = d;

  async function stateRow(uid) {
    await db.run('INSERT INTO farm_state (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING', [uid]);
    return db.get('SELECT plots, pots FROM farm_state WHERE user_id = ?', [uid]);
  }
  const dexAdd = (uid, k, n) => db.run('INSERT INTO farm_dex (user_id, k, n) VALUES (?, ?, ?) ON CONFLICT(user_id, k) DO UPDATE SET n = farm_dex.n + excluded.n', [uid, k, n]);
  const growView = (r, now) => {
    const total = Math.max(1, Number(r.ready_at) - Number(r.planted_at)), p = Math.max(0, Math.min(1, (now - Number(r.planted_at)) / total));
    const ready = now >= Number(r.ready_at);
    return { stage: ready ? 3 : p < 0.25 ? 0 : p < 0.6 ? 1 : 2, progress: ready ? 1 : Math.round(p * 1000) / 1000, readyIn: Math.max(0, Number(r.ready_at) - now),
      waterN: Number(r.water_n) || 0, waterIn: Number(r.water_n) >= WATER_MAX || ready ? -1 : Math.max(0, Number(r.water_at) + WATER_CD - now) };
  };
  async function view(uid, now) {
    const st = await stateRow(uid);
    const plots = new Map((await db.all('SELECT idx, crop, planted_at, ready_at, water_n, water_at FROM farm_plot WHERE user_id = ?', [uid])).map(r => [Number(r.idx), r]));
    const pots = new Map((await db.all('SELECT idx, flower, spot, planted_at, ready_at, water_n, water_at FROM garden_pot WHERE user_id = ?', [uid])).map(r => [Number(r.idx), r]));
    const dex = await db.all('SELECT k, n FROM farm_dex WHERE user_id = ?', [uid]);
    const dm = new Map(dex.map(r => [r.k, Number(r.n) || 0]));
    const names = Array.from(SHIP.keys()), inv = await db.all('SELECT item, qty FROM inventory WHERE user_id = ? AND qty > 0 AND item IN (' + names.map(() => '?').join(',') + ')', [uid].concat(names));
    const u = await db.get('SELECT gold FROM users WHERE id = ?', [uid]);
    const P = [];
    for (let i = 0; i < st.plots; i++) { const r = plots.get(i), c = r && CROP_BY.get(r.crop); P.push(c ? Object.assign({ idx: i, crop: c.k }, growView(r, now)) : { idx: i, crop: '' }); }
    const Q = [];
    for (let i = 0; i < st.pots; i++) { const r = pots.get(i), f = r && r.flower && FLOWER_BY.get(r.flower); Q.push(Object.assign({ idx: i, spot: r ? r.spot : 'sun', flower: f ? f.k : '' }, f ? growView(r, now) : {})); }
    return {
      now, gold: Number(u && u.gold) || 0, plots: P, pots: Q, plotMax: PLOT_MAX, potMax: POT_MAX,
      plotCost: st.plots < PLOT_MAX ? plotCost(st.plots) : 0, potCost: st.pots < POT_MAX ? potCost(st.pots) : 0,
      waterCd: WATER_CD, waterMax: WATER_MAX,
      crops: CROPS.map(c => ({ k: c.k, name: c.name, seed: c.seed, price: c.price, min: c.min, y: c.y, sell: c.sell, tier: c.tier, em: c.em, got: dm.get('c:' + c.name) || 0 })),
      flowers: FLOWERS.map(f => ({ k: f.k, name: f.name, price: f.price, min: f.min, like: f.like, tier: f.tier, sell: f.sell,
        colors: f.colors.map(c => ({ name: c[0], hex: c[1], rare: !!c[3], got: dm.get('f:' + f.name + ':' + c[0]) || 0 })) })),
      ship: inv.map(r => { const s = SHIP.get(r.item); return { item: r.item, qty: Number(r.qty), sell: s.sell, tier: s.tier, em: s.em || '', color: s.color || '', kind: s.kind }; }),
      harvests: dm.get('hv') || 0, blooms: dm.get('bl') || 0, colorTotal: COLOR_TOTAL,
      colorsGot: dex.filter(r => r.k.indexOf('f:') === 0).length,
    };
  }
  route('GET', '/api/farm', async (req, res, ctx) => send(res, 200, await view(ctx.user.id, Date.now())));

  const pay = async (uid, cost) => (await db.run('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?', [cost, uid, cost])).changes === 1;

  // ── 밭 ──
  route('POST', '/api/farm/plant', async (req, res, ctx) => {
    if (await limited('farm:' + ctx.user.id, 90, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), idx = Number(ctx.body.idx), c = CROP_BY.get(String(ctx.body.crop || ''));
    const st = await stateRow(uid);
    if (!c) return fail(res, 404, 'not_found');
    if (!Number.isInteger(idx) || idx < 0 || idx >= st.plots) return fail(res, 400, 'bad_plot');
    if (await db.get('SELECT 1 AS x FROM farm_plot WHERE user_id = ? AND idx = ?', [uid, idx])) return fail(res, 409, 'busy');
    if (!(await pay(uid, c.price))) return fail(res, 409, 'no_gold');
    const w = await db.run('INSERT INTO farm_plot (user_id, idx, crop, planted_at, ready_at, water_n, water_at) VALUES (?, ?, ?, ?, ?, 0, 0) ON CONFLICT(user_id, idx) DO NOTHING', [uid, idx, c.k, now, now + c.min * MIN]);
    if (w.changes !== 1) { await grantGold(uid, c.price); return fail(res, 409, 'busy'); }
    send(res, 200, Object.assign({ ok: true, msg: eul(c.seed) + ' 심었어요.' }, await view(uid, now)));
  });
  async function waterOne(uid, table, r, now) {
    if (now >= Number(r.ready_at) || Number(r.water_n) >= WATER_MAX || now < Number(r.water_at) + WATER_CD) return false;
    const left = Number(r.ready_at) - now, nr = now + Math.round(left * WATER_CUT);
    const w = await db.run('UPDATE ' + table + ' SET ready_at = ?, water_n = water_n + 1, water_at = ? WHERE user_id = ? AND idx = ? AND water_n = ?', [nr, now, uid, r.idx, r.water_n]);
    return w.changes === 1;
  }
  route('POST', '/api/farm/water', async (req, res, ctx) => {      // idx = -1 이면 물을 줄 수 있는 밭 전부
    if (await limited('farm:' + ctx.user.id, 90, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), idx = Number(ctx.body.idx);
    const rows = await db.all('SELECT idx, crop, planted_at, ready_at, water_n, water_at FROM farm_plot WHERE user_id = ?' + (idx >= 0 ? ' AND idx = ?' : ''), idx >= 0 ? [uid, idx] : [uid]);
    let n = 0;
    for (const r of rows) if (await waterOne(uid, 'farm_plot', r, now)) n++;
    if (!n) return fail(res, 409, 'no_water');
    send(res, 200, Object.assign({ ok: true, msg: '밭 ' + n + '칸에 물을 줬어요. 자라는 시간이 줄었어요.' }, await view(uid, now)));
  });
  route('POST', '/api/farm/harvest', async (req, res, ctx) => {      // idx = -1 이면 다 자란 밭 전부
    if (await limited('farm:' + ctx.user.id, 90, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), idx = Number(ctx.body.idx);
    const rows = await db.all('SELECT idx, crop, planted_at, ready_at, water_n FROM farm_plot WHERE user_id = ? AND ready_at <= ?' + (idx >= 0 ? ' AND idx = ?' : ''), idx >= 0 ? [uid, now, idx] : [uid, now]);
    const got = {}; let gold = 0, exp = 0, golden = 0, n = 0;
    for (const r of rows) {
      const c = CROP_BY.get(r.crop);
      const d = await db.run('DELETE FROM farm_plot WHERE user_id = ? AND idx = ? AND planted_at = ?', [uid, r.idx, r.planted_at]);
      if (d.changes !== 1 || !c) continue;
      n++;
      const q = rnd(c.y[0], c.y[1]) + (Number(r.water_n) >= 2 ? 1 : 0);
      got[c.name] = (got[c.name] || 0) + q;
      if (Math.random() < GOLDEN_P) { golden++; gold += c.sell * q; }
      exp += Math.max(1, Math.round(c.min / 30));
    }
    if (!n) return fail(res, 409, 'not_ready');
    for (const name of Object.keys(got)) { await giveItem(uid, name, got[name]); await logAcquire(uid, 'item', name, got[name], '농장 수확', now); await dexAdd(uid, 'c:' + name, got[name]); }
    await dexAdd(uid, 'hv', n);
    if (gold) { await grantGold(uid, gold); await logAcquire(uid, 'gold', '골드', gold, '농장 황금 수확', now); }
    if (exp) await grantExp(uid, exp);
    const list = Object.keys(got).map(k => k + ' ×' + got[k]).join(', ');
    send(res, 200, Object.assign({ ok: true, got, gold, golden, exp, msg: '수확! ' + list + (golden ? ' · ✨ 황금 수확 +' + gold + ' G' : '') + ' · 경험치 +' + exp }, await view(uid, now)));
  });
  route('POST', '/api/farm/clear', async (req, res, ctx) => {      // 심은 작물·꽃 뽑기 (씨앗값은 돌려주지 않음)
    const uid = ctx.user.id, now = Date.now(), idx = Number(ctx.body.idx), kind = String(ctx.body.kind || 'plot');
    if (kind === 'pot') await db.run("UPDATE garden_pot SET flower = '', planted_at = 0, ready_at = 0, water_n = 0, water_at = 0 WHERE user_id = ? AND idx = ?", [uid, idx]);
    else await db.run('DELETE FROM farm_plot WHERE user_id = ? AND idx = ?', [uid, idx]);
    send(res, 200, Object.assign({ ok: true, msg: '비웠어요.' }, await view(uid, now)));
  });
  route('POST', '/api/farm/expand', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now(), kind = String(ctx.body.kind || 'plot'), st = await stateRow(uid);
    const pot = kind === 'pot', cur = pot ? st.pots : st.plots, max = pot ? POT_MAX : PLOT_MAX;
    if (cur >= max) return fail(res, 409, 'max');
    const cost = pot ? potCost(cur) : plotCost(cur);
    if (!(await pay(uid, cost))) return fail(res, 409, 'no_gold');
    const w = await db.run('UPDATE farm_state SET ' + (pot ? 'pots = pots' : 'plots = plots') + ' + 1 WHERE user_id = ? AND ' + (pot ? 'pots' : 'plots') + ' = ?', [uid, cur]);
    if (w.changes !== 1) { await grantGold(uid, cost); return fail(res, 409, 'busy'); }
    send(res, 200, Object.assign({ ok: true, msg: pot ? '화분을 하나 더 들였어요.' : '밭을 한 칸 더 일궜어요.' }, await view(uid, now)));
  });

  // ── 정원 ──
  async function potRow(uid, idx) {
    await db.run("INSERT INTO garden_pot (user_id, idx) VALUES (?, ?) ON CONFLICT(user_id, idx) DO NOTHING", [uid, idx]);
    return db.get('SELECT idx, flower, spot, planted_at, ready_at, water_n, water_at FROM garden_pot WHERE user_id = ? AND idx = ?', [uid, idx]);
  }
  route('POST', '/api/garden/plant', async (req, res, ctx) => {
    if (await limited('farm:' + ctx.user.id, 90, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), idx = Number(ctx.body.idx), f = FLOWER_BY.get(String(ctx.body.flower || '')), st = await stateRow(uid);
    if (!f) return fail(res, 404, 'not_found');
    if (!Number.isInteger(idx) || idx < 0 || idx >= st.pots) return fail(res, 400, 'bad_pot');
    const r = await potRow(uid, idx);
    if (r.flower) return fail(res, 409, 'busy');
    if (!(await pay(uid, f.price))) return fail(res, 409, 'no_gold');
    const w = await db.run("UPDATE garden_pot SET flower = ?, planted_at = ?, ready_at = ?, water_n = 0, water_at = 0 WHERE user_id = ? AND idx = ? AND flower = ''", [f.k, now, now + f.min * MIN, uid, idx]);
    if (w.changes !== 1) { await grantGold(uid, f.price); return fail(res, 409, 'busy'); }
    send(res, 200, Object.assign({ ok: true, msg: f.name + ' 꽃씨를 심었어요.' }, await view(uid, now)));
  });
  route('POST', '/api/garden/water', async (req, res, ctx) => {      // idx = -1 이면 물을 줄 수 있는 화분 전부
    if (await limited('farm:' + ctx.user.id, 90, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), idx = Number(ctx.body.idx);
    const rows = await db.all("SELECT idx, flower, planted_at, ready_at, water_n, water_at FROM garden_pot WHERE user_id = ? AND flower != ''" + (idx >= 0 ? ' AND idx = ?' : ''), idx >= 0 ? [uid, idx] : [uid]);
    let n = 0;
    for (const r of rows) if (await waterOne(uid, 'garden_pot', r, now)) n++;
    if (!n) return fail(res, 409, 'no_water');
    send(res, 200, Object.assign({ ok: true, msg: '화분 ' + n + '개에 물을 줬어요.' }, await view(uid, now)));
  });
  route('POST', '/api/garden/spot', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now(), idx = Number(ctx.body.idx), spot = ctx.body.spot === 'shade' ? 'shade' : 'sun', st = await stateRow(uid);
    if (!Number.isInteger(idx) || idx < 0 || idx >= st.pots) return fail(res, 400, 'bad_pot');
    await potRow(uid, idx);
    await db.run('UPDATE garden_pot SET spot = ? WHERE user_id = ? AND idx = ?', [spot, uid, idx]);
    send(res, 200, Object.assign({ ok: true, msg: spot === 'sun' ? '화분을 창가로 옮겼어요.' : '화분을 그늘로 옮겼어요.' }, await view(uid, now)));
  });
  // 꽃이 피면 색을 정합니다: 좋아하는 자리 → 희귀한 색 무게 ×2, 물 1번마다 ×1.25
  function pickColor(f, spot, waterN) {
    const mul = (spot === f.like ? 2 : 1) * Math.pow(1.25, Math.min(WATER_MAX, waterN));
    const ws = f.colors.map(c => c[2] * (c[3] ? mul : 1));
    let x = Math.random() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x <= 0) return f.colors[i]; }
    return f.colors[0];
  }
  route('POST', '/api/garden/pick', async (req, res, ctx) => {
    if (await limited('farm:' + ctx.user.id, 90, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), idx = Number(ctx.body.idx);
    const r = await db.get("SELECT idx, flower, spot, planted_at, ready_at, water_n FROM garden_pot WHERE user_id = ? AND idx = ? AND flower != ''", [uid, idx]);
    if (!r || now < Number(r.ready_at)) return fail(res, 409, 'not_ready');
    const f = FLOWER_BY.get(r.flower);
    const w = await db.run("UPDATE garden_pot SET flower = '', planted_at = 0, ready_at = 0, water_n = 0, water_at = 0 WHERE user_id = ? AND idx = ? AND planted_at = ?", [uid, idx, r.planted_at]);
    if (w.changes !== 1 || !f) return fail(res, 409, 'busy');
    const c = pickColor(f, r.spot, Number(r.water_n) || 0), item = flowerItem(f, c);
    const first = !(await db.get('SELECT 1 AS x FROM farm_dex WHERE user_id = ? AND k = ?', [uid, 'f:' + f.name + ':' + c[0]]));
    await giveItem(uid, item, 1); await logAcquire(uid, 'item', item, 1, '정원', now);
    await dexAdd(uid, 'f:' + f.name + ':' + c[0], 1); await dexAdd(uid, 'bl', 1);
    const exp = Math.max(1, Math.round(f.min / 40)); await grantExp(uid, exp);
    send(res, 200, Object.assign({ ok: true, item, hex: c[1], rare: !!c[3], first, exp, msg: (c[3] ? '✨ 희귀한 색! ' : '') + eul(item) + ' 꺾었어요' + (first ? ' · 꽃 도감에 새로 올렸어요' : '') + ' · 경험치 +' + exp }, await view(uid, now)));
  });

  // ── 출하 ──
  route('POST', '/api/farm/ship', async (req, res, ctx) => {
    if (await limited('farm:' + ctx.user.id, 90, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), item = String(ctx.body.item || ''), s = SHIP.get(item);
    if (!s) return fail(res, 404, 'not_found');
    const have = await db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [uid, item]);
    const qty = Math.min(Number(have && have.qty) || 0, Math.max(1, Math.floor(Number(ctx.body.qty) || 1)));
    if (qty <= 0) return fail(res, 409, 'no_item');
    const w = await db.run('UPDATE inventory SET qty = qty - ? WHERE user_id = ? AND item = ? AND qty >= ?', [qty, uid, item, qty]);
    if (w.changes !== 1) return fail(res, 409, 'no_item');
    await db.run('DELETE FROM inventory WHERE user_id = ? AND item = ? AND qty <= 0', [uid, item]);
    const gold = s.sell * qty;
    await grantGold(uid, gold); await logAcquire(uid, 'gold', '골드', gold, '농장 출하 (' + item + ' ×' + qty + ')', now);
    send(res, 200, Object.assign({ ok: true, msg: item + ' ×' + qty + ' 출하 · +' + gold + ' G' }, await view(uid, now)));
  });

  // ═════════ 아지트 꾸미기 ═════════
  const parseItems = t => { try { const a = JSON.parse(t || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; } };
  const cellsOf = (f, x, y, r) => { const w = Math.round((r ? f.h : f.w) * SUB), h = Math.round((r ? f.w : f.h) * SUB), out = []; for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) out.push((x + i) + ',' + (y + j)); return { w, h, out }; };
  // 놓을 수 있는지: 방 안 · 같은 층 가구와 겹치지 않음
  function fits(items, f, x, y, r, skipId, size) {      // size: 방 한 변의 칸 수 → 반 칸 단위로 검사
    size = (size || LEVELS[0]) * SUB;
    const c = cellsOf(f, x, y, r);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + c.w > size || y + c.h > size) return false;
    const used = new Set();
    items.forEach(it => { if (it.id === skipId) return; const g = FURN_BY.get(it.k); if (!g || g.layer !== f.layer) return; cellsOf(g, it.x, it.y, it.r).out.forEach(k => used.add(k)); });
    return c.out.every(k => !used.has(k));
  }
  async function hideRow(uid) { return db.get('SELECT items, ver, wall, floor, name, lvl FROM hideout WHERE user_id = ?', [uid]); }
  const lvlOf = h => Math.max(0, Math.min(LEVELS.length - 1, Number(h && h.lvl) || 0)), roomOf = h => LEVELS[lvlOf(h)];
  // 방 정리: 목록에서 빠진 가구는 산 값을 돌려주고, 방 크기가 바뀌어 밖으로 나간 가구는 보관함으로
  // 방 정리: 목록에 없는 가구 · 방 밖으로 나간 가구는 보관함으로
  async function tidy(uid) {
    const h = await hideRow(uid); if (!h) return;
    const N = roomOf(h) * SUB, items = parseItems(h.items);
    const keep = items.filter(it => { const f = FURN_BY.get(it.k); if (!f) return false; const c = cellsOf(f, it.x, it.y, it.r); return it.x >= 0 && it.y >= 0 && it.x + c.w <= N && it.y + c.h <= N; });
    if (keep.length !== items.length) await db.run('UPDATE hideout SET items = ?, ver = ver + 1 WHERE user_id = ? AND ver = ?', [JSON.stringify(keep), uid, h.ver]);
  }
  async function hideView(uid, now) {
    await tidy(uid).catch(() => {});
    const h = await hideRow(uid), u = await db.get('SELECT gold FROM users WHERE id = ?', [uid]);
    const own = {}; (await db.all('SELECT k, n FROM hideout_own WHERE user_id = ?', [uid])).forEach(r => { own[r.k] = Number(r.n) || 0; });
    const items = h ? parseItems(h.items) : [];
    const placed = {}; items.forEach(it => { placed[it.k] = (placed[it.k] || 0) + 1; });
    return { now, gold: Number(u && u.gold) || 0, contract: !!h, price: CONTRACT_PRICE, room: roomOf(h), sub: SUB, lvl: lvlOf(h), next: lvlOf(h) < LEVELS.length - 1 ? { size: LEVELS[lvlOf(h) + 1], price: EXPAND_PRICES[lvlOf(h)], n: lvlOf(h) + 1 } : null, items, ver: h ? Number(h.ver) : 0,
      wall: h ? h.wall : 'cream', floor: h ? h.floor : 'oak', name: h ? h.name : '', walls: WALLS, floors: FLOORS, max: FURN_MAX,
      catalog: FURN.map(f => ({ k: f.k, name: f.name, w: f.w, h: f.h, price: f.price, layer: f.layer, own: own[f.k] || 0, placed: placed[f.k] || 0 })) };
  }
  route('GET', '/api/hideout', async (req, res, ctx) => send(res, 200, await hideView(ctx.user.id, Date.now())));
  // 친구의 아지트 구경 (읽기 전용)
  route('GET', '/api/hideout/visit', async (req, res, ctx) => {
    const code = normCode(new URL(req.url, 'http://x').searchParams.get('code') || '');
    const f = code && await userByCode(code);
    if (!f) return fail(res, 404, 'not_found');
    if (f.id !== ctx.user.id && !(await isFriend(ctx.user.id, f.id))) return fail(res, 403, 'not_friend');
    const h = await hideRow(f.id);
    if (!h) return send(res, 200, { contract: false, hn: f.hunter_name });
    send(res, 200, { contract: true, hn: f.hunter_name, room: roomOf(h), sub: SUB, items: parseItems(h.items), wall: h.wall, floor: h.floor, name: h.name, walls: WALLS, floors: FLOORS,
      catalog: FURN.map(x => ({ k: x.k, name: x.name, w: x.w, h: x.h, layer: x.layer })) });
  });
  route('POST', '/api/hideout/contract', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now();
    if (await hideRow(uid)) return fail(res, 409, 'have');
    if (!(await pay(uid, CONTRACT_PRICE))) return fail(res, 409, 'no_gold');
    const w = await db.run("INSERT INTO hideout (user_id, items, ver, at) VALUES (?, '[]', 0, ?) ON CONFLICT(user_id) DO NOTHING", [uid, now]);
    if (w.changes !== 1) { await grantGold(uid, CONTRACT_PRICE); return fail(res, 409, 'have'); }
    send(res, 200, Object.assign({ ok: true, msg: '아지트 계약 완료! 이제 가구를 사서 방을 꾸며 보세요.' }, await hideView(uid, now)));
  });
  route('POST', '/api/hideout/expand', async (req, res, ctx) => {      // 확장 계약서: 7×7 → 10×10 → 15×15 (가구 자리는 그대로)
    const uid = ctx.user.id, now = Date.now(), h = await hideRow(uid);
    if (!h) return fail(res, 409, 'no_contract');
    const lv = lvlOf(h);
    if (lv >= LEVELS.length - 1) return fail(res, 409, 'have');
    const cost = EXPAND_PRICES[lv];
    if (!(await pay(uid, cost))) return fail(res, 409, 'no_gold');
    const w = await db.run('UPDATE hideout SET lvl = ?, ver = ver + 1 WHERE user_id = ? AND lvl = ?', [lv + 1, uid, lv]);
    if (w.changes !== 1) { await grantGold(uid, cost); return fail(res, 409, 'busy'); }
    send(res, 200, Object.assign({ ok: true, msg: (lv + 1) + '번째 확장 계약 완료! 아지트가 ' + LEVELS[lv + 1] + '×' + LEVELS[lv + 1] + ({ 10: '으로', 7: '으로' }[LEVELS[lv + 1]] || '로') + ' 넓어졌어요.' }, await hideView(uid, now)));
  });
  route('POST', '/api/hideout/buy', async (req, res, ctx) => {
    if (await limited('hide:' + ctx.user.id, 90, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), f = FURN_BY.get(String(ctx.body.k || ''));
    if (!f) return fail(res, 404, 'not_found');
    if (!(await hideRow(uid))) return fail(res, 409, 'no_contract');
    const tot = await db.get('SELECT COALESCE(SUM(n), 0) AS c FROM hideout_own WHERE user_id = ?', [uid]);
    if (Number(tot.c) >= FURN_MAX) return fail(res, 409, 'too_many');
    if (!(await pay(uid, f.price))) return fail(res, 409, 'no_gold');
    await db.run('INSERT INTO hideout_own (user_id, k, n) VALUES (?, ?, 1) ON CONFLICT(user_id, k) DO UPDATE SET n = hideout_own.n + 1', [uid, f.k]);
    send(res, 200, Object.assign({ ok: true, msg: eul(f.name) + ' 샀어요. 보관함에서 골라 방에 놓아 보세요.' }, await hideView(uid, now)));
  });
  route('POST', '/api/hideout/sell', async (req, res, ctx) => {      // 보관함의 가구를 절반 값에 되팔기
    const uid = ctx.user.id, now = Date.now(), f = FURN_BY.get(String(ctx.body.k || ''));
    if (!f) return fail(res, 404, 'not_found');
    const h = await hideRow(uid); if (!h) return fail(res, 409, 'no_contract');
    const placed = parseItems(h.items).filter(it => it.k === f.k).length;
    const w = await db.run('UPDATE hideout_own SET n = n - 1 WHERE user_id = ? AND k = ? AND n > ?', [uid, f.k, placed]);
    if (w.changes !== 1) return fail(res, 409, 'none_free');
    const back = Math.floor(f.price / 2); await grantGold(uid, back);
    send(res, 200, Object.assign({ ok: true, msg: f.name + ' 되팔기 · +' + back + ' G' }, await hideView(uid, now)));
  });
  // 방 바꾸기: 놓기(k) · 옮기기·돌리기(id) · 보관함으로(id, del) · 모두 치우기(all) · 벽지·바닥(wall, floor) · 이름(name)
  route('POST', '/api/hideout/edit', async (req, res, ctx) => {
    if (await limited('hide:' + ctx.user.id, 120, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), b = ctx.body || {};
    const h = await hideRow(uid); if (!h) return fail(res, 409, 'no_contract');
    let items = parseItems(h.items), wall = h.wall, floor = h.floor, name = h.name, msg = '';
    const x = Number(b.x), y = Number(b.y), r = b.r ? 1 : 0;
    if (b.all) { items = []; msg = '가구를 모두 보관함으로 옮겼어요.'; }
    else if (b.wall || b.floor || b.name !== undefined) {
      if (b.wall && WALLS[b.wall]) wall = b.wall;
      if (b.floor && FLOORS[b.floor]) floor = b.floor;
      if (b.name !== undefined) name = String(b.name).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
      msg = '아지트를 꾸몄어요.';
    } else if (b.k) {
      const f = FURN_BY.get(String(b.k)); if (!f) return fail(res, 404, 'not_found');
      const own = await db.get('SELECT n FROM hideout_own WHERE user_id = ? AND k = ?', [uid, f.k]);
      if ((Number(own && own.n) || 0) <= items.filter(it => it.k === f.k).length) return fail(res, 409, 'none_free');
      if (!fits(items, f, x, y, r, 0, roomOf(h))) return fail(res, 409, 'no_room');
      const id = items.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0) + 1;
      items.push({ id, k: f.k, x, y, r }); msg = eul(f.name) + ' 놓았어요.';
    } else if (b.id) {
      const it = items.find(z => z.id === Number(b.id)); if (!it) return fail(res, 404, 'not_found');
      const f = FURN_BY.get(it.k);
      if (b.del) { items = items.filter(z => z !== it); msg = f.name + ' — 보관함으로 옮겼어요.'; }
      else { if (!fits(items, f, x, y, r, it.id, roomOf(h))) return fail(res, 409, 'no_room'); it.x = x; it.y = y; it.r = r; msg = eul(f.name) + ' 옮겼어요.'; }
    } else return fail(res, 400, 'bad_req');
    const w = await db.run('UPDATE hideout SET items = ?, wall = ?, floor = ?, name = ?, ver = ver + 1, at = ? WHERE user_id = ? AND ver = ?', [JSON.stringify(items), wall, floor, name, now, uid, h.ver]);
    if (w.changes !== 1) return fail(res, 409, 'busy');
    send(res, 200, Object.assign({ ok: true, msg }, await hideView(uid, now)));
  });

  return {
    achStats: async uid => {
      const r = await db.get("SELECT COALESCE(SUM(CASE WHEN k = 'hv' THEN n ELSE 0 END), 0) AS hv, COALESCE(SUM(CASE WHEN k LIKE 'f:%' THEN 1 ELSE 0 END), 0) AS fl FROM farm_dex WHERE user_id = ?", [uid]);
      return { harvest: Number(r && r.hv) || 0, flowers: Number(r && r.fl) || 0 };
    },
    purge: id => PURGE.map(p => [p[0], [id]]),
  };
}

module.exports = { install, SQL, EXTRA_MAT_TIER, CROPS, FLOWERS, COLOR_TOTAL };
