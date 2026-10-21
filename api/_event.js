'use strict';
// ═══════════════════════════════════════════════════════════════════════
//  [EVENT:HALLOWEEN] 할로윈 이벤트 — 이 파일 하나에 이벤트 내용이 모여 있습니다.
//
//  ■ 끄는 법 (기존 서버처럼 돌리기)
//    1) 관리자 페이지 → '할로윈 이벤트' 카드에서 [끄기] 를 누르면 즉시 꺼집니다. (코드 수정 없음)
//    2) '자동' 상태이면 아래 START ~ END 기간에만 켜지고, END 가 지나면 저절로 꺼집니다.
//    꺼지면: 백귀야행 몬스터가 더 나오지 않고(남은 잡귀는 청소), 소원 앱과 이벤트 소문이 사라지고,
//            가면 조합이 막힙니다. 이미 만든 가면은 그대로 가지고 착용할 수 있습니다.
//
//  ■ 아예 코드에서 지우고 싶다면
//    - 이 파일과, 다른 파일에서 'EVENT:HALLOWEEN' 으로 검색되는 부분(약 15곳)을 지우면 됩니다.
//    - DB 의 ev_wish 표는 비어 있어도 괜찮습니다. 이미 지급된 '도깨비 불씨'·가면·업적은 기념품으로 남습니다.
//
//  ■ 내용
//    ① 백귀야행   : 밤(20시~02시)에 헌터마다 약한 '잡귀' 몬스터가 여러 마리 나오고, 처치하면 도깨비 불씨를 줍니다.
//    ② 소원       : 하루 한 번, 귀신이 찾는 재료 3가지를 모아 건네면 보상. 5일 연속이면 업적(칭호).
//    ③ 가면 장비  : 도깨비 불씨 + 재료로 가면(얼굴 부위 장비)을 조합. 이벤트 기간에만 조합 가능.
//    ④ 혼령 소문  : 괴담 앱에 이벤트 소문이 섞여 나오고, 소문이 사실이면 믿은 사람에게 불씨를 더 줍니다.
// ═══════════════════════════════════════════════════════════════════════

const HOUR = 3600000, MIN = 60000;

// ── 기간 (한국 시간) ──
const START = Date.parse('2026-10-24T00:00:00+09:00');     // '자동' 상태일 때 이 시각부터 켜짐
const END = Date.parse('2026-11-01T00:00:00+09:00');       // '자동' 상태일 때 이 시각에 꺼짐

// ── 백귀야행 ──
const EMBER = '도깨비 불씨';
const GHOSTS = ['떠돌이 잡귀', '굶주린 아귀', '도깨비불', '달걀귀신', '몽달귀신', '손각시', '야광귀', '빗자루 도깨비'];
const GHOST_SET = new Set(GHOSTS);
const NIGHT_FROM = 20, NIGHT_TO = 2;                        // 한국 시간 20시 ~ 다음날 02시
const GHOST_GAP = [6, 12];                                   // 몇 분마다 한 무리가 나오는가
const GHOST_BATCH = [2, 3];                                  // 한 무리의 마리 수
const GHOST_CAP = 10;                                        // 헌터 한 명에게 동시에 떠 있는 잡귀 수 상한
const GHOST_EMBER = [1, 2];                                  // 처치할 때 받는 불씨

// ── 소원 ──
const WISH_EMBER = 6, WISH_STREAK = 7, WISH_STREAK_EMBER = 20;
const WISH_ACH = { id: 'ev_hlw_wish', name: '처녀귀신의 벗', descr: '할로윈 밤, 처녀귀신의 소원을 7일 연속으로 들어주었다.' };
const WISH_GHOSTS = [
  { who: '소복 입은 처녀귀신', say: '혼례 날 잃어버린 것들이 있어요. 찾아 주시면 은혜는 잊지 않겠습니다.' },
  { who: '우물가의 처녀귀신', say: '우물에 빠뜨린 물건을 다시 만들고 싶어요. 재료를 구해 주시겠어요?' },
  { who: '달밤의 처녀귀신', say: '보름달이 지기 전에 이 재료들이 필요해요. 도와주시겠어요?' },
  { who: '댕기머리 처녀귀신', say: '저승길 노잣돈 대신 이 재료들을 가져가고 싶어요.' },
  { who: '창가의 처녀귀신', say: '오래전 약속을 지키려는데, 재료가 모자랍니다…' },
];

// ── 가면 장비 (얼굴 부위). bonus 를 직접 적습니다. grade 는 내구도·수리비에 쓰입니다. ──
const MASKS = [
  { id: 'ev_m1', ev: 'halloween', name: '도깨비 가면', slot: 'mask', grade: 'B', desc: '뿔 달린 붉은 도깨비 탈. 쓰면 발걸음이 가벼워진다.', bonus: { stat: 'agi', val: 6 }, mats: { [EMBER]: 150, '나뭇가지': 4, '낡은 천조각': 3 } },
  { id: 'ev_m2', ev: 'halloween', name: '해태 가면', slot: 'mask', grade: 'B', desc: '액운을 쫓는 해태의 탈. 오염이 덜 스며든다.', bonus: { stat: 'taintRes', val: 14 }, mats: { [EMBER]: 150, '소금': 3, '짐승의 뼈': 3 } },
  { id: 'ev_m3', ev: 'halloween', name: '호랑이 가면', slot: 'mask', grade: 'A', desc: '산군(山君)의 기세가 서린 탈. 쓰면 힘이 솟는다.', bonus: { stat: 'str', val: 9 }, mats: { [EMBER]: 150, '짐승의 뼈': 5, '철광석 조각': 4, '붉은 석재 조각': 3 } },
  { id: 'ev_m4', ev: 'halloween', name: '구미호 가면', slot: 'mask', grade: 'A', desc: '꼬리 아홉 달린 여우의 탈. 운이 따라붙는다.', bonus: { stat: 'luck', val: 9 }, mats: { [EMBER]: 150, '새의 깃털': 4, '수정 파편': 2, '네잎 클로버': 1 } },
];
const MASK_SLOT = { ko: '가면', stat: 'luck', ko_stat: '행운', v: [0, 0, 0, 0], unit: '' };   // 부위 표(능력치는 가면마다 bonus 로 정함)

// ── 혼령 소문 (괴담 앱에 섞여 나옴). 사실로 밝혀지면 믿은 사람에게 bonus 지급 ──
const RUMOR_TPL = [
  { ev: 1, t: '{p}의 떠도는 혼불', mon: '떠도는 혼불', rank: 'C', bonus: { item: EMBER, qty: 3 }, body: '밤마다 {p} 위로 푸른 혼불이 줄지어 떠다닌다는 소문입니다.', hoax: '반딧불이 떼를 잘못 본 것이었습니다.' },
  { ev: 1, t: '{p}의 가면 행렬', mon: '가면 행렬의 선두', rank: 'B', bonus: { item: EMBER, qty: 4 }, body: '{p}에서 새벽에 탈을 쓴 무리가 말없이 행진한다는 소문이 돕니다.', hoax: '축제 연습을 하던 탈춤 동호회였습니다.' },
  { ev: 1, t: '{p}의 우물 속 소복', mon: '우물 속 소복 여인', rank: 'B', bonus: { item: EMBER, qty: 4 }, body: '{p}의 오래된 우물 안에서 소복 입은 여인이 올려다본다고 합니다.', hoax: '우물에 비친 달그림자였습니다.' },
  { ev: 1, t: '{p}의 빈 상여 소리', mon: '빈 상여꾼', rank: 'A', bonus: { item: EMBER, qty: 6 }, body: '{p}의 골목에서 상여 나가는 소리가 들리는데, 문을 열면 아무도 없다고 합니다.', hoax: '공사장 확성기가 잘못 켜진 것이었습니다.' },
  { ev: 1, t: '{p}의 여우불', mon: '구미호의 여우불', rank: 'A', bonus: { item: EMBER, qty: 6 }, body: '{p}의 산길에서 꼬리 아홉 달린 그림자가 불을 들고 걷는다는 소문입니다.', hoax: '등산객의 헤드랜턴이 흔들려 그렇게 보인 것이었습니다.' },
  { ev: 1, t: '{p}의 도깨비 씨름판', mon: '씨름 걸어오는 도깨비', rank: 'C', bonus: { item: EMBER, qty: 3 }, body: '{p}를 지나던 사람이 "한판 하자"는 소리에 붙잡혀 밤새 씨름했다고 합니다.', hoax: '술 취한 행인과 실랑이한 것이 부풀려진 이야기였습니다.' },
];

// ── DB 표 (_db.js 의 MIGRATIONS 에 합쳐집니다) ──
const SQL = [
  'CREATE TABLE IF NOT EXISTS ev_wish (user_id INTEGER NOT NULL, day TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))',
];

const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const kstHour = now => new Date(now + 9 * HOUR).getUTCHours();
const kstDay = now => new Date(now + 9 * HOUR).toISOString().slice(0, 10);
const isNight = now => { const h = kstHour(now); return NIGHT_FROM > NIGHT_TO ? (h >= NIGHT_FROM || h < NIGHT_TO) : (h >= NIGHT_FROM && h < NIGHT_TO); };
// 다음 밤이 시작되는 시각 (밤이 아닐 때만 의미 있음)
// 지금 밤이면 밤이 끝날 때까지, 아니면 다음 밤이 시작될 때까지 남은 시간(ms)
const nightLeft = now => { if (!isNight(now)) return nextNightStart(now) - now; const d = new Date(now + 9 * HOUR); d.setUTCHours(NIGHT_TO, 0, 0, 0); let t = d.getTime() - 9 * HOUR; if (t <= now) t += 24 * HOUR; return t - now; };
const nextNightStart = now => { const d = new Date(now + 9 * HOUR); d.setUTCHours(NIGHT_FROM, 0, 0, 0); let t = d.getTime() - 9 * HOUR; if (t <= now) t += 24 * HOUR; return t; };
// 문자열 → 0..2^32 (소원 재료를 하루 동안 고정하기 위한 간단한 해시)
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seeded(seed) { let x = seed || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

// a: _app.js 에서 넘겨주는 도구 모음
function install(a) {
  const { db, G, route, send, fail, limited, userById, grantGold, logAcquire, giveItem, achReset } = a;
  let cache = { at: 0, mode: 'auto' };

  const modeNow = () => cache.mode;
  async function refresh(force) {
    const now = Date.now();
    if (!force && now - cache.at < 5000) return;
    cache.at = now;
    try {
      const r = await db.get("SELECT value FROM settings WHERE key = 'ev_hlw'");
      cache.mode = r && (r.value === 'on' || r.value === 'off') ? r.value : 'auto';
    } catch (_) { /* 설정을 못 읽으면 직전 값 유지 */ }
  }
  // 지금 이벤트가 켜져 있는가 (동기. refresh() 가 5초마다 설정을 새로 읽어 옵니다)
  function on(now) {
    now = now || Date.now();
    const m = cache.mode;
    return m === 'on' ? true : m === 'off' ? false : (now >= START && now < END);
  }
  const brief = now => on(now) ? { name: '할로윈', night: isNight(now), ends: cache.mode === 'auto' ? END : null, ember: EMBER } : null;

  // ① 백귀야행: 헌터가 접속해 요청할 때 밀린 만큼이 아니라 '지금' 한 무리를 만듭니다 (자리를 비운 사이의 잡귀는 만들지 않음)
  const nextAt = new Map();
  let gateCleaned = false;
  async function tick(u, now) {
    if (!on(now)) return;
    if (!gateCleaned) {          // 예전에 적월문 안쪽에 잘못 나온 잡귀를 한 번 치웁니다
      gateCleaned = true;
      const gids = G.REGIONS.filter(r => !G.SPAWN_REGIONS.includes(r)).map(r => r.id);
      if (gids.length) await db.run(`DELETE FROM monsters WHERE owner_id IS NOT NULL AND name IN (${GHOSTS.map(() => '?').join(',')}) AND region IN (${gids.map(() => '?').join(',')})`, GHOSTS.concat(gids)).catch(() => { gateCleaned = false; });
    }
    const c = nextAt.get(u.id);
    if (c !== undefined && now < c) return;
    if (!isNight(now)) { nextAt.set(u.id, Math.min(now + 5 * MIN, nextNightStart(now))); return; }
    const row = await db.get("SELECT next_at FROM user_spawn WHERE user_id = ? AND tier = 'evg'", [u.id]);
    if (!row) await db.run("INSERT OR IGNORE INTO user_spawn (user_id, tier, next_at) VALUES (?, 'evg', 0)", [u.id]);
    const from = row ? Number(row.next_at) : 0;
    if (from > now) { nextAt.set(u.id, from); return; }
    const next = now + rnd(GHOST_GAP[0], GHOST_GAP[1]) * MIN;
    const claim = await db.run("UPDATE user_spawn SET next_at = ? WHERE user_id = ? AND tier = 'evg' AND next_at = ?", [next, u.id, from]);
    nextAt.set(u.id, next);
    if (claim.changes !== 1) return;
    const ph = GHOSTS.map(() => '?').join(',');
    const live = await db.get(`SELECT COUNT(*) AS c FROM monsters WHERE owner_id = ? AND name IN (${ph}) AND spawned_at > ? AND id NOT IN (SELECT monster_id FROM kills WHERE user_id = ?)`,
      [u.id].concat(GHOSTS, [now - G.ACTIVE_MS, u.id]));
    const room = GHOST_CAP - Number(live.c);
    if (room <= 0) return;
    const n = Math.min(room, rnd(GHOST_BATCH[0], GHOST_BATCH[1]));
    const hi = Math.max(0, RANKS.indexOf(u.rank));
    const inSpawn = u.region && G.SPAWN_REGIONS.some(r => r.id === u.region);      // 적월문(게이트 구역) 안쪽에서는 몬스터가 나오지 않으므로 제외
    const here = inSpawn ? u.region : G.SPAWN_REGIONS[rnd(0, G.SPAWN_REGIONS.length - 1)].id;      // 백귀야행은 헌터가 있는 곳으로 몰려옵니다
    const list = [];
    for (let i = 0; i < n; i++) {
      const rank = RANKS[Math.max(0, Math.min(4, hi - rnd(1, 2)))];      // 내 등급보다 1~2단계 아래 (최대 B급)
      list.push(['INSERT INTO monsters (region, name, rank, spawned_at, owner_id) VALUES (?, ?, ?, ?, ?)',
        [here, GHOSTS[rnd(0, GHOSTS.length - 1)], rank, now - i, u.id]]);
    }
    await db.batch(list);
  }
  // 잡귀를 처치했을 때 불씨 지급. 지급한 수를 돌려줍니다 (0 이면 잡귀가 아님)
  async function onKill(cur, m, now) {
    if (!m || m.owner_id == null || !GHOST_SET.has(m.name)) return 0;
    const n = rnd(GHOST_EMBER[0], GHOST_EMBER[1]);
    await giveItem(cur.id, EMBER, n);
    await logAcquire(cur.id, 'item', EMBER, n, '백귀야행', now);
    return n;
  }
  // 이벤트가 꺼진 뒤 남은 잡귀 정리 (10분에 한 번)
  let lastClean = 0;
  async function cleanup(force) {
    const now = Date.now();
    if (on(now) || (!force && now - lastClean < 10 * MIN)) return;
    lastClean = now;
    const ph = GHOSTS.map(() => '?').join(',');
    const has = await db.get(`SELECT 1 AS x FROM monsters WHERE name IN (${ph}) LIMIT 1`, GHOSTS);
    if (!has) return;
    await db.batch([
      [`DELETE FROM battles WHERE monster_id IN (SELECT id FROM monsters WHERE owner_id IS NOT NULL AND name IN (${ph}))`, GHOSTS],
      [`DELETE FROM kills WHERE monster_id IN (SELECT id FROM monsters WHERE owner_id IS NOT NULL AND name IN (${ph}))`, GHOSTS],
      [`DELETE FROM fail_cd WHERE monster_id IN (SELECT id FROM monsters WHERE owner_id IS NOT NULL AND name IN (${ph}))`, GHOSTS],
      [`DELETE FROM monsters WHERE owner_id IS NOT NULL AND name IN (${ph})`, GHOSTS],
      ["DELETE FROM user_spawn WHERE tier = 'evg'", []],
    ]);
  }

  // ② 소원: 오늘의 귀신과 재료 (사용자·날짜가 같으면 항상 같은 결과)
  function wishOf(uid, day) {
    const r = seeded(hash(uid + ':' + day + ':hlw'));
    const ghost = WISH_GHOSTS[Math.floor(r() * WISH_GHOSTS.length)];
    const pool = G.MATERIALS.filter(m => m.w >= 6).map(m => m.name);
    const items = [];
    while (items.length < 3) { const nm = pool[Math.floor(r() * pool.length)]; if (!items.some(x => x.item === nm)) items.push({ item: nm, qty: 1 + Math.floor(r() * 2) }); }
    return { who: ghost.who, say: ghost.say, items };
  }
  async function streakOf(uid, today) {
    const rows = await db.all('SELECT day FROM ev_wish WHERE user_id = ? AND done = 1 ORDER BY day DESC LIMIT 30', [uid]);
    const days = new Set(rows.map(r => r.day));
    const dt = s => Date.parse(s + 'T00:00:00Z'), back = s => new Date(dt(s) - 24 * HOUR).toISOString().slice(0, 10);
    let d = days.has(today) ? today : back(today), n = 0;
    while (days.has(d)) { n++; d = back(d); }
    return n;
  }
  route('GET', '/api/event', async (req, res, ctx) => {
    await refresh();
    const now = Date.now();
    if (!on(now)) return send(res, 200, { on: false });
    const u = ctx.user, day = kstDay(now), w = wishOf(u.id, day);
    const inv = new Map((await db.all('SELECT item, qty FROM inventory WHERE user_id = ? AND qty > 0', [u.id])).map(r => [r.item, Number(r.qty)]));
    const done = await db.get('SELECT done FROM ev_wish WHERE user_id = ? AND day = ?', [u.id, day]);
    const streak = await streakOf(u.id, day);
    send(res, 200, {
      on: true, night: isNight(now), nightLeft: nightLeft(now), nightText: String(NIGHT_FROM) + '시 ~ 다음날 ' + String(NIGHT_TO).padStart(2, '0') + '시', ends: cache.mode === 'auto' ? END : null,
      ember: inv.get(EMBER) || 0, emberName: EMBER,
      masks: MASKS.map(m => ({ id: m.id, name: m.name, grade: m.grade, desc: m.desc, fx: ({ agi: '민첩', str: '근력', luck: '행운', taintRes: '오염도 증가 감소' })[m.bonus.stat] + ' +' + m.bonus.val + (m.bonus.stat === 'taintRes' ? '%' : ''),
        mats: Object.keys(m.mats).map(k => ({ item: k, qty: m.mats[k], have: inv.get(k) || 0 })) })),
      wish: { who: w.who, say: w.say, items: w.items.map(x => ({ item: x.item, qty: x.qty, have: inv.get(x.item) || 0 })), done: !!(done && done.done), streak, need: WISH_STREAK, reward: { ember: WISH_EMBER, streakEmber: WISH_STREAK_EMBER, achName: WISH_ACH.name } },
      resetIn: 24 * HOUR - ((now + 9 * HOUR) % (24 * HOUR)),
    });
  });
  route('POST', '/api/event/wish', async (req, res, ctx) => {
    if (await limited('evw:' + ctx.user.id, 20, 60000)) return fail(res, 429, 'rate_limited');
    await refresh();
    const now = Date.now();
    if (!on(now)) return fail(res, 403, 'event_off');
    const u = await userById(ctx.user.id), day = kstDay(now), w = wishOf(u.id, day);
    await db.run('INSERT OR IGNORE INTO ev_wish (user_id, day, done, at) VALUES (?, ?, 0, 0)', [u.id, day]);
    const dn = await db.get('SELECT done FROM ev_wish WHERE user_id = ? AND day = ?', [u.id, day]);
    if (dn && dn.done) return fail(res, 409, 'already_done');
    const taken = [];
    const restore = async () => { for (const t of taken) await giveItem(u.id, t[0], t[1]); };
    try {
      for (const x of w.items) {
        const d = await db.run('UPDATE inventory SET qty = qty - ? WHERE user_id = ? AND item = ? AND qty >= ?', [x.qty, u.id, x.item, x.qty]);
        if (d.changes !== 1) { await restore(); return fail(res, 400, 'no_mats', { item: x.item }); }
        taken.push([x.item, x.qty]);
      }
      const c = await db.run('UPDATE ev_wish SET done = 1, at = ? WHERE user_id = ? AND day = ? AND done = 0', [now, u.id, day]);
      if (c.changes !== 1) { await restore(); return fail(res, 409, 'already_done'); }
    } catch (err) { await restore(); throw err; }
    await db.run('DELETE FROM inventory WHERE user_id = ? AND qty <= 0', [u.id]);
    const ri = Math.max(0, RANKS.indexOf(u.rank));
    const gold = 150 + ri * 60;
    const streak = await streakOf(u.id, day);
    let ember = WISH_EMBER, ach = false;
    if (streak === WISH_STREAK) {
      ember += WISH_STREAK_EMBER;
      await db.run('INSERT OR IGNORE INTO achievements (id, name, descr, kind, val, at) VALUES (?, ?, ?, ?, ?, ?)', [WISH_ACH.id, WISH_ACH.name, WISH_ACH.descr, 'manual', '', now]);
      await db.run('UPDATE achievements SET descr = ? WHERE id = ?', [WISH_ACH.descr, WISH_ACH.id]);       // 예전 문구로 만들어진 칸이 있으면 새 조건 문구로
      await db.run('INSERT OR IGNORE INTO ach_grants (user_id, ach_id, at) VALUES (?, ?, ?)', [u.id, WISH_ACH.id, now]);
      achReset();
      ach = true;
    }
    await grantGold(u.id, gold);
    await giveItem(u.id, EMBER, ember);
    await logAcquire(u.id, 'gold', '골드', gold, '처녀귀신의 소원', now);
    await logAcquire(u.id, 'item', EMBER, ember, '처녀귀신의 소원', now);
    send(res, 200, { ok: true, gold, ember, streak, ach: ach ? WISH_ACH.name : '' });
  });

  // 관리자: 이벤트 켜기/끄기
  route('GET', '/api/admin/event', async (req, res) => {
    await refresh(true);
    const now = Date.now();
    send(res, 200, { mode: cache.mode, on: on(now), start: START, end: END, ghosts: GHOSTS.length, masks: MASKS.map(m => m.name) });
  }, { auth: false, admin: true });
  route('POST', '/api/admin/event', async (req, res, ctx) => {
    const mode = ['on', 'off', 'auto'].includes(ctx.body.mode) ? ctx.body.mode : null;
    if (!mode) return fail(res, 400, 'bad_mode');
    if (mode === 'auto') await db.run("DELETE FROM settings WHERE key = 'ev_hlw'");
    else await db.run("INSERT INTO settings (key, value) VALUES ('ev_hlw', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [mode]);
    cache = { at: Date.now(), mode };
    nextAt.clear();
    if (!on(Date.now())) await cleanup(true);
    send(res, 200, { mode, on: on(Date.now()) });
  }, { auth: false, admin: true });

  return { on, refresh, brief, tick, onKill, cleanup, mode: modeNow, EMBER, GHOST_SET };
}

module.exports = { install, MASKS, MASK_SLOT, RUMOR_TPL, SQL, EMBER, GHOSTS, START, END };
