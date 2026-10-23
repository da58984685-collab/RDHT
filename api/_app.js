'use strict';
// 적월협인 — API 본체. Vercel 함수(api/index.js)와 로컬 개발 서버(dev.js)가 함께 사용합니다.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const db = require('./_db');
const G = require('./_game');
const SYSMSG = require('./_sysmsg');
const EVT = require('./_event');      // [EVENT:HALLOWEEN] 할로윈 이벤트 (api/_event.js)
const B = require('./_board');

const scrypt = promisify(crypto.scrypt);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ON_VERCEL = !!process.env.VERCEL;
const COOKIE_SECURE = ON_VERCEL || process.env.COOKIE_SECURE === '1';
const TRUST_PROXY = ON_VERCEL || process.env.TRUST_PROXY === '1';
const SESSION_MS = 30 * 24 * G.HOUR;

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const cp = s => Array.from(s).length;
const hashPw = async (pw, salt) => (await scrypt(pw, salt, 64)).toString('hex');

function send(res, status, obj, headers) {
  const body = JSON.stringify(obj);
  // 조회(GET) 응답에 ETag 를 붙입니다. 내용이 그대로면 브라우저가 보낸 If-None-Match 와 같아서 본문 없이 304 로 답합니다 (전송량 절약).
  // 헌터마다 다른 내용이므로 'private, no-cache'(저장은 하되 매번 확인)로 두고, 관리자 창 응답은 그대로 no-store 입니다.
  const rq = res.req;
  if (status === 200 && rq && rq.method === 'GET' && !headers && body.length >= 200 && !String(rq.url || '').startsWith('/api/admin')) {
    const et = 'W/"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"';
    if (rq.headers['if-none-match'] === et) { res.writeHead(304, { ETag: et, 'Cache-Control': 'private, no-cache' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-cache', ETag: et, 'Content-Length': Buffer.byteLength(body) });
    return res.end(body);
  }
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  }, headers || {}));
  res.end(body);
}
const fail = (res, status, error, extra) => send(res, status, Object.assign({ error }, extra || {}));

async function readJson(req, limit) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.toLowerCase().startsWith('application/json')) throw { status: 415, error: 'json_required' };
  let raw = req.body;                         // Vercel 이 미리 읽어 둔 경우
  if (raw === undefined) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > limit) throw { status: 413, error: 'too_large' }; chunks.push(c); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') {
    if (raw.length > limit) throw { status: 413, error: 'too_large' };
    try { raw = JSON.parse(raw || '{}'); } catch (_) { throw { status: 400, error: 'bad_json' }; }
  } else if (JSON.stringify(raw || {}).length > limit) throw { status: 413, error: 'too_large' };
  return raw && typeof raw === 'object' ? raw : {};
}

function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (_) {} }
  });
  return out;
}
function clientIp(req) {
  if (TRUST_PROXY) {
    const f = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return (req.socket && req.socket.remoteAddress) || '?';
}

// 횟수 제한 — 여러 함수가 함께 쓸 수 있도록 데이터베이스에 저장합니다. (고정 시간 창)
async function limited(key, max, windowMs) {
  const now = Date.now();
  await db.run(
    `INSERT INTO rate_limits (key, start, n) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       start = CASE WHEN ? - start >= ? THEN ? ELSE start END,
       n     = CASE WHEN ? - start >= ? THEN 1 ELSE n + 1 END`,
    [key, now, now, windowMs, now, now, windowMs]);
  const r = await db.get('SELECT n FROM rate_limits WHERE key = ?', [key]);
  return !!r && r.n > max;
}

// ───────────── 몬스터 출몰 / S급 결과 (요청 때마다, 그리고 Cron 이 따라잡기 처리) ─────────────
// S급이 나올 나라 고르기: 지금 S급이 출몰 중인 나라는 피해서(모두 차 있으면 전체에서) 무작위로 고릅니다.
// → 같은 나라에만 몰려서 나오는 일이 없도록 합니다.
async function liveSCountries(now) {
  const rows = await db.all(`SELECT region FROM monsters WHERE rank = 'SS' AND owner_id IS NULL AND corrupt_of IS NULL AND spawned_at > ?
    AND id NOT IN (SELECT monster_id FROM s_close)`, [now - G.ACTIVE_MS_S]);
  return new Set(rows.map(r => r.region));
}
function pickSCountry(taken) {
  const free = G.SPAWN_COUNTRIES.filter(c => !taken.has(c.id));
  const pool = free.length ? free : G.SPAWN_COUNTRIES;
  const id = pool[G.rnd(0, pool.length - 1)].id;
  taken.add(id);
  return id;
}
async function tickSpawns() {
  const now = Date.now();
  const rows = await db.all('SELECT tier, next_at FROM spawn_state');
  const have = new Map(rows.map(r => [r.tier, r.next_at]));
  for (const t of G.TIERS) {
    if (t.k !== 'top') continue;                      // 서버 전체 공통 몬스터는 S급(top)뿐
    let next = have.has(t.k) ? have.get(t.k) : null;
    if (next === null) {
      await db.run('INSERT OR IGNORE INTO spawn_state (tier, next_at) VALUES (?, ?)', [t.k, now]);
      next = now;
    }
    if (next > now) continue;
    const from = next;
    if (next < now - 24 * G.HOUR) next = now - 24 * G.HOUR;      // 오래 비어 있었다면 최근 24시간만 반영
    const list = [];
    const taken = await liveSCountries(now);
    let guard = 0;
    while (next <= now && guard++ < 400) {
      const rank = t.ranks[G.rnd(0, t.ranks.length - 1)];
      const names = G.MON[rank];
      list.push(['INSERT INTO monsters (region, name, rank, spawned_at) VALUES (?, ?, ?, ?)',
        [pickSCountry(taken), names[G.rnd(0, names.length - 1)], rank, next]]);
      next += t.gap();
    }
    // 동시에 다른 요청이 같은 시간대를 처리하지 않도록, 다음 시각을 먼저 '차지'한 쪽만 몬스터를 만듭니다.
    const claim = await db.run('UPDATE spawn_state SET next_at = ? WHERE tier = ? AND next_at = ?', [next, t.k, from]);
    if (claim.changes === 1 && list.length) await db.batch(list);
  }
}

// 오염 몬스터 두 종류 (30분에 한 번만 굴리므로 DB 를 거의 쓰지 않습니다)
//  · 오염 사냥꾼: 오염 2단계(60%~) 6%, 3단계(80%~) 12% — 강한 공격력으로 10라운드 이상 이어지는 전투
//  · 혈월의 잔영: 위험 구간(80~99%)에서만 2% — 보상이 큰 한정 몬스터
async function taintMonsters(uid, now) {
  const u = await db.get('SELECT stats, region, rank FROM users WHERE id = ?', [uid]);
  if (!u) return null;
  const t = taintOf(u), stg = G.taintStage(t);
  if (stg < 2 || t >= 100) return null;
  const wantH = G.chance01() < G.HUNTER_CHANCE[stg], wantR = t >= 80 && G.chance01() < G.RARE_CHANCE;
  if (!wantH && !wantR) return null;
  const live = await db.all('SELECT name FROM monsters WHERE owner_id = ? AND name IN (?, ?) AND spawned_at > ?', [uid, '오염 사냥꾼', '혈월의 잔영', now - G.ACTIVE_MS]);
  const have = new Set(live.map(x => x.name));
  const rk = ['F', 'E', 'D', 'C', 'B', 'A'].includes(u.rank) ? u.rank : 'A';
  const reg = () => (G.SPAWN_REGIONS.some(r => r.id === u.region) ? u.region : G.SPAWN_REGIONS[G.rnd(0, G.SPAWN_REGIONS.length - 1)].id);      // 적월문 안은 안전 지역이므로 바깥 지역에 나타남
  const mk = name => ['INSERT INTO monsters (region, name, rank, spawned_at, owner_id) VALUES (?, ?, ?, ?, ?)', [reg(), name, rk, now, uid]];
  const a = wantH && !have.has('오염 사냥꾼') ? mk('오염 사냥꾼') : null, b = wantR && !have.has('혈월의 잔영') ? mk('혈월의 잔영') : null;
  return a ? { a, b } : b ? { a: b, b: null } : null;
}

// F~A급 몬스터는 헌터마다 따로 출몰합니다. 그 헌터가 접속해 요청할 때 밀린 만큼 따라잡아 만듭니다.
const spawnNext = new Map();       // 헌터별 '다음 출몰 시각' (이 시각 전에는 DB 를 읽지 않음). 다른 인스턴스가 앞당길 일이 없어 안전합니다.
async function tickPersonal(uid, now) {
  if (EV.nightOnly(now)) { if (PERF) spawnNext.set(uid, now + 60000); return; }      // [EVENT:HALLOWEEN] 백귀야행 중에는 일반 몬스터가 새로 출몰하지 않음 (잡귀만)
  if (PERF) { const c = spawnNext.get(uid); if (c !== undefined && now < c) return; }
  let minNext = Infinity, certain = true;
  const myRegions = G.SPAWN_REGIONS;      // F~A급은 헌터가 어디 있든 모든 나라의 모든 세부 지역에서 같은 확률로 출몰
  const rows = await db.all('SELECT tier, next_at FROM user_spawn WHERE user_id = ?', [uid]);
  const have = new Map(rows.map(r => [r.tier, r.next_at]));
  for (const t of G.TIERS) {
    if (t.k === 'top') continue;
    let next = have.has(t.k) ? have.get(t.k) : null;
    if (next === null) {
      // 처음 접속한 헌터: F·E·D급은 바로, C급 이상은 한 번의 간격이 지난 뒤부터 출몰
      next = (t.k === 'f' || t.k === 'low') ? now : now + t.gap();
      await db.run('INSERT OR IGNORE INTO user_spawn (user_id, tier, next_at) VALUES (?, ?, ?)', [uid, t.k, next]);
    }
    if (next > now) { minNext = Math.min(minNext, next); continue; }
    const from = next;
    if (next < now - G.ACTIVE_MS) next = now - G.ACTIVE_MS;      // 자리를 비운 동안 지나간 몬스터는 만들지 않음
    const list = [];
    let guard = 0;
    while (next <= now && guard++ < 60) {
      const rank = t.ranks[G.rnd(0, t.ranks.length - 1)];
      const names = G.MON[rank];
      list.push(['INSERT INTO monsters (region, name, rank, spawned_at, owner_id) VALUES (?, ?, ?, ?, ?)',
        [myRegions[G.rnd(0, myRegions.length - 1)].id, names[G.rnd(0, names.length - 1)], rank, next, uid]]);
      next += t.gap();
    }
    const claim = await db.run('UPDATE user_spawn SET next_at = ? WHERE user_id = ? AND tier = ? AND next_at = ?', [next, uid, t.k, from]);
    if (claim.changes === 1) minNext = Math.min(minNext, next); else certain = false;
    if (claim.changes === 1 && t.k === 'mid' && list.length) { const ex = await taintMonsters(uid, now); if (ex) list.push(ex.a); if (ex && ex.b) list.push(ex.b); }
    if (claim.changes === 1 && list.length) await db.batch(list);
  }
  if (PERF && certain && minNext !== Infinity) spawnNext.set(uid, minNext);
}

async function grantExp(userId, gain) {
  for (let i = 0; i < 6; i++) {
    const u = await db.get('SELECT lv, exp FROM users WHERE id = ?', [userId]);
    if (!u) return null;
    const r = G.addExp(u.lv, u.exp, gain);
    const w = await db.run('UPDATE users SET lv = ?, exp = ? WHERE id = ? AND lv = ? AND exp = ?', [r.lv, r.exp, userId, u.lv, u.exp]);
    if (w.changes === 1) {
      if (r.lv > u.lv) { await grantFame(userId, (r.lv - u.lv) * G.FAME_PER_LV); await grantStatPoints(userId, r.lv, r.lv - u.lv); }
      return r;
    }
  }
  throw new Error('exp_conflict');
}

// 스탯포인트: 전투력 레벨이 1 오를 때마다 1포인트 (stats JSON 의 sp). 기존 헌터는 처음 확인할 때 (레벨 - 1)로 채워집니다.
const spOf = (st, lv) => (Number.isFinite(Number(st.sp)) && st.sp !== undefined && st.sp !== null ? Math.max(0, Math.floor(Number(st.sp))) : Math.max(0, lv - 1));
const statsOf = u => { const st = JSON.parse(u.stats); st.sp = spOf(st, u.lv); return st; };
async function grantStatPoints(userId, newLv, gained) {
  for (let i = 0; i < 6; i++) {
    const u = await db.get('SELECT stats FROM users WHERE id = ?', [userId]);
    if (!u) return;
    const st = JSON.parse(u.stats);
    st.sp = (st.sp === undefined || st.sp === null) ? Math.max(0, newLv - 1) : spOf(st, newLv) + gained;
    const w = await db.run('UPDATE users SET stats = ? WHERE id = ? AND stats = ?', [JSON.stringify(st), userId, u.stats]);
    if (w.changes === 1) return;
  }
  throw new Error('sp_conflict');
}

// 명성은 레벨·등급이 오를 때만 늘어납니다 (stats JSON 의 fame, 동시 요청에도 안전하게 비교 후 갱신)
async function grantFame(userId, n) {
  if (!(n > 0)) return null;
  for (let i = 0; i < 6; i++) {
    const u = await db.get('SELECT stats FROM users WHERE id = ?', [userId]);
    if (!u) return null;
    const st = JSON.parse(u.stats);
    const cf = Number(st.fame) || 0;
    st.fame = Math.max(cf, Math.min(G.FAME_MAX, cf + n));   // 명성 최대 1000
    const w = await db.run('UPDATE users SET stats = ? WHERE id = ? AND stats = ?', [JSON.stringify(st), userId, u.stats]);
    if (w.changes === 1) return st.fame;
  }
  throw new Error('fame_conflict');
}

async function grantGold(userId, n) {
  if (n > 0) await db.run('UPDATE users SET gold = gold + ? WHERE id = ?', [n, userId]);
}

// 토벌에 성공할 때마다 오염도가 쌓입니다 (최대 100%, 동시 요청에도 안전하게 비교 후 갱신)
async function grantTaint(userId, n) {
  if (!(n > 0)) return null;
  for (let i = 0; i < 6; i++) {
    const u = await db.get('SELECT stats FROM users WHERE id = ?', [userId]);
    if (!u) return null;
    const st = JSON.parse(u.stats);
    st.taint = Math.min(100, Math.round(((Number(st.taint) || 0) + n) * 10) / 10);
    const w = await db.run('UPDATE users SET stats = ? WHERE id = ? AND stats = ?', [JSON.stringify(st), userId, u.stats]);
    if (w.changes === 1) { if (st.taint >= 100) await corruptCheck(userId); return st.taint; }
  }
  throw new Error('taint_conflict');
}

// ── 체력 ──
// 5분 빈사 상태가 끝났다면 체력을 10으로 되돌립니다 (빈사 상태일 때만 회복됩니다).
async function settleDying(userId, now) {
  for (let i = 0; i < 4; i++) {
    const u = await db.get('SELECT stats, dying_until FROM users WHERE id = ?', [userId]);
    if (!u || !(u.dying_until > 0) || now < u.dying_until) return;
    const st = JSON.parse(u.stats);
    st.hp = G.HP_REVIVE;
    const w = await db.run('UPDATE users SET stats = ?, dying_until = 0 WHERE id = ? AND stats = ? AND dying_until = ?', [JSON.stringify(st), userId, u.stats, u.dying_until]);
    if (w.changes === 1) return;
  }
}
// 토벌 실패: 민첩에 비례한 확률로 체력 차감을 막고, 아니면 등급에 따라 체력이 줄어듭니다 (5 아래로는 내려가지 않음).
async function applyHpLoss(userId, rank, now, eb) {
  for (let i = 0; i < 6; i++) {
    const u = await db.get('SELECT stats, dying_until FROM users WHERE id = ?', [userId]);
    if (!u) return { loss: 0, prevented: false, hp: 0, dying: false, until: 0 };
    const st = JSON.parse(u.stats), hp = Number(st.hp) || 0;
    if (G.chance01() < G.guardChance((Number(st.agi) || 0) + (eb ? eb.agi : 0))) return { loss: 0, prevented: true, hp, dying: u.dying_until > now, until: u.dying_until };
    const nh = Math.max(G.HP_MIN, hp - Math.round(G.hpLoss(rank) * (1 - (eb ? eb.hpGuard : 0) / 100))), loss = Math.max(0, hp - nh);
    st.hp = nh;
    const dying = nh <= G.HP_MIN, until = dying ? (u.dying_until > now ? u.dying_until : now + G.HP_DYING_MS) : u.dying_until;
    const w = await db.run('UPDATE users SET stats = ?, dying_until = ? WHERE id = ? AND stats = ? AND dying_until = ?', [JSON.stringify(st), until, userId, u.stats, u.dying_until]);
    if (w.changes === 1) return { loss, prevented: false, hp: nh, dying, until: dying ? until : 0 };
  }
  throw new Error('hp_conflict');
}
// S급 토벌 실패가 공개될 때, 도전에 참여한 헌터에게도 체력 손실이 적용됩니다 (한 번만).
async function hpForAttempts(ids, now) {
  for (const id of ids) {
    const a = await db.get('SELECT user_id FROM s_attempts WHERE id = ? AND hp_done = 0', [id]);
    if (!a) continue;
    const claim = await db.run('UPDATE s_attempts SET hp_done = 1 WHERE id = ? AND hp_done = 0', [id]);
    if (claim.changes !== 1) continue;
    const r = await applyHpLoss(a.user_id, 'SS', now);
    await db.run('UPDATE s_attempts SET hp_loss = ? WHERE id = ?', [r.prevented ? -1 : r.loss, id]);
  }
}

// S급 토벌 성공: 관리자가 결정하거나, 참여 100명 / 도전 300회(중복 포함)에 이르면 자동으로 성공합니다.
// 보상은 '도전에 참여한 헌터'에게만 정해지며, 그 헌터가 성공 팝업에서 확인을 누를 때 지급됩니다.
async function declareSuccess(m, how) {
  const now = Date.now();
  const w = await db.run('INSERT OR IGNORE INTO s_close (monster_id, ok, how, at) VALUES (?, 1, ?, ?)', [m.id, how, now]);
  if (w.changes !== 1) return false;
  const users = await db.all('SELECT DISTINCT user_id FROM s_attempts WHERE monster_id = ? AND resolved IN (0, 2)', [m.id]);
  const list = [];
  for (const x of users) {
    const exp = G.KILL_EXP.SS;
    list.push(['INSERT OR IGNORE INTO s_rewards (user_id, monster_id, exp, gold, taint) VALUES (?, ?, ?, ?, ?)', [x.user_id, m.id, exp, G.rollGold('SS'), G.rollTaint('SS')]]);
    list.push(['INSERT OR IGNORE INTO kills (user_id, monster_id, at) VALUES (?, ?, ?)', [x.user_id, m.id, now]]);
    list.push(["UPDATE hunt_log SET result = 'success', exp_gain = ? WHERE user_id = ? AND monster_id = ? AND result = 'pending'", [exp, x.user_id, m.id]]);
  }
  list.push(['UPDATE s_attempts SET resolved = 1, success = 1, notified = 1 WHERE monster_id = ? AND resolved IN (0, 2)', [m.id]]);
  await db.batch(list);
  return true;
}

// 관리자가 실패(도주)로 결정: 대기 중인 도전은 실패로 공개되고, 몬스터는 서버 화면에서 사라집니다.
async function declareFail(m, how) {
  const w = await db.run('INSERT OR IGNORE INTO s_close (monster_id, ok, how, at) VALUES (?, 0, ?, ?)', [m.id, how, Date.now()]);
  if (w.changes !== 1) return false;
  const ids = (await db.all('SELECT id FROM s_attempts WHERE monster_id = ? AND resolved = 0', [m.id])).map(r => r.id);
  await db.batch([
    ["UPDATE hunt_log SET result = 'fail' WHERE monster_id = ? AND result = 'pending'", [m.id]],
    ['UPDATE s_attempts SET resolved = 1, success = 0 WHERE monster_id = ? AND resolved = 0', [m.id]],
  ]);
  await hpForAttempts(ids, Date.now());
  return true;
}

// 결정되지 않은 도전은 공개 시각(기본 24시간)이 되면 실패(도주)로 공개됩니다.
async function resolveDue() {
  const now = Date.now();
  const due = await db.all('SELECT id, user_id, monster_id, created_at, resolve_at, resolved, success, exp_gain, level_up, notified, hp_loss, hp_done, taint_gain, gold_gain FROM s_attempts WHERE resolved = 0 AND resolve_at <= ? ORDER BY resolve_at LIMIT 100', [now]);
  for (const a of due) {
    const claim = await db.run('UPDATE s_attempts SET resolved = 2 WHERE id = ? AND resolved = 0', [a.id]);   // 2 = 처리 중
    if (claim.changes !== 1) continue;
    const cl = await db.get('SELECT ok FROM s_close WHERE monster_id = ?', [a.monster_id]);
    if (cl && cl.ok === 1) { await db.run('UPDATE s_attempts SET resolved = 1, success = 1, notified = 1 WHERE id = ?', [a.id]); continue; }
    await db.run('UPDATE s_attempts SET resolved = 1, success = 0 WHERE id = ?', [a.id]);
    await db.run("UPDATE hunt_log SET result = 'fail' WHERE user_id = ? AND monster_id = ? AND result = 'pending'", [a.user_id, a.monster_id]);
    await hpForAttempts([a.id], now);
  }
}

// ── 오염도 100: 1시간 활동 불가 + 같은 이름·등급의 몬스터 출몰 (1시간, 누구나 반드시 토벌 성공) ──
const CORRUPT_MS = G.HOUR;                 // 오염 폭주로 활동하지 못하는 시간
const CORRUPT_MON_MS = 30 * G.MIN;         // 오염된 유저 몬스터가 출몰 알림에 남아 있는 시간
// 폭주 잠금: 잠금 시간이 남아 있어도 오염도가 100 아래로 내려가면 풀립니다.
const taintOf = row => { try { return Number(JSON.parse(row.stats).taint) || 0; } catch (_) { return 0; } };
const stageOf = row => G.taintStage(taintOf(row));      // 오염 단계 0~3 (30·60·80%)
const corruptLock = (row, now) => row.corrupt_until > now && (Number(JSON.parse(row.stats).taint) || 0) >= 100;
// row 를 넘기면(방금 읽은 유저 행) 다시 읽지 않습니다. 값을 바꿨으면 true 를 돌려줍니다.
async function corruptCheck(userId, row) {
  const u = row || await db.get('SELECT id, hunter_name, rank, stats, corrupt_flag, corrupt_until FROM users WHERE id = ?', [userId]);
  if (!u) return false;
  const t = Number(JSON.parse(u.stats).taint) || 0;
  if (t < 100) { if (u.corrupt_flag || u.corrupt_until > 0) { await db.run('UPDATE users SET corrupt_flag = 0, corrupt_until = 0 WHERE id = ? AND (corrupt_flag = 1 OR corrupt_until > 0)', [u.id]); return true; } return false; }
  if (u.corrupt_flag) return false;
  const now = Date.now();
  const claim = await db.run('UPDATE users SET corrupt_flag = 1, corrupt_until = ? WHERE id = ? AND corrupt_flag = 0', [now + CORRUPT_MS, u.id]);
  if (claim.changes !== 1) return true;
  // 이미 이 헌터의 오염 몬스터가 출몰 중이면 새로 만들지 않고, 그 몬스터의 출몰 시간만 지금부터 다시 시작합니다.
  const live = await db.get('SELECT id FROM monsters WHERE corrupt_of = ? AND spawned_at > ? ORDER BY id DESC LIMIT 1', [u.id, now - CORRUPT_MON_MS]);
  if (live) {
    await db.run('UPDATE monsters SET spawned_at = ?, name = ?, rank = ? WHERE id = ?', [now, u.hunter_name, u.rank, live.id]);
    await db.run('UPDATE monsters SET spawned_at = 0 WHERE corrupt_of = ? AND id <> ? AND spawned_at > 0', [u.id, live.id]);     // 혹시 겹쳐 있던 것은 정리
    return true;
  }
  const region = G.SPAWN_REGIONS[Math.floor(Math.random() * G.SPAWN_REGIONS.length)].id;
  await db.run('INSERT INTO monsters (region, name, rank, spawned_at, corrupt_of) VALUES (?, ?, ?, ?, ?)', [region, u.hunter_name, u.rank, now, u.id]);
  return true;
}
let lastCorrupt = 0;
async function corruptTick() {
  const now = Date.now();
  if (now - lastCorrupt < 15000) return;
  lastCorrupt = now;
  const up = await db.all("SELECT id FROM users WHERE (corrupt_flag = 0 AND json_extract(stats, '$.taint') >= 100) OR (corrupt_flag = 1 AND json_extract(stats, '$.taint') < 100) LIMIT 50");
  for (const x of up) await corruptCheck(x.id);
}

// 출현 시간(F급 5분, S급 24시간, 그 외 30분)이 지나도록 아무도 토벌하지 못한 몬스터는 서버에서 삭제합니다.
// (S급 도전 결과가 아직 처리·확인되지 않은 몬스터는 결과 공개 전까지 보존)
let lastPurge = 0;
async function purgeMonsters(force) {
  const now = Date.now();
  if (!force && now - lastPurge < 30000) return;
  lastPurge = now;
  // 사라지는 S급(도주)은 관리자 통계를 위해 기록을 남깁니다
  await db.run(`INSERT OR IGNORE INTO s_log (monster_id, name, region, spawned_at, status, ended_at)
    SELECT id, name, region, spawned_at, 'fled', ? FROM monsters WHERE rank = 'SS' AND corrupt_of IS NULL AND spawned_at < ?
    AND NOT EXISTS (SELECT 1 FROM kills k WHERE k.monster_id = monsters.id)
    AND NOT EXISTS (SELECT 1 FROM s_close c WHERE c.monster_id = monsters.id AND c.ok = 1)
    AND NOT EXISTS (SELECT 1 FROM s_attempts a WHERE a.monster_id = monsters.id AND (a.resolved != 1 OR a.notified = 0))`,
    [now, now - G.ACTIVE_MS_S]);
  await db.run(`DELETE FROM monsters WHERE corrupt_of IS NULL AND ((rank = 'SS' AND spawned_at < ?) OR (rank != 'SS' AND spawned_at < ?) OR (rank = 'F' AND spawned_at < ?))
    AND NOT EXISTS (SELECT 1 FROM kills k WHERE k.monster_id = monsters.id)
    AND NOT EXISTS (SELECT 1 FROM s_close c WHERE c.monster_id = monsters.id AND c.ok = 1)
    AND NOT EXISTS (SELECT 1 FROM s_attempts a WHERE a.monster_id = monsters.id AND (a.resolved != 1 OR a.notified = 0))`,
    [now - G.ACTIVE_MS_S, now - G.ACTIVE_MS, now - G.ACTIVE_MS_F]);
  await db.run('DELETE FROM monsters WHERE corrupt_of IS NOT NULL AND spawned_at < ? AND NOT EXISTS (SELECT 1 FROM kills k WHERE k.monster_id = monsters.id)', [now - CORRUPT_MON_MS]);
  await db.run('DELETE FROM fail_cd WHERE monster_id NOT IN (SELECT id FROM monsters)');
}

// ── 헌터 커뮤니티: 5분마다 새 글이 올라옵니다 (요청이 올 때 밀린 만큼 따라잡음) ──
const BOARD_GAP = 5 * G.MIN;
async function boardCtx(now) {
  const mons = {}, regions = G.SPAWN_REGIONS.map(r => G.placeLong(r.id));
  ['F', 'E', 'D', 'C', 'B', 'A', 'S'].forEach(k => { mons[k] = G.MON[k]; });
  const sOn = (await db.all(`SELECT name, region FROM monsters WHERE rank = 'SS' AND owner_id IS NULL AND corrupt_of IS NULL AND spawned_at > ?
      AND id NOT IN (SELECT monster_id FROM s_close)`, [now - G.ACTIVE_MS_S])).map(m => ({ name: m.name, place: G.placeName(m.region) }));
  const sKill = (await db.all(`SELECT m.name, m.region FROM s_close c JOIN monsters m ON m.id = c.monster_id WHERE c.ok = 1 AND c.at > ? LIMIT 10`, [now - 3 * G.HOUR]))
    .map(m => ({ name: m.name, place: G.placeName(m.region) }));
  const sFled = (await db.all("SELECT name, region FROM s_log WHERE status = 'fled' AND ended_at > ? LIMIT 10", [now - 3 * G.HOUR]))
    .map(m => ({ name: m.name, place: G.placeName(m.region) }));
  const us = await db.all('SELECT hunter_name AS hn, rank, stats FROM users WHERE is_private = 0');   // 비공개 유저는 언급하지 않음
  const all = us.map(u => { let f = 0; try { f = Number(JSON.parse(u.stats).fame) || 0; } catch (_) {} return { hn: u.hn, rank: u.rank, fame: f }; });
  const fame = all.filter(u => u.fame > 0).sort((a, b) => b.fame - a.fame).slice(0, 40);
  const sUsers = all.filter(u => u.rank === 'S').sort((a, b) => b.fame - a.fame).slice(0, 40);
  return { mons, regions, sOn, sKill, sFled, sUsers, fame };
}
let boardBusy = false;
async function tickBoard() {
  if (boardBusy) return;
  const now = Date.now();
  const row = await db.get("SELECT next_at FROM spawn_state WHERE tier = 'board'");
  let next = row ? row.next_at : null;
  if (next !== null && next > now) return;
  boardBusy = true;
  try {
    if (next === null) {
      await db.run("INSERT OR IGNORE INTO spawn_state (tier, next_at) VALUES ('board', ?)", [now]);
      next = now - 5 * BOARD_GAP;                                      // 처음에는 최근 글 몇 개를 채워 둡니다
    }
    const from = row ? row.next_at : now;
    if (next < now - 6 * BOARD_GAP) next = now - 6 * BOARD_GAP;        // 오래 비어 있었다면 최근 30분만 반영
    const slots = [];
    for (let t = next; t <= now && slots.length < 8; t += BOARD_GAP) slots.push(t);
    if (!slots.length) return;
    const nextAt = slots[slots.length - 1] + BOARD_GAP;
    const claim = await db.run("UPDATE spawn_state SET next_at = ? WHERE tier = 'board' AND next_at = ?", [nextAt, from]);
    if (claim.changes !== 1) return;
    const ctx = await boardCtx(now), list = [];
    slots.forEach((t, i) => {
      const p = B.makePost(ctx);
      list.push(['INSERT INTO board_posts (who, title, body, tag, at) VALUES (?, ?, ?, ?, ?)', [p.who, p.title, p.body, p.tag, Math.min(now, t + G.rnd(0, 40) * 1000)]]);
    });
    // 업로드 전에 등급이 오른 헌터는 반드시 한 번만 언급합니다
    await db.run('UPDATE users SET board_rank = rank WHERE board_rank IS NULL');
    const up = (await db.all('SELECT id, hunter_name, rank, board_rank, is_private FROM users WHERE board_rank IS NOT NULL AND board_rank != rank')).filter(u => G.RANK_IDX[u.rank] !== undefined);
    for (const u of up.slice(0, 10)) {
      const done = await db.run('UPDATE users SET board_rank = ? WHERE id = ? AND board_rank = ?', [u.rank, u.id, u.board_rank]);
      if (done.changes !== 1 || u.is_private) continue;
      if (G.RANK_IDX[u.rank] > G.RANK_IDX[u.board_rank]) {
        const p = B.makeRankPost(u.hunter_name, u.board_rank, u.rank);
        list.push(['INSERT INTO board_posts (who, title, body, tag, at) VALUES (?, ?, ?, ?, ?)', [p.who, p.title, p.body, p.tag, now]]);
      }
    }
    // 가입 후 처음 로그인한 헌터는 반드시 한 번만 언급합니다 (처음 본다, 누구냐는 분위기)
    const fresh = await db.all('SELECT id, hunter_name, is_private FROM users WHERE intro_state = 2 ORDER BY id LIMIT 10');
    for (const u of fresh) {
      const done = await db.run('UPDATE users SET intro_state = 3 WHERE id = ? AND intro_state = 2', [u.id]);
      if (done.changes !== 1 || u.is_private) continue;
      const p = B.makeIntroPost(u.hunter_name);
      list.push(['INSERT INTO board_posts (who, title, body, tag, at) VALUES (?, ?, ?, ?, ?)', [p.who, p.title, p.body, p.tag, now]]);
    }
    list.push(['DELETE FROM board_posts WHERE id <= (SELECT MAX(id) FROM board_posts) - 300', []]);
    await db.batch(list);
  } finally { boardBusy = false; }
}

// ── 무료 DB(Neon) 한도를 아끼기 위한 서버 메모리 캐시 ──
// Vercel 에서만 켜집니다(VERCEL 환경변수). 로컬 테스트에서는 PERF_CACHE=1 로 켤 수 있습니다.
// 게임 규칙은 그대로이고, 같은 내용을 5초마다 DB 에서 다시 읽어 오던 것만 줄입니다.
const PERF = !!(process.env.VERCEL || process.env.PERF_CACHE);
const CATCHUP_MS = process.env.CATCHUP_MS !== undefined ? Number(process.env.CATCHUP_MS) : (PERF ? 5000 : 0);                  // 서버 전체 공통 '따라잡기'(출몰·결과 처리 등)는 인스턴스마다 5초에 한 번이면 충분합니다
let lastCatchUp = 0, catchUpRun = null;
async function catchUp() {
  const t = Date.now();
  if (CATCHUP_MS && t - lastCatchUp < CATCHUP_MS) return catchUpRun || undefined;
  lastCatchUp = t;
  catchUpRun = catchUpNow().finally(() => { catchUpRun = null; });
  return catchUpRun;
}
async function catchUpNow() { await corruptTick(); await tickSpawns(); await resolveDue(); await purgeMonsters(); await tickBoard(); await tickRumors(); await sweepExchange(); await EV.refresh(); await EV.cleanup(); }

// ── 업적 (정의는 DB에 저장되어 모든 헌터에게 똑같이 적용됩니다) ──
let achCache = { at: 0, defs: null }, achSeeded = false;
const ACH_TTL = PERF ? 120000 : 0;                    // 업적 정의는 관리자가 바꿀 때만 달라지므로 30초 동안 기억합니다 (관리자 창은 항상 새로 읽음)
async function loadAch(fresh) {
  if (!fresh && achCache.defs && Date.now() - achCache.at < ACH_TTL) return achCache.defs;
  const defs = await loadAchDb();
  achCache = { at: Date.now(), defs };
  return defs;
}
async function loadAchDb() {
  if (achSeeded) return db.all('SELECT id, name, descr, kind, val FROM achievements ORDER BY at, id');
  if (!(await db.get("SELECT 1 AS x FROM settings WHERE key = 'ach_seeded'"))) {
    await db.batch(G.ACH_SEED.map((a, i) => ['INSERT OR IGNORE INTO achievements (id, name, descr, kind, val, at) VALUES (?, ?, ?, ?, ?, ?)', [a.id, a.name, a.desc, a.kind, a.val, i + 1]]));
    await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('ach_seeded', '1')");
  }
  if (!(await db.get("SELECT 1 AS x FROM settings WHERE key = 'ach_seeded2'"))) {      // 두 번째 기본 업적 묶음: 이미 운영 중인 서버에도 한 번만 추가
    const t0 = 1000;
    await db.batch(G.ACH_SEED2.map((a, i) => ['INSERT OR IGNORE INTO achievements (id, name, descr, kind, val, at) VALUES (?, ?, ?, ?, ?, ?)', [a.id, a.name, a.desc, a.kind, a.val, t0 + i]]));
    await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('ach_seeded2', '1')");
  }
  if (!(await db.get("SELECT 1 AS x FROM settings WHERE key = 'ach_seeded3'"))) {      // 세 번째 기본 업적 묶음(독특한 업적 20개): 한 번만 추가
    const t0 = 2000;
    await db.batch(G.ACH_SEED3.map((a, i) => ['INSERT OR IGNORE INTO achievements (id, name, descr, kind, val, at) VALUES (?, ?, ?, ?, ?, ?)', [a.id, a.name, a.desc, a.kind, a.val, t0 + i]]));
    await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('ach_seeded3', '1')");
  }
  achSeeded = true;
  return db.all('SELECT id, name, descr, kind, val FROM achievements ORDER BY at, id');
}
async function achStats(u, defs) {
  const kinds = new Set((defs || []).map(d => d.kind));
  const need = (...ks) => ks.some(k => kinds.has(k));
  const [k, rs, st, sw] = await Promise.all([
    db.get("SELECT COALESCE(SUM(n), 0) AS c FROM hunt_log WHERE user_id = ? AND result = 'success'", [u.id]),
    db.all("SELECT DISTINCT rank FROM hunt_log WHERE user_id = ? AND result = 'success'", [u.id]),
    db.get('SELECT COUNT(*) AS c FROM s_attempts WHERE user_id = ?', [u.id]),
    db.get("SELECT COALESCE(SUM(n), 0) AS c FROM hunt_log WHERE user_id = ? AND result = 'success' AND rank = 'SS'", [u.id])]);
  const s = { kills: k.c, maxRank: rs.reduce((m, r) => Math.max(m, G.RANK_IDX[r.rank] == null ? -1 : G.RANK_IDX[r.rank]), -1), sTry: st.c, sWin: sw.c, lv: u.lv,
    visitBy: {}, visits: 0, countries: 0, collected: {}, slain: {}, surveys: 0, crafts: 0, fails: 0, friends: 0, gifts: 0, gold: Number(u.gold) || 0,
    rankIdx: G.RANK_IDX[u.rank] == null ? -1 : G.RANK_IDX[u.rank], stats: {} };
  try { s.stats = JSON.parse(u.stats) || {}; } catch (_) { s.stats = {}; }
  const jobs = [];
  if (need('visit', 'visits', 'countries')) jobs.push(db.all('SELECT region, n FROM visit_counts WHERE user_id = ?', [u.id]).then(rows => {
    const cs = new Set();
    rows.forEach(r => { const n = Number(r.n) || 0; s.visitBy[r.region] = n; s.visits += n; if (n > 0) cs.add(G.countryOf(r.region)); });
    s.countries = cs.size;
  }));
  // 업적에 쓰이는 아이템·몬스터 이름만 합산해서 가져옵니다 (전부 가져오면 기록이 쌓일수록 매번 읽는 양이 늘어남)
  const tgt = k => [...new Set((defs || []).filter(d => d.kind === k).map(d => splitVal(d.val)[0]))].filter(Boolean).slice(0, 200);
  const ph = l => l.map(() => '?').join(',');
  const tc = tgt('collect'), ts = tgt('slay');
  if (tc.length) jobs.push(db.all("SELECT name, SUM(qty) AS q FROM acquire_log WHERE user_id = ? AND kind = 'item' AND name IN (" + ph(tc) + ") GROUP BY name", [u.id].concat(tc)).then(rows => { rows.forEach(r => { s.collected[r.name] = Number(r.q) || 0; }); }));
  if (ts.length) jobs.push(db.all("SELECT mon, SUM(n) AS c FROM hunt_log WHERE user_id = ? AND result = 'success' AND mon IN (" + ph(ts) + ") GROUP BY mon", [u.id].concat(ts)).then(rows => { rows.forEach(r => { s.slain[r.mon] = Number(r.c) || 0; }); }));
  if (need('surveys')) jobs.push(db.get("SELECT COALESCE(SUM(n), 0) AS c FROM acquire_log WHERE user_id = ? AND source = '적월문 조사'", [u.id]).then(r => { s.surveys = r.c; }));
  if (need('crafts')) jobs.push(db.get("SELECT COALESCE(SUM(n), 0) AS c FROM acquire_log WHERE user_id = ? AND source = '조합'", [u.id]).then(r => { s.crafts = r.c; }));
  if (need('fails')) jobs.push(db.get("SELECT COALESCE(SUM(n), 0) AS c FROM hunt_log WHERE user_id = ? AND result = 'fail'", [u.id]).then(r => { s.fails = r.c; }));
  if (need('friends')) jobs.push(db.get('SELECT COUNT(*) AS c FROM friends WHERE user_id = ?', [u.id]).then(r => { s.friends = r.c; }));
  if (need('gifts')) jobs.push(db.get('SELECT COUNT(*) AS c FROM gifts WHERE from_id = ?', [u.id]).then(r => { s.gifts = r.c; }));
  await Promise.all(jobs);
  return s;
}
const splitVal = v => { const i = String(v).lastIndexOf(':'); return i < 0 ? [String(v), NaN] : [String(v).slice(0, i), Number(String(v).slice(i + 1))]; };
const visitsOf = (s, key) => (G.COUNTRY_BY_ID[key] ? G.COUNTRY_BY_ID[key].regions.reduce((a, r) => a + (s.visitBy[r.id] || 0), 0) : (s.visitBy[key] || 0));
const achMet = (a, s) => {
  const n = Number(a.val);
  switch (a.kind) {
    case 'always': return true;
    case 'kills': return s.kills >= n;
    case 'rank': return s.maxRank >= (G.RANK_IDX[a.val] == null ? 99 : G.RANK_IDX[a.val]);
    case 'sTry': return s.sTry >= n;
    case 'sWin': return s.sWin >= n;
    case 'lv': return s.lv >= n;
    case 'visits': return s.visits >= n;
    case 'countries': return s.countries >= n;
    case 'surveys': return s.surveys >= n;
    case 'crafts': return s.crafts >= n;
    case 'fails': return s.fails >= n;
    case 'friends': return s.friends >= n;
    case 'gifts': return s.gifts >= n;
    case 'gold': return s.gold >= n;
    case 'fame': return (Number(s.stats.fame) || 0) >= n;
    case 'taint': return (Number(s.stats.taint) || 0) >= n;
    case 'hrank': return s.rankIdx >= (G.RANK_IDX[a.val] == null ? 99 : G.RANK_IDX[a.val]);
    case 'visit': { const [k, c] = splitVal(a.val); return c > 0 && visitsOf(s, k) >= c; }
    case 'collect': { const [k, c] = splitVal(a.val); return c > 0 && (s.collected[k] || 0) >= c; }
    case 'slay': { const [k, c] = splitVal(a.val); return c > 0 && (s.slain[k] || 0) >= c; }
    case 'stat': { const [k, c] = splitVal(a.val); return c > 0 && (Number(s.stats[k]) || 0) >= c; }
    default: return false;            // manual: 관리자 부여만
  }
};
// 유저의 업적 상태: [{...정의, met(조건 달성), granted(관리자 부여), done}]
// 오염도 업적(예: 붉은 달에 물든 자)은 '한 번이라도 달성하면' 계속 달성한 것으로 둡니다. 정화해서 오염도가 내려가도 사라지지 않고, 다시 새 업적으로 알리지도 않습니다.
const STICKY_ACH = new Set(['taint']);
async function achOf(u) {
  const defs = await loadAch();
  const [s, gr, er] = await Promise.all([achStats(u, defs), db.all('SELECT ach_id FROM ach_grants WHERE user_id = ?', [u.id]),
    defs.some(a => STICKY_ACH.has(a.kind)) ? db.all('SELECT ach_id FROM ach_earned WHERE user_id = ?', [u.id]) : Promise.resolve([])]);
  const gs = new Set(gr.map(g => g.ach_id)), es = new Set(er.map(g => g.ach_id));
  return defs.map(a => { const met = achMet(a, s), granted = gs.has(a.id), kept = STICKY_ACH.has(a.kind) && es.has(a.id); return Object.assign({}, a, { met, granted, done: met || granted || kept }); });
}
// 업적을 처음 확인한 시각을 기록합니다 (친구 프로필의 '가장 최근 업적'에 쓰입니다).
// 관리자가 부여한 업적은 부여 시각, 조건으로 달성한 업적은 서버가 처음 확인한 시각이 됩니다.
const achSyncAt = new Map();
async function syncAchEarned(u, now, force) {
  if (!force && (achSyncAt.get(u.id) || 0) > now - 60000) return;
  achSyncAt.set(u.id, now);
  if (achSyncAt.size > 5000) achSyncAt.clear();
  try {
    const [list, have, gr] = await Promise.all([achOf(u),
      db.all('SELECT ach_id FROM ach_earned WHERE user_id = ?', [u.id]),
      db.all('SELECT ach_id, at FROM ach_grants WHERE user_id = ?', [u.id])]);
    const done = new Set(list.filter(a => a.done).map(a => a.id));
    const hv = new Set(have.map(h => h.ach_id)), gat = new Map(gr.map(g => [g.ach_id, g.at]));
    const ops = [];
    done.forEach(id => { if (!hv.has(id)) ops.push(['INSERT OR IGNORE INTO ach_earned (user_id, ach_id, at) VALUES (?, ?, ?)', [u.id, id, gat.get(id) || now]]); });
    const sticky = new Set(list.filter(a => STICKY_ACH.has(a.kind)).map(a => a.id));
    hv.forEach(id => { if (!done.has(id) && !sticky.has(id)) ops.push(['DELETE FROM ach_earned WHERE user_id = ? AND ach_id = ?', [u.id, id]]); });
    if (ops.length) await db.batch(ops);
  } catch (_) { achSyncAt.delete(u.id); }
}
const pinIds = u => { try { const a = JSON.parse(u.pinned_ach || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch (_) { return []; } };
const pinnedList = (u, defs) => { const m = new Map(defs.map(a => [a.id, a])); return pinIds(u).filter(id => m.has(id)).slice(0, G.ACH_PIN_MAX).map(id => ({ id, name: m.get(id).name })); };

// 오늘의 추천 (관리자가 입력한 값만 보여줍니다)
let recCache = { at: 0, v: null };
async function getRec() {
  if (PERF && Date.now() - recCache.at < 30000) return recCache.v;
  const v = await getRec0();
  recCache = { at: Date.now(), v };
  return v;
}
async function getRec0() {
  const r = await db.get("SELECT value FROM settings WHERE key = 'daily_rec'");
  if (!r) return null;
  try {
    const v = JSON.parse(r.value);
    if (!v.text) {      // 예전 형식(지역·시간대·조언)은 한 문장으로 합쳐서 보여줍니다
      const rg = v.region && G.REGION_BY_ID[v.region];
      v.text = [rg ? rg.name + ' 추천' : '', v.time || '', v.tip || ''].filter(Boolean).join(' · ');
    }
    return v.text ? { text: v.text, at: v.at } : null;
  } catch (_) { return null; }
}

// ───────────── 응답 구성 ─────────────
function publicUser(u) {
  return {
    code: u.code, name: u.name, gender: u.gender, age: u.age, personality: u.personality,
    traits: JSON.parse(u.traits || '[]'), image: imgUrl(u.id, u.img_ver), hunterName: u.hunter_name, rank: u.rank,
    stats: statsOf(u), lv: u.lv, exp: u.exp, gold: u.gold, region: u.region,
  };
}

async function sInfo(userId, now) {
  const w = await db.get('SELECT start, n FROM s_window WHERE user_id = ?', [userId]);
  if (!w || now - w.start >= G.S_WINDOW_MS) return { remaining: G.S_MAX, resetAt: 0 };
  return { remaining: Math.max(0, G.S_MAX - w.n), resetAt: w.start + G.S_WINDOW_MS };
}

// 스탯이 만드는 확률 (모두 95% 이하)
const fxOf = st => ({ win: Math.round(Math.min(G.PROB_CAP, (Number(st.str) || 0) * G.STR_WIN) * 100), guard: Math.round(G.guardChance(st.agi) * 100), free: Math.round(G.freeChance(st.luck) * 100) });
const MAT_NAMES = new Set(G.MATERIALS.concat(G.GATE_MATS).map(m => m.name).concat([EVT.EMBER]));      // 인벤토리 '조합 아이템' 탭에 들어가는 재료 이름
const MAT_TIER = new Map(G.MATERIALS.map(m => [m.name, 'c']).concat(G.GATE_MATS.map(m => [m.name, m.tier])).concat([[EVT.EMBER, 'r']]));   // 재료 등급 (현장 재료는 일반)
// ── 서버 BGM: 관리자가 정한 유튜브 영상을 모든 헌터가 듣습니다. (끄기·볼륨은 각자 브라우저에서만 정함 — 서버에는 아무것도 저장하지 않음) ──
const ytIdOf = u => {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^[\w-]{11}$/.test(u)) return u;
  let m; try { m = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u); } catch (e) { return ''; }
  const h = m.hostname.replace(/^(www\.|m\.|music\.)/, '');
  if (h === 'youtu.be') { const i = m.pathname.slice(1).split('/')[0]; return /^[\w-]{11}$/.test(i) ? i : ''; }
  if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
    const v = m.searchParams.get('v'); if (v && /^[\w-]{11}$/.test(v)) return v;
    const p = m.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/); if (p) return p[1];
  }
  return '';
};
let bgmCache = { at: 0, id: '', v: 0 };
async function srvBgm() {
  const now = Date.now();
  if (now - bgmCache.at < 5000) return bgmCache;
  let o = {};
  try { const r = await db.get("SELECT value FROM settings WHERE key = 'srv_bgm'"); if (r) o = JSON.parse(r.value) || {}; } catch (e) { /* 읽지 못하면 꺼진 것으로 */ }
  bgmCache = { at: now, id: /^[\w-]{11}$/.test(o.id || '') ? o.id : '', v: Number(o.v) || 0 };
  return bgmCache;
}
async function buildState(u, now) {
  await settleDying(u.id, now);
  await EV.refresh();
  await tickPersonal(u.id, now);
  await EV.refresh(); await EV.tick(u, now);      // [EVENT:HALLOWEEN] 백귀야행
  if (await corruptCheck(u.id, u)) u = (await userById(u.id)) || u;      // 방금 읽은 유저 행을 그대로 쓰고, 값이 바뀐 때만 다시 읽음
  await syncAchEarned(u, now);
  // 기기 '업적' 앱의 새 업적 표시: 마지막으로 업적 앱을 본 뒤에 얻은 업적 수 (처음 한 번은 기준만 잡습니다)
  if (!Number(u.ach_seen)) { await db.run('UPDATE users SET ach_seen = ? WHERE id = ? AND ach_seen = 0', [now, u.id]); u.ach_seen = now; }
  // 화면 숫자(알림·메시지·의뢰·선물 등)는 한 번의 질문으로 묶어서 가져옵니다 (질문마다 붙는 통신 부담을 줄임)
  const cnt = await db.get(`SELECT
    (SELECT COUNT(*) FROM ach_earned WHERE user_id = ? AND at > ?) AS ach,
    (SELECT COUNT(*) FROM notices WHERE id > ?) AS un,
    (SELECT COUNT(*) FROM messages m JOIN friends f ON f.user_id = m.to_id AND f.friend_id = m.from_id WHERE m.to_id = ? AND m.id > f.last_read) AS um,
    (SELECT COUNT(*) FROM friend_requests WHERE to_id = ?) AS frq,
    (SELECT COUNT(*) FROM rumors r WHERE r.status = 'open' AND r.ends > ? AND NOT EXISTS (SELECT 1 FROM rumor_votes v WHERE v.rumor_id = r.id AND v.user_id = ?)) AS rum,
    (SELECT COUNT(*) FROM daily_quests WHERE user_id = ? AND day = ? AND claimed = 0 AND prog >= need) AS qrdy,
    (SELECT COUNT(*) FROM friends f JOIN users x ON x.id = f.friend_id WHERE f.user_id = ? AND x.corrupt_flag = 1) AS resq,
    (SELECT COUNT(*) FROM gifts WHERE to_id = ? AND seen = 0) AS gift,
    (SELECT COALESCE(MAX(id), 0) FROM board_posts) AS board,
    ${SYSMSG.NEXT_SQL}`,
    [u.id, Number(u.ach_seen), u.notice_seen, u.id, u.id, now, u.id, u.id, kstDay(now), u.id, u.id, now - SYSMSG.LIVE_MS, u.id]);
  const achNew = Number(cnt.ach);
  // 보이는 몬스터: 서버 공통 S급 + 내 몬스터(F~A). 예전 공통 F~A 몬스터는 보이지 않습니다.
  const vis = "((owner_id IS NULL AND (rank = 'SS' OR corrupt_of IS NOT NULL OR rumor_id IS NOT NULL)) OR owner_id = ?)";
  const NL = EV.nightListSql(now);
  const mons = await db.all(`SELECT id, region, name, rank, spawned_at, rumor_id, corrupt_of FROM monsters
    WHERE ${vis} AND (spawned_at > ? OR (rank = 'SS' AND spawned_at > ?) OR (corrupt_of IS NOT NULL AND spawned_at > ?) OR id IN (SELECT id FROM monsters WHERE ${vis} ORDER BY id DESC LIMIT 6))
      AND id NOT IN (SELECT monster_id FROM s_close WHERE ok = 0)
      AND NOT (rank = 'F' AND corrupt_of IS NULL AND spawned_at < ${now - G.ACTIVE_MS_F} AND id NOT IN (SELECT monster_id FROM kills WHERE user_id = ?))
      AND (corrupt_of IS NULL OR corrupt_of <> ?)${EV.GATE_GHOST_SQL}${NL.sql}
    ORDER BY spawned_at DESC, id DESC LIMIT 40`, [u.id, now - G.ACTIVE_MS, now - G.ACTIVE_MS_S, now - CORRUPT_MON_MS, u.id, u.id, u.id].concat(EV.GATE_GHOST_ARGS, NL.args));      // [EVENT:HALLOWEEN] 적월문 안의 잡귀는 어떤 경우에도 보이지 않음
  const minId = mons.length ? Math.min.apply(null, mons.map(m => m.id)) : 0;
  const [kills, cds, parts, si, pending, results] = await Promise.all([
    db.all('SELECT monster_id FROM kills WHERE user_id = ? AND monster_id >= ?', [u.id, minId]),
    db.all('SELECT monster_id, until FROM fail_cd WHERE user_id = ? AND until > ?', [u.id, now]),
    db.all(`SELECT monster_id, COUNT(DISTINCT user_id) AS c FROM s_attempts
            WHERE monster_id IN (SELECT id FROM monsters WHERE rank = 'SS' AND corrupt_of IS NULL AND id >= ?) GROUP BY monster_id`, [minId]),
    sInfo(u.id, now),
    db.all(`SELECT a.id, a.resolve_at, m.name FROM s_attempts a JOIN monsters m ON m.id = a.monster_id
            WHERE a.user_id = ? AND a.resolved = 0 ORDER BY a.resolve_at`, [u.id]),
    db.all(`SELECT a.id, a.success, a.exp_gain, a.gold_gain, a.taint_gain, a.level_up, a.hp_loss, m.name FROM s_attempts a JOIN monsters m ON m.id = a.monster_id
            WHERE a.user_id = ? AND a.resolved = 1 AND a.notified = 0 ORDER BY a.id`, [u.id]),
  ]);
  // 일일 의뢰(수령 가능 수) · 구조가 필요한 친구 수 · 나를 구해 준 친구 알림(한 번만)
  const rescued = await db.all('SELECT r.id, r.at, x.hunter_name AS hn FROM rescues r JOIN users x ON x.id = r.rescuer_id WHERE r.target_id = ? AND r.seen = 0 ORDER BY r.id LIMIT 5', [u.id]);
  if (rescued.length) await db.run('UPDATE rescues SET seen = 1 WHERE target_id = ? AND seen = 0 AND id <= ?', [u.id, rescued[rescued.length - 1].id]);
  const inv = await db.all('SELECT i.item, i.qty, s.eff_stat, s.eff_amt FROM inventory i LEFT JOIN shop_items s ON s.name = i.item WHERE i.user_id = ? AND i.qty > 0 ORDER BY i.item', [u.id]);
  const closedOk = new Set((await db.all('SELECT monster_id FROM s_close WHERE ok = 1 AND monster_id >= ?', [minId])).map(r => r.monster_id));
  // S급 토벌 성공 안내(모든 헌터에게): 확인을 누르면 참여자에게만 보상이 지급됩니다
  // 최소화해 둔 지 1시간이 지난 S급 토벌 보상은 자동으로 수령시킵니다
  const sAuto = [];
  const overdue = await db.all('SELECT monster_id FROM s_min WHERE user_id = ? AND at <= ?', [u.id, now - SWIN_HOLD_MS]);
  for (const o of overdue) {
    const out = await claimSWin(u, o.monster_id, now);
    if (out && !out.already) sAuto.push({ mon: out.mon, reward: out.reward });
    else await db.run('DELETE FROM s_min WHERE user_id = ? AND monster_id = ?', [u.id, o.monster_id]);
  }
  const swin = await db.all(`SELECT c.monster_id AS id, m.name, r.exp, r.gold, r.taint, CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS part, mn.at AS min_at
      FROM s_close c JOIN monsters m ON m.id = c.monster_id
      LEFT JOIN s_rewards r ON r.monster_id = c.monster_id AND r.user_id = ?
      LEFT JOIN s_min mn ON mn.monster_id = c.monster_id AND mn.user_id = ?
      WHERE c.ok = 1 AND c.at >= ? AND NOT EXISTS (SELECT 1 FROM s_ack k WHERE k.user_id = ? AND k.monster_id = c.monster_id)
      ORDER BY c.at LIMIT 5`, [u.id, u.id, u.created_at, u.id]);
  const killed = new Set([...kills.map(r => r.monster_id), ...closedOk]);
  const cdm = new Map(cds.map(r => [r.monster_id, r.until]));
  const pm = new Map(parts.map(r => [r.monster_id, r.c]));
  return {
    now,
    user: { pinned: pinnedList(u, await loadAch()), bio: u.bio || '', lv: u.lv, exp: u.exp, gold: u.gold, region: u.region, country: G.countryOf(u.region), hunterName: u.hunter_name, private: !!u.is_private, stats: statsOf(u), eq: await equipBonus(u.id), dyingUntil: u.dying_until > now ? u.dying_until : 0, blocked: u.block_flags | 0, adminChar: !!u.admin_char, inqUnread: (await db.get('SELECT COUNT(*) AS c FROM inquiries WHERE user_id = ? AND from_admin = 1 AND id > ?', [u.id, u.inq_read])).c, corruptUntil: corruptLock(u, now) ? u.corrupt_until : 0, tainted: (JSON.parse(u.stats).taint || 0) >= 100, fx: fxOf(JSON.parse(u.stats)) },
    monsters: mons.map(m => ({
      id: m.id, region: m.region, rname: G.placeName(m.region), mon: m.rumor_id ? '[괴담] ' + m.name : m.name, r: m.rank, ts: m.spawned_at,
      done: killed.has(m.id), cd: cdm.get(m.id) || 0,
      parts: m.rank === 'SS' && m.corrupt_of == null ? (pm.get(m.id) || 0) : undefined,
      c: m.corrupt_of != null ? 1 : undefined,
    })),
    s: Object.assign(si, { need: G.RAID_NEED, needTries: G.RAID_ATTEMPTS, max: G.S_MAX }),
    pending: pending.map(p => ({ id: p.id, mon: p.name, at: p.resolve_at })),
    results: results.map(r => ({ id: r.id, mon: r.name, success: !!r.success, exp: r.exp_gain, gold: r.gold_gain, taint: r.taint_gain, levelUp: !!r.level_up, hpLoss: r.hp_loss })),
    unreadNotices: Number(cnt.un),
    sp: cnt.sp || null,
    achNew,
    giftUnread: Number(cnt.gift),
    unreadMsgs: Number(cnt.um),
    board: Number(cnt.board),
    friendReqs: Number(cnt.frq),
    questReady: Number(cnt.qrdy), rumorNew: Number(cnt.rum), battle: await (async () => { const bb = await battleLive(u.id, now); return bb ? btView(bb) : null; })(), rescueReq: Number(cnt.resq), rescued: rescued.map(x => ({ hn: x.hn, at: x.at })),
    sWin: swin.map(x => ({ id: x.id, mon: x.name, part: !!x.part, exp: x.exp || 0, gold: x.gold || 0, taint: x.taint || 0, minAt: Number(x.min_at) || 0 })),
    sAuto, sHoldMs: SWIN_HOLD_MS,
    rec: await getRec(),
    event: EV.brief(now),      // [EVENT:HALLOWEEN]
    bgm: (await srvBgm()).id, bgmv: bgmCache.v,      // 서버 BGM (유튜브 영상 ID, 없으면 빈 문자열)
    inventory: inv.map(r => ({ item: r.item, qty: r.qty, mat: MAT_NAMES.has(r.item), tier: MAT_TIER.get(r.item) || null, eff: r.eff_stat ? { stat: r.eff_stat, amt: r.eff_amt } : (G.CRAFT_DEFS[r.item] ? { stat: G.CRAFT_DEFS[r.item].stat, amt: G.CRAFT_DEFS[r.item].amt } : null) })),
  };
}

// ───────────── 인증 ─────────────
async function authUser(req) {
  const t = cookies(req).sid;
  if (!t) return null;
  const row = await db.get(
    'SELECT ' + (await userSel('u.')) + ' FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
    [sha256(t), Date.now()]);
  if (row) {      // 접속 시각 기록 (요청마다 쓰지 않도록 20초에 한 번만 갱신)
    const now = Date.now();
    if ((Number(row.last_seen) || 0) < now - 20000) { row.last_seen = now; await db.run('UPDATE users SET last_seen = ? WHERE id = ?', [now, row.id]); }
  }
  return row || null;
}
function cookieHeader(value, maxAgeSec) {
  return `sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}` + (COOKIE_SECURE ? '; Secure' : '');
}
const PW_OK = v => typeof v === 'string' && v.length >= 8 && v.length <= 64 &&
  /[A-Za-z]/.test(v) && /[0-9]/.test(v) && /[^A-Za-z0-9\s]/.test(v);
function normCode(v) {
  const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : '';
}
const ADMIN_ID = process.env.ADMIN_ID || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_MS = 8 * G.HOUR;
async function authAdmin(req) {
  const t = cookies(req).asid;
  if (!t) return false;
  const row = await db.get('SELECT 1 AS x FROM sessions WHERE token_hash = ? AND user_id = -1 AND expires_at > ?', [sha256(t), Date.now()]);
  return !!row;
}
const adminCookie = (v, sec) => `asid=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sec}` + (COOKIE_SECURE ? '; Secure' : '');
// 토벌·습득 기록 (관리자 창에서 조회)
const logHunt = (uid, m, result, gain, at) => db.run(
  'INSERT INTO hunt_log (user_id, monster_id, mon, rank, result, exp_gain, at) VALUES (?, ?, ?, ?, ?, ?, ?)', [uid, m.id, m.name, m.rank, result, gain, at]);
const logAcquire = (uid, kind, name, qty, source, at) => db.run(
  'INSERT INTO acquire_log (user_id, kind, name, qty, source, at) VALUES (?, ?, ?, ?, ?, ?)', [uid, kind, name, qty, source, at]);
// 캐릭터 이미지(최대 약 800KB)는 매 요청마다 읽으면 DB 전송량이 크게 늘어서, 일반 조회에서는 빼고 필요할 때만 따로 읽습니다.
let _userCols = null;
async function userSel(prefix, withPw) {
  if (!_userCols) {
    const r = await db.get('SELECT * FROM users ORDER BY COALESCE(LENGTH(image), 0) LIMIT 1');      // 사진이 가장 작은 헌터 한 명 (열 이름만 필요하므로 큰 사진을 읽지 않도록)
    if (!r) return (prefix || '') + '*';           // 아직 가입자가 없을 때
    _userCols = Object.keys(r).filter(k => k !== 'image' && k !== 'thumb' && k !== 'personality' && k !== 'traits');      // 긴 글(성격·특징)과 이미지는 필요할 때만 따로 읽습니다
  }
  // 비밀번호 해시는 로그인할 때만 필요합니다 (요청마다 읽어 오지 않음)
  return _userCols.filter(k => withPw || (k !== 'pw_salt' && k !== 'pw_hash')).map(k => (prefix || '') + k).join(', ');
}
const userById = async id => db.get('SELECT ' + (await userSel()) + ' FROM users WHERE id = ?', [id]);
const userByCode = async code => db.get('SELECT ' + (await userSel('', true)) + ' FROM users WHERE code = ?', [code]);
// 성격·특징(긴 글)은 프로필 화면·관리자 수정처럼 꼭 필요할 때만 읽습니다 (매 요청마다 읽으면 DB 전송량이 늘어납니다)
const withText = async u => { if (!u) return u; const r = await db.get('SELECT personality, traits FROM users WHERE id = ?', [u.id]); return Object.assign({}, u, { personality: r ? r.personality : '', traits: r ? r.traits : '[]' }); };
const withImage = withText;
// 캐릭터 이미지는 JSON 에 넣지 않고 주소로 내려줍니다. 주소에 버전이 들어 있어서 이미지가 바뀌지 않는 한 브라우저가 다시 받지 않습니다.
const IMG_KEY = sha256('img:' + (process.env.IMG_SECRET || ADMIN_PASSWORD || process.env.DATABASE_URL || process.env.POSTGRES_URL || 'dev'));
const imgSig = (id, ver) => crypto.createHmac('sha256', IMG_KEY).update(id + ':' + ver).digest('hex').slice(0, 24);
const thumbUrl = (id, ver, has) => (has && Number(ver) > 0 ? '/api/thumb?k=' + id + '.' + imgSig('t' + id, Number(ver)) + '&v=' + Number(ver) : '');
const imgUrl = (id, ver) => (Number(ver) > 0 ? '/api/img?k=' + id + '.' + imgSig(id, Number(ver)) + '&v=' + Number(ver) : '');
const isFriend = async (a, b) => !!(await db.get('SELECT 1 AS x FROM friends WHERE user_id = ? AND friend_id = ?', [a, b]));

// ───────────── 경로 ─────────────
const routes = {};
const route = (method, p, fn, opts) => { routes[method + ' ' + p] = Object.assign({ fn, auth: true }, opts || {}); };
route('GET', '/api/img', async (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams, [id, sig] = String(q.get('k') || '').split('.'), ver = Number(q.get('v')) || 0;
  if (!/^\d+$/.test(id || '') || !ver || !safeEq(sig || '', imgSig(id, ver))) return fail(res, 404, 'not_found');
  const r = await db.get('SELECT image FROM users WHERE id = ? AND img_ver = ?', [Number(id), ver]);
  const m = r && /^data:image\/jpeg;base64,(.+)$/.exec(r.image || '');
  if (!m) return fail(res, 404, 'not_found');
  const buf = Buffer.from(m[1], 'base64');
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.end(buf);
}, { auth: false });

// 작은 프로필 사진: 큰 원본을 읽지 않고 이 칸만 읽습니다. 주소에 버전이 들어 있어 사진이 바뀌지 않는 한 브라우저·CDN 이 1년간 다시 받지 않습니다.
route('GET', '/api/thumb', async (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams, [id, sig] = String(q.get('k') || '').split('.'), ver = Number(q.get('v')) || 0;
  if (!/^\d+$/.test(id || '') || !ver || !safeEq(sig || '', imgSig('t' + id, ver))) return fail(res, 404, 'not_found');
  const r = await db.get('SELECT thumb FROM users WHERE id = ? AND img_ver = ?', [Number(id), ver]);
  const m = r && /^data:image\/jpeg;base64,(.+)$/.exec(r.thumb || '');
  if (!m) return fail(res, 404, 'not_found');
  const buf = Buffer.from(m[1], 'base64');
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.end(buf);
}, { auth: false });

route('POST', '/api/signup', async (req, res, ctx) => {
  { const mt = await maintState(); if (mt.on) return fail(res, 503, 'maintenance', { message: mt.msg }); }
  if (await limited('signup:' + ctx.ip, 10, G.HOUR)) return fail(res, 429, 'rate_limited');
  const b = ctx.body;
  const name = String(b.name || '').trim();
  const gender = b.gender;
  const age = Number(b.age);
  const hn = String(b.hunterName || '').trim();
  const pers = String(b.personality || '').trim();
  const traits = Array.isArray(b.traits) ? b.traits.map(t => String(t).trim()).filter(Boolean) : [];
  const image = typeof b.image === 'string' ? b.image : '';
  if (!name || cp(name) > 30) return fail(res, 400, 'bad_name');
  if (!['여성', '남성', '기타'].includes(gender)) return fail(res, 400, 'bad_gender');
  if (!Number.isInteger(age) || age < 1 || age > 999) return fail(res, 400, 'bad_age');
  if (cp(hn) < 2 || cp(hn) > 12) return fail(res, 400, 'bad_hunter_name');
  if (!pers || cp(pers) > 1000) return fail(res, 400, 'bad_personality');
  if (traits.length > 5 || traits.some(t => cp(t) > 50)) return fail(res, 400, 'bad_traits');
  if (!PW_OK(b.password)) return fail(res, 400, 'bad_password');
  const inv = normInvite(b.invite);
  if (!inv) return fail(res, 400, 'invite_required');
  const iv = await db.get('SELECT code, active, max_uses FROM invites WHERE code = ?', [inv]);
  if (!iv) return fail(res, 400, 'invite_invalid');
  if (!iv.active) return fail(res, 400, 'invite_inactive');
  const used0 = await db.get('SELECT COUNT(*) AS c FROM users WHERE invite_code = ?', [inv]);
  if (used0.c >= iv.max_uses) return fail(res, 400, 'invite_full');
  if (image && !(image.length <= 800000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image))) return fail(res, 400, 'bad_image');
  const thumb = image && validThumb(b.thumb) ? b.thumb : '';

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPw(b.password, salt);
  const rank = G.rollRank();
  const stats = G.rollStats(rank);
  let code, tries = 0;
  for (;;) {
    code = G.makeCode();
    try {
      await db.run(`INSERT INTO users
        (code, name, gender, age, personality, traits, image, thumb, img_ver, hunter_name, rank, stats, pw_salt, pw_hash, created_at, invite_code, board_rank, intro_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [code, name, gender, age, pers, JSON.stringify(traits), image, thumb, image ? Date.now() : 0, hn, rank, JSON.stringify(stats), salt, hash, Date.now(), inv, rank]);
      break;
    } catch (e) {
      if (!(/UNIQUE|duplicate key/i.test(String(e.message)) || e.code === '23505') || ++tries > 10) throw e;
    }
  }
  // 동시 가입으로 정원을 넘겼다면 방금 만든 계정을 되돌립니다.
  const iv2 = await db.get('SELECT active, max_uses, reward_set, reward_gold, reward_item, reward_qty FROM invites WHERE code = ?', [inv]);
  const used1 = await db.get('SELECT COUNT(*) AS c FROM users WHERE invite_code = ?', [inv]);
  if (!iv2 || !iv2.active || used1.c > iv2.max_uses) {
    await db.run('DELETE FROM users WHERE code = ?', [code]);
    return fail(res, 400, !iv2 ? 'invite_invalid' : !iv2.active ? 'invite_inactive' : 'invite_full');
  }
  // 초대 코드 첫 보상: 가입할 때 단 한 번만 지급됩니다 (이후 코드를 지워도 지급 기록과 보상은 남습니다)
  let reward = null;
  if (iv2.reward_set) {
    const nu = await db.get('SELECT id FROM users WHERE code = ?', [code]);
    const ins = await db.run('INSERT OR IGNORE INTO invite_rewards (user_id, code, gold, item, qty, at) VALUES (?, ?, ?, ?, ?, ?)',
      [nu.id, inv, iv2.reward_gold, iv2.reward_item, iv2.reward_qty, Date.now()]);
    if (ins.changes === 1) {
      const now = Date.now();
      if (iv2.reward_gold > 0) { await grantGold(nu.id, iv2.reward_gold); await logAcquire(nu.id, 'gold', '골드', iv2.reward_gold, '초대 보상', now); }
      if (iv2.reward_item && iv2.reward_qty > 0) {
        await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + excluded.qty)', [nu.id, iv2.reward_item, iv2.reward_qty]);
        await logAcquire(nu.id, 'item', iv2.reward_item, iv2.reward_qty, '초대 보상', now);
      }
      reward = { gold: iv2.reward_gold, item: iv2.reward_item, qty: iv2.reward_qty };
    }
  }
  send(res, 201, { code, rank, hunterName: hn, reward });
}, { auth: false, limit: 1200000 });

// ───────────── 초대 코드 (관리자) ─────────────
const MAX_INVITE_USES = 10;
const normInvite = v => String(v == null ? '' : v).trim().toUpperCase();
const INVITE_RE = /^[A-Z0-9-]{4,20}$/;
async function inviteRewardOf(uid) {
  const r = await db.get('SELECT code, gold, item, qty FROM invite_rewards WHERE user_id = ?', [uid]);
  return r ? { code: r.code, gold: r.gold, item: r.item, qty: r.qty } : null;
}
route('GET', '/api/admin/invites', async (req, res) => {
  const rows = await db.all(`SELECT i.code, i.active, i.max_uses, i.created_at, i.reward_set, i.reward_gold, i.reward_item, i.reward_qty,
      (SELECT COUNT(*) FROM invite_rewards r WHERE r.code = i.code) AS granted,
      (SELECT COUNT(*) FROM users u WHERE u.invite_code = i.code) AS used FROM invites i ORDER BY i.created_at DESC`);
  const users = await db.all("SELECT hunter_name, code, invite_code FROM users WHERE invite_code <> '' ORDER BY id");
  const by = {};
  users.forEach(u => { (by[u.invite_code] = by[u.invite_code] || []).push({ hunterName: u.hunter_name, code: u.code }); });
  send(res, 200, { max: MAX_INVITE_USES, invites: rows.map(r => ({ code: r.code, active: !!r.active, max: r.max_uses, used: r.used, created: r.created_at, users: by[r.code] || [], reward: r.reward_set ? { gold: r.reward_gold, item: r.reward_item, qty: r.reward_qty, granted: r.granted } : null })) });
}, { auth: false, admin: true });

// 초대 보상 입력 확인: { gold, item, qty } → 올바르면 값, 비어 있으면 null, 잘못되면 오류 문자열
async function parseReward(b) {
  const gold = b.gold == null || b.gold === '' ? 0 : Number(b.gold);
  const item = String(b.item == null ? '' : b.item).trim();
  const qty = item ? (b.qty == null || b.qty === '' ? 1 : Number(b.qty)) : 0;
  if (!Number.isInteger(gold) || gold < 0 || gold > 9999999) return 'bad_reward_gold';
  if (item && (!Number.isInteger(qty) || qty < 1 || qty > 99)) return 'bad_reward_qty';
  if (item && !(await db.get('SELECT 1 AS x FROM shop_items WHERE name = ?', [item]))) return 'bad_reward_item';
  if (gold === 0 && !item) return null;
  return { gold, item, qty };
}
route('POST', '/api/admin/invites/reward', async (req, res, ctx) => {
  const code = normInvite(ctx.body.code);
  const rw = await parseReward(ctx.body);
  if (rw === null) return fail(res, 400, 'bad_reward_empty');
  if (typeof rw === 'string') return fail(res, 400, rw);
  const w = await db.run('UPDATE invites SET reward_set = 1, reward_gold = ?, reward_item = ?, reward_qty = ? WHERE code = ? AND reward_set = 0', [rw.gold, rw.item, rw.qty, code]);
  if (w.changes !== 1) return fail(res, (await db.get('SELECT 1 AS x FROM invites WHERE code = ?', [code])) ? 409 : 404, (await db.get('SELECT 1 AS x FROM invites WHERE code = ?', [code])) ? 'reward_locked' : 'not_found');
  send(res, 200, { ok: true });
}, { auth: false, admin: true });
route('POST', '/api/admin/invites/create', async (req, res, ctx) => {
  let code = normInvite(ctx.body.code);
  if (!code) code = crypto.randomBytes(5).toString('hex').toUpperCase();
  if (!INVITE_RE.test(code)) return fail(res, 400, 'bad_invite');
  const max = ctx.body.max == null || ctx.body.max === '' ? MAX_INVITE_USES : Number(ctx.body.max);
  if (!Number.isInteger(max) || max < 1 || max > MAX_INVITE_USES) return fail(res, 400, 'bad_max');
  if (await db.get('SELECT 1 AS x FROM invites WHERE code = ?', [code])) return fail(res, 409, 'invite_exists');
  const rw = ctx.body.reward ? await parseReward(ctx.body.reward) : null;
  if (typeof rw === 'string') return fail(res, 400, rw);
  await db.run('INSERT INTO invites (code, active, max_uses, created_at, reward_set, reward_gold, reward_item, reward_qty) VALUES (?, 1, ?, ?, ?, ?, ?, ?)',
    [code, max, Date.now(), rw ? 1 : 0, rw ? rw.gold : 0, rw ? rw.item : '', rw ? rw.qty : 0]);
  send(res, 200, { ok: true, code });
}, { auth: false, admin: true });

route('POST', '/api/admin/invites/toggle', async (req, res, ctx) => {
  const code = normInvite(ctx.body.code);
  const r = await db.run('UPDATE invites SET active = ? WHERE code = ?', [ctx.body.active ? 1 : 0, code]);
  if (!(r && (r.changes == null || r.changes > 0))) return fail(res, 404, 'not_found');
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

route('POST', '/api/admin/invites/delete', async (req, res, ctx) => {
  await db.run('DELETE FROM invites WHERE code = ?', [normInvite(ctx.body.code)]);
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

route('POST', '/api/login', async (req, res, ctx) => {
  const code = normCode(ctx.body.code), pw = String(ctx.body.password || '');
  const bad = () => fail(res, 401, 'bad_credentials');
  if (!code || !pw || pw.length > 64) return bad();
  if (await limited('login:' + ctx.ip, 20, 10 * 60000) || await limited('login:' + code, 8, 10 * 60000)) return fail(res, 429, 'rate_limited');
  const u = await userByCode(code);
  const hash = await hashPw(pw, u ? u.pw_salt : 'x'.repeat(32));
  if (!u || !safeEq(hash, u.pw_hash)) return bad();
  { const mt = await maintState(); if (mt.on && !u.admin_char) return fail(res, 503, 'maintenance', { message: mt.msg }); }
  const token = crypto.randomBytes(32).toString('base64url');
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha256(token), u.id, Date.now() + SESSION_MS]);
  await db.run('UPDATE users SET intro_state = 2 WHERE id = ? AND intro_state = 1', [u.id]);   // 가입 후 첫 로그인
  send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(token, SESSION_MS / 1000) });
}, { auth: false });

route('POST', '/api/logout', async (req, res) => {
  const t = cookies(req).sid;
  if (t) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(t)]);
  send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
}, { auth: false });

route('GET', '/api/me', async (req, res, ctx) => {
  await catchUp();
  const u = await userById(ctx.user.id);
  send(res, 200, { user: publicUser(await withImage(u)), state: await buildState(u, Date.now()) });
});

route('GET', '/api/state', async (req, res, ctx) => {
  await catchUp();
  send(res, 200, await buildState(ctx.user, Date.now()));
});

// 헌터 커뮤니티: 읽기 전용 (글쓰기·댓글 기능 없음)
route('GET', '/api/board', async (req, res) => {
  await tickBoard();
  // 헌터 화면에는 최신 글 10개까지만 보여 주고, 1시간 안에 올라온 같은 제목·같은 내용의 글은 하나만 보여 줍니다.
  const rows = await db.all('SELECT id, who, title, body, tag, at FROM board_posts ORDER BY id DESC LIMIT 200');
  const norm = t => String(t || '').replace(/\s+/g, '');
  const posts = [];
  for (const r of rows) {
    const dup = posts.some(k => Math.abs(k.at - r.at) < G.HOUR && (norm(k.title) === norm(r.title) || norm(k.body) === norm(r.body)));
    if (!dup) posts.push(r);
    if (posts.length >= 10) break;
  }
  send(res, 200, { posts, latest: posts.length ? posts[0].id : 0 });
});

// ── 게이트웨이브: 헌터들끼리 쓰는 게시판 (글 올리기·삭제, 댓글 달기) ──
const GW_CATS = ['구해요', '정보', '사담'];
const GW_TITLE_MAX = 40, GW_BODY_MAX = 1000, GW_CMT_MAX = 200, GW_MEN_MAX = 5;
// @멘션: 글·댓글 안의 "@헌터이름" 중 '친구'인 헌터만 언급으로 저장합니다 (친구가 아니면 그냥 글자). 긴 이름부터 찾아 겹치지 않게 합니다.
async function gwSaveMentions(authorId, text, postId, commentId, now) {
  if (text.indexOf('@') < 0) return;
  const fr = await db.all('SELECT u.id, u.hunter_name AS hn FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ?', [authorId]);
  fr.sort((x, y) => y.hn.length - x.hn.length);
  let t = text; const ids = [];
  for (const f of fr) {
    const key = '@' + f.hn, i = t.indexOf(key);
    if (i < 0) continue;
    t = t.split(key).join(' '.repeat(key.length));
    ids.push(f.id);
    if (ids.length >= GW_MEN_MAX) break;
  }
  for (const id of ids) await db.run('INSERT INTO gw_mentions (target_id, by_id, post_id, comment_id, ts) VALUES (?, ?, ?, ?, ?)', [id, authorId, postId, commentId, now]);
}
route('GET', '/api/gw', async (req, res, ctx) => {
  const sp = new URL(req.url, 'http://x').searchParams, before = Math.max(0, Number(sp.get('before')) || 0);
  const fcat = GW_CATS.includes(sp.get('cat')) ? sp.get('cat') : '';
  const rows = await db.all(`SELECT p.id, p.user_id, p.title, p.body, p.ts, p.cat, u.hunter_name AS hn, u.rank AS rk, u.img_ver AS iv, (CASE WHEN LENGTH(u.thumb) > 0 THEN 1 ELSE 0 END) AS ht,
      (SELECT COUNT(*) FROM gw_comments c WHERE c.post_id = p.id) AS cc
    FROM gw_posts p LEFT JOIN users u ON u.id = p.user_id
    WHERE (? = 0 OR p.id < ?) AND (? = '' OR p.cat = ?) ORDER BY p.id DESC LIMIT 21`, [before, before, fcat, fcat]);
  const more = rows.length > 20;
  send(res, 200, { more, posts: rows.slice(0, 20).map(r => ({ id: r.id, cat: r.cat || '사담', title: r.title, preview: Array.from(r.body.replace(/\s+/g, ' ')).slice(0, 80).join(''),
    hn: r.hn || '(탈퇴한 헌터)', rank: r.rk || '', av: thumbUrl(r.user_id, r.iv, Number(r.ht) > 0), mine: r.user_id === ctx.user.id, cc: Number(r.cc) || 0, ts: r.ts })) });
});
route('GET', '/api/gw/post', async (req, res, ctx) => {
  const id = Number(new URL(req.url, 'http://x').searchParams.get('id')) || 0;
  const p = await db.get('SELECT p.id, p.user_id, p.title, p.body, p.ts, p.cat, u.hunter_name AS hn, u.rank AS rk, u.img_ver AS iv, (CASE WHEN LENGTH(u.thumb) > 0 THEN 1 ELSE 0 END) AS ht FROM gw_posts p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?', [id]);
  if (!p) return fail(res, 404, 'not_found');
  const cs = await db.all('SELECT c.id, c.user_id, c.body, c.ts, c.parent_id, c.reply_to, u.hunter_name AS hn, u.rank AS rk, u.img_ver AS iv, (CASE WHEN LENGTH(u.thumb) > 0 THEN 1 ELSE 0 END) AS ht FROM gw_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id ASC LIMIT 300', [id]);
  const lk = new Map((await db.all('SELECT comment_id AS cid, COUNT(*) AS n, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS mine FROM gw_likes WHERE comment_id IN (SELECT id FROM gw_comments WHERE post_id = ?) GROUP BY comment_id', [ctx.user.id, id])).map(r => [Number(r.cid), r]));
  const mod = !!ctx.user.admin_char;     // 관리자 전용 캐릭터는 모든 글과 댓글을 지울 수 있음
  const mrows = await db.all('SELECT m.comment_id AS cid, u.hunter_name AS hn FROM gw_mentions m JOIN users u ON u.id = m.target_id WHERE m.post_id = ?', [id]);
  const menOf = cid => mrows.filter(m => Number(m.cid) === cid).map(m => m.hn);
  send(res, 200, { post: { id: p.id, cat: p.cat || '사담', men: menOf(0), title: p.title, body: p.body, hn: p.hn || '(탈퇴한 헌터)', rank: p.rk || '', av: thumbUrl(p.user_id, p.iv, Number(p.ht) > 0), mine: p.user_id === ctx.user.id, canDel: mod || p.user_id === ctx.user.id, ts: p.ts },
    comments: cs.map(c => ({ id: c.id, men: menOf(Number(c.id)), parent: Number(c.parent_id) || 0, toHn: c.reply_to ? ((cs.find(x => x.id === Number(c.reply_to)) || {}).hn || '(삭제된 댓글)') : '', text: c.body, hn: c.hn || '(탈퇴한 헌터)', rank: c.rk || '', av: thumbUrl(c.user_id, c.iv, Number(c.ht) > 0), mine: c.user_id === ctx.user.id, canDel: mod || c.user_id === ctx.user.id, ts: c.ts, likes: Number((lk.get(c.id) || {}).n) || 0, liked: Number((lk.get(c.id) || {}).mine) > 0 })) });
});
// 게이트웨이브 알림 확인: 마지막으로 확인한 글/댓글 번호(p, c) 이후에 생긴 일을 종류별로 셉니다. (번호를 안 보내면 현재 번호만 알려줌)
route('GET', '/api/gw/notify', async (req, res, ctx) => {
  if (await limited('gwn:' + ctx.user.id, 40, 60000)) return fail(res, 429, 'rate_limited');
  const q = new URL(req.url, 'http://x').searchParams, me = ctx.user.id;
  const [mp, mc] = await Promise.all([db.get('SELECT MAX(id) AS m FROM gw_posts'), db.get('SELECT MAX(id) AS m FROM gw_comments')]);
  const mm = await db.get('SELECT MAX(id) AS m FROM gw_mentions');
  const out = { maxPost: Number(mp && mp.m) || 0, maxCmt: Number(mc && mc.m) || 0, maxMen: Number(mm && mm.m) || 0, posts: 0, postsBy: {}, comments: 0, replies: 0, mentions: 0 };
  if (q.get('p') === null || q.get('c') === null) return send(res, 200, out);
  if (q.get('m') !== null) {
    const am = Math.max(0, Number(q.get('m')) || 0);
    if (out.maxMen > am) out.mentions = Number((await db.get('SELECT COUNT(*) AS n FROM gw_mentions WHERE id > ? AND target_id = ?', [am, me])).n) || 0;
  }
  const ap = Math.max(0, Number(q.get('p')) || 0), ac = Math.max(0, Number(q.get('c')) || 0);
  if (out.maxPost > ap) {
    // 새 글은 카테고리별로 셉니다 (알림을 카테고리마다 따로 켜고 끌 수 있도록)
    for (const r of await db.all('SELECT cat, COUNT(*) AS n FROM gw_posts WHERE id > ? AND user_id != ? GROUP BY cat', [ap, me])) {
      const k = GW_CATS.includes(r.cat) ? r.cat : '사담';
      out.postsBy[k] = (out.postsBy[k] || 0) + (Number(r.n) || 0);
      out.posts += Number(r.n) || 0;
    }
  }
  if (out.maxCmt > ac) {
    // 나에게 달린 답글: 내 댓글에 답한 다른 사람의 글 / 내 글에 달린 댓글(위 답글은 제외)
    out.replies = Number((await db.get('SELECT COUNT(*) AS n FROM gw_comments c WHERE c.id > ? AND c.user_id != ? AND c.reply_to > 0 AND c.reply_to IN (SELECT id FROM gw_comments WHERE user_id = ?)', [ac, me, me])).n) || 0;
    out.comments = Number((await db.get(`SELECT COUNT(*) AS n FROM gw_comments c JOIN gw_posts p ON p.id = c.post_id WHERE c.id > ? AND c.user_id != ? AND p.user_id = ?
      AND NOT (c.reply_to > 0 AND c.reply_to IN (SELECT id FROM gw_comments WHERE user_id = ?))`, [ac, me, me, me])).n) || 0;
  }
  send(res, 200, out);
});
// 알림 벨 목록: 최근에 나와 관계된 일(새 글 / 내 글에 댓글 / 나에게 답글 / 나를 태그) 최대 40건. 읽음 표시는 기기(브라우저)에 저장합니다.
route('GET', '/api/gw/alerts', async (req, res, ctx) => {
  if (await limited('gwa:' + ctx.user.id, 40, 60000)) return fail(res, 429, 'rate_limited');
  const me = ctx.user.id, snip = t => Array.from(String(t).replace(/\s+/g, ' ')).slice(0, 40).join('');
  const [ps, cs, rs, ms] = await Promise.all([
    db.all('SELECT p.id, p.ts, p.cat, p.title AS tx, u.hunter_name AS hn, u.rank AS rk FROM gw_posts p JOIN users u ON u.id = p.user_id WHERE p.user_id != ? ORDER BY p.id DESC LIMIT 15', [me]),
    db.all(`SELECT c.id, c.ts, c.body AS tx, c.post_id AS pid, u.hunter_name AS hn, u.rank AS rk FROM gw_comments c JOIN gw_posts p ON p.id = c.post_id JOIN users u ON u.id = c.user_id
      WHERE c.user_id != ? AND p.user_id = ? AND NOT (c.reply_to > 0 AND c.reply_to IN (SELECT id FROM gw_comments WHERE user_id = ?)) ORDER BY c.id DESC LIMIT 15`, [me, me, me]),
    db.all(`SELECT c.id, c.ts, c.body AS tx, c.post_id AS pid, u.hunter_name AS hn, u.rank AS rk FROM gw_comments c JOIN users u ON u.id = c.user_id
      WHERE c.user_id != ? AND c.reply_to > 0 AND c.reply_to IN (SELECT id FROM gw_comments WHERE user_id = ?) ORDER BY c.id DESC LIMIT 15`, [me, me]),
    db.all(`SELECT m.id, m.ts, m.post_id AS pid, m.comment_id AS cid, u.hunter_name AS hn, u.rank AS rk,
        COALESCE((SELECT body FROM gw_comments WHERE id = m.comment_id), (SELECT title FROM gw_posts WHERE id = m.post_id), '') AS tx
      FROM gw_mentions m JOIN users u ON u.id = m.by_id WHERE m.target_id = ? ORDER BY m.id DESC LIMIT 15`, [me]),
  ]);
  const al = [];
  ps.forEach(r => al.push({ key: 'p' + r.id, kind: 'post', cat: GW_CATS.includes(r.cat) ? r.cat : '사담', hn: r.hn, rank: r.rk, text: snip(r.tx), post: r.id, ts: r.ts }));
  cs.forEach(r => al.push({ key: 'c' + r.id, kind: 'cmt', hn: r.hn, rank: r.rk, text: snip(r.tx), post: r.pid, ts: r.ts }));
  rs.forEach(r => al.push({ key: 'r' + r.id, kind: 'rep', hn: r.hn, rank: r.rk, text: snip(r.tx), post: r.pid, ts: r.ts }));
  ms.forEach(r => al.push({ key: 'm' + r.id, kind: 'men', hn: r.hn, rank: r.rk, text: snip(r.tx), post: r.pid, ts: r.ts, inCmt: Number(r.cid) > 0 }));
  al.sort((x, y) => y.ts - x.ts);
  send(res, 200, { alerts: al.slice(0, 40) });
});
// 게이트웨이브 간단 프로필: 글/댓글 번호로 작성자를 찾아 보여줍니다 (헌터 코드는 내려주지 않음).
// 친구가 아닌 헌터에게는 현재 위치를 숨기고, 비공개 유저는 이름·등급·이미지만 보여줍니다.
route('GET', '/api/gw/profile', async (req, res, ctx) => {
  if (await limited('gwpf:' + ctx.user.id, 60, 60000)) return fail(res, 429, 'rate_limited');
  const q = new URL(req.url, 'http://x').searchParams, pid = Number(q.get('post')) || 0, cid = Number(q.get('comment')) || 0;
  const row = cid ? await db.get('SELECT user_id FROM gw_comments WHERE id = ?', [cid]) : pid ? await db.get('SELECT user_id FROM gw_posts WHERE id = ?', [pid]) : null;
  const f = row ? await userById(row.user_id) : null;
  if (!f) return fail(res, 404, 'not_found');
  const me = f.id === ctx.user.id, fr = me || await isFriend(ctx.user.id, f.id);
  const base = { hn: f.hunter_name, rank: f.rank, image: imgUrl(f.id, f.img_ver), friend: fr, me };
  if (f.is_private && !me && !fr) return send(res, 200, { profile: Object.assign(base, { priv: true, bio: '', pins: [], traits: [], ach: null }) });
  await syncAchEarned(f, Date.now(), true);
  const a = await db.get(`SELECT a.name, a.descr, e.at FROM ach_earned e JOIN achievements a ON a.id = e.ach_id
    WHERE e.user_id = ? ORDER BY e.at DESC, e.rowid DESC LIMIT 1`, [f.id]);
  send(res, 200, { profile: Object.assign(base, { region: fr ? G.placeLong(f.region) : null, ach: a ? { name: a.name, desc: a.descr, at: a.at } : null,
    bio: f.bio || '', pins: pinnedList(f, await loadAch()).map(p => p.name), traits: traitsOf((await withText(f)).traits) }) });
});
route('POST', '/api/gw/post', async (req, res, ctx) => {
  if (await limited('gwp:' + ctx.user.id, 10, G.HOUR)) return fail(res, 429, 'rate_limited');
  const title = String(ctx.body.title == null ? '' : ctx.body.title).trim(), text = String(ctx.body.text == null ? '' : ctx.body.text).trim();
  if (!title || cp(title) > GW_TITLE_MAX) return fail(res, 400, 'bad_title');
  if (!text || cp(text) > GW_BODY_MAX) return fail(res, 400, 'bad_text');
  const cat = ctx.body.cat == null || ctx.body.cat === '' ? '사담' : String(ctx.body.cat);      // 카테고리를 안 보내는 예전 화면에서 온 글은 사담으로
  if (!GW_CATS.includes(cat)) return fail(res, 400, 'bad_cat');
  const now = Date.now();
  const r = await db.run('INSERT INTO gw_posts (user_id, title, body, ts, cat) VALUES (?, ?, ?, ?, ?)', [ctx.user.id, title, text, now, cat]);
  await gwSaveMentions(ctx.user.id, text, r.lastId, 0, now).catch(() => {});
  send(res, 201, { id: r.lastId });
});
route('POST', '/api/gw/post/delete', async (req, res, ctx) => {
  const id = Number(ctx.body.id) || 0;
  const p = ctx.user.admin_char ? await db.get('SELECT id FROM gw_posts WHERE id = ?', [id]) : await db.get('SELECT id FROM gw_posts WHERE id = ? AND user_id = ?', [id, ctx.user.id]);
  if (!p) return fail(res, 404, 'not_found');           // 본인 글만 지울 수 있음 (관리자 전용 캐릭터는 모두 가능)
  await db.batch([['DELETE FROM gw_mentions WHERE post_id = ?', [id]], ['DELETE FROM gw_likes WHERE comment_id IN (SELECT id FROM gw_comments WHERE post_id = ?)', [id]], ['DELETE FROM gw_comments WHERE post_id = ?', [id]], ['DELETE FROM gw_posts WHERE id = ?', [id]]]);
  send(res, 200, { ok: true });
});
route('POST', '/api/gw/comment/delete', async (req, res, ctx) => {
  const id = Number(ctx.body.id) || 0;
  const c = ctx.user.admin_char ? await db.get('SELECT id FROM gw_comments WHERE id = ?', [id]) : await db.get('SELECT id FROM gw_comments WHERE id = ? AND user_id = ?', [id, ctx.user.id]);
  if (!c) return fail(res, 404, 'not_found');
  await db.batch([['DELETE FROM gw_mentions WHERE comment_id = ? OR comment_id IN (SELECT id FROM gw_comments WHERE parent_id = ?)', [id, id]], ['DELETE FROM gw_likes WHERE comment_id = ? OR comment_id IN (SELECT id FROM gw_comments WHERE parent_id = ?)', [id, id]], ['DELETE FROM gw_comments WHERE parent_id = ?', [id]], ['DELETE FROM gw_comments WHERE id = ?', [id]]]);      // 댓글을 지우면 그 아래 대댓글도 함께 지워집니다
  send(res, 200, { ok: true });
});
// 댓글·대댓글 좋아요: 누르면 켜지고, 다시 누르면 취소됩니다 (한 사람이 한 댓글에 한 번)
route('POST', '/api/gw/comment/like', async (req, res, ctx) => {
  if (await limited('gwl:' + ctx.user.id, 60, 60000)) return fail(res, 429, 'rate_limited');
  const id = Number(ctx.body.id) || 0;
  if (!(await db.get('SELECT id FROM gw_comments WHERE id = ?', [id]))) return fail(res, 404, 'not_found');
  const ins = await db.run('INSERT OR IGNORE INTO gw_likes (comment_id, user_id) VALUES (?, ?)', [id, ctx.user.id]);
  if (ins.changes !== 1) await db.run('DELETE FROM gw_likes WHERE comment_id = ? AND user_id = ?', [id, ctx.user.id]);
  const n = Number((await db.get('SELECT COUNT(*) AS n FROM gw_likes WHERE comment_id = ?', [id])).n) || 0;
  send(res, 200, { ok: true, liked: ins.changes === 1, likes: n });
});
route('POST', '/api/gw/comment', async (req, res, ctx) => {
  if (await limited('gwc:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  const id = Number(ctx.body.id) || 0, text = String(ctx.body.text == null ? '' : ctx.body.text).trim();
  if (!text || cp(text) > GW_CMT_MAX) return fail(res, 400, 'bad_text');
  if (!(await db.get('SELECT id FROM gw_posts WHERE id = ?', [id]))) return fail(res, 404, 'not_found');
  // 대댓글: parent 는 같은 글의 댓글이어야 합니다. 대댓글에 다시 답하면 맨 위 댓글 아래에 붙고, 누구에게 답했는지만 남깁니다(1단계).
  let parent = 0, replyTo = 0;
  const pid = Number(ctx.body.parent) || 0;
  if (pid) {
    const t = await db.get('SELECT id, post_id, parent_id FROM gw_comments WHERE id = ?', [pid]);
    if (!t || Number(t.post_id) !== id) return fail(res, 404, 'no_parent');
    parent = Number(t.parent_id) || t.id; replyTo = t.id;
  }
  const now = Date.now();
  const r = await db.run('INSERT INTO gw_comments (post_id, user_id, body, ts, parent_id, reply_to) VALUES (?, ?, ?, ?, ?, ?)', [id, ctx.user.id, text, now, parent, replyTo]);
  await gwSaveMentions(ctx.user.id, text, id, r.lastId, now).catch(() => {});
  send(res, 201, { id: r.lastId });
});

// ── 선물하기: 친구에게 아이템이나 골드를 보냅니다 (받은 사람은 인벤토리에서 확인) ──
const GIFT_GOLD_MAX = 99999999;
route('POST', '/api/gifts/send', async (req, res, ctx) => {
  const u = ctx.user, now = Date.now();
  if (await limited('gift:' + u.id, 20, G.HOUR)) return fail(res, 429, 'rate_limited');
  if (corruptLock(u, now)) return fail(res, 409, 'corrupted', { until: u.corrupt_until });
  const kind = ctx.body.kind, qty = Number(ctx.body.qty);
  if (kind !== 'item' && kind !== 'gold') return fail(res, 400, 'bad_kind');
  if (!Number.isInteger(qty) || qty < 1 || qty > (kind === 'gold' ? 9999999 : 9999)) return fail(res, 400, 'bad_qty');
  const f = await userByCode(normCode(ctx.body.to));
  if (!f) return fail(res, 404, 'not_found');
  if (f.id === u.id) return fail(res, 400, 'self');
  if (!(await isFriend(u.id, f.id))) return fail(res, 403, 'not_friend');      // 친구에게만 선물할 수 있음
  if (kind === 'gold') {
    if ((Number(f.gold) || 0) + qty > GIFT_GOLD_MAX) return fail(res, 409, 'max_gold');
    const dec = await db.run('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?', [qty, u.id, qty]);
    if (dec.changes !== 1) return fail(res, 409, 'no_gold');
    let add;
    try { add = await db.run('UPDATE users SET gold = gold + ? WHERE id = ?', [qty, f.id]); }
    catch (e) { await db.run('UPDATE users SET gold = gold + ? WHERE id = ?', [qty, u.id]); throw e; }
    if (add.changes !== 1) { await db.run('UPDATE users SET gold = gold + ? WHERE id = ?', [qty, u.id]); return fail(res, 404, 'not_found'); }
    await db.run('INSERT INTO gifts (from_id, to_id, kind, item, qty, ts) VALUES (?, ?, ?, ?, ?, ?)', [u.id, f.id, 'gold', '', qty, now]);
    await logAcquire(f.id, 'gold', '골드', qty, '선물 (' + u.hunter_name + ')', now);
    return send(res, 200, { ok: true, kind, to: f.hunter_name, qty });
  }
  const item = String(ctx.body.item == null ? '' : ctx.body.item);
  if (!item || cp(item) > 30) return fail(res, 400, 'bad_item');
  const have = await db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [f.id, item]);
  if ((have ? Number(have.qty) : 0) + qty > 9999) return fail(res, 409, 'max_qty');
  const dec = await db.run('UPDATE inventory SET qty = qty - ? WHERE user_id = ? AND item = ? AND qty >= ?', [qty, u.id, item, qty]);
  if (dec.changes !== 1) return fail(res, 404, 'no_item');
  const restore = () => db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + excluded.qty)', [u.id, item, qty]);
  try { await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + excluded.qty)', [f.id, item, qty]); }
  catch (e) { await restore(); throw e; }
  await db.run('DELETE FROM inventory WHERE user_id = ? AND item = ? AND qty <= 0', [u.id, item]);
  await db.run('INSERT INTO gifts (from_id, to_id, kind, item, qty, ts) VALUES (?, ?, ?, ?, ?, ?)', [u.id, f.id, 'item', item, qty, now]);
  if (item === EV.EMBER) await EV.lossLog(u.id, qty, '선물 보냄 (→ ' + f.hunter_name + ')', now);
  await logAcquire(f.id, 'item', item, qty, '선물 (' + u.hunter_name + ')', now);
  send(res, 200, { ok: true, kind, to: f.hunter_name, item, qty });
});
// ── 적월문 조사: 안쪽 지역 풍경의 '!' (지역마다 3~5개) 를 눌러 재료를 찾습니다. '!' 하나를 조사하면 그 '!' 는 3시간 동안 사라집니다. ──
const SURVEY_CD = 3 * G.HOUR;
route('GET', '/api/survey', async (req, res, ctx) => {
  const rows = await db.all('SELECT region, idx, at FROM survey_marks WHERE user_id = ?', [ctx.user.id]);
  const now = Date.now(), marks = {};
  for (const rg of Object.keys(G.SV_MARKS)) marks[rg] = Array.from({ length: G.SV_MARKS[rg] }, () => 0);
  for (const r of rows) {
    if (marks[r.region] && r.idx >= 0 && r.idx < marks[r.region].length && Number(r.at) + SURVEY_CD > now) marks[r.region][r.idx] = Number(r.at) + SURVEY_CD;
  }
  send(res, 200, { now, marks });
});
function pickMaterial(region) {
  const ws = G.MATERIALS.map(m => (m.at[region] || 0) * m.w + (m.at[region] === undefined ? (m.name === '적월석 가루' ? 0.6 : 0.15) : 0));
  const tot = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * tot, k = 0;
  while (k < ws.length - 1 && r > ws[k]) { r -= ws[k]; k++; }
  return G.MATERIALS[k];
}
route('POST', '/api/survey', async (req, res, ctx) => {
  if (await limited('survey:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  const now = Date.now();
  const cur = await userById(ctx.user.id);
  if (G.countryOf(cur.region) !== 'GT') return fail(res, 409, 'not_here');                 // 적월문 안쪽에서만 조사할 수 있음
  if (corruptLock(cur, now)) return fail(res, 409, 'corrupted', { until: cur.corrupt_until });
  const region = cur.region, idx = Number(ctx.body.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= (G.SV_MARKS[region] || 0)) return fail(res, 400, 'bad_mark');
  // 쿨다운 확인과 시작 시각 기록을 한 문장으로 처리해, 동시에 눌러도 한 번만 성공합니다.
  const prev = await db.get('SELECT at FROM survey_marks WHERE user_id = ? AND region = ? AND idx = ?', [cur.id, region, idx]);
  const prevAt = prev ? Number(prev.at) : 0;
  if (!prev) await db.run('INSERT INTO survey_marks (user_id, region, idx, at) VALUES (?, ?, ?, 0) ON CONFLICT(user_id, region, idx) DO NOTHING', [cur.id, region, idx]);
  const mark = await db.run('UPDATE survey_marks SET at = ? WHERE user_id = ? AND region = ? AND idx = ? AND at <= ?', [now, cur.id, region, idx, now - SURVEY_CD]);
  if (mark.changes !== 1) {
    const f = await db.get('SELECT at FROM survey_marks WHERE user_id = ? AND region = ? AND idx = ?', [cur.id, region, idx]);
    return fail(res, 429, 'cooldown', { until: (f ? Number(f.at) : 0) + SURVEY_CD, now });
  }
  await questProg(cur, 'survey', 1);
  try {
    // 대부분 이 지역의 재료를 찾고, 가끔 상점 아이템이나 골드를 찾습니다.
    let pick = null, qty = 1;
    const roll = Math.random();
    if (roll < 0.88) {
      pick = pickMaterial(region).name;
      qty = G.rnd(1, 100) <= 25 ? 2 : 1;
    } else if (roll < 0.94) {
      const items = await db.all('SELECT name FROM shop_items');
      if (items.length) pick = items[G.rnd(0, items.length - 1)].name;
    }
    if (pick) {
      const have = await db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [cur.id, pick]);
      if (have && Number(have.qty) >= 9999) pick = null;       // 가득 찬 아이템이면 골드로 대신 줍니다
    }
    if (pick) {
      await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + excluded.qty)', [cur.id, pick, qty]);
      await logAcquire(cur.id, 'item', pick, qty, '적월문 조사', now);
      return send(res, 200, { kind: 'item', item: pick, qty, until: now + SURVEY_CD, idx });
    }
    const gold = G.rnd(30, 120);
    await grantGold(cur.id, gold);
    await logAcquire(cur.id, 'gold', '골드', gold, '적월문 조사', now);
    send(res, 200, { kind: 'gold', qty: gold, until: now + SURVEY_CD, idx });
  } catch (e) {
    await db.run('UPDATE survey_marks SET at = ? WHERE user_id = ? AND region = ? AND idx = ? AND at = ?', [prevAt, cur.id, region, idx, now]);   // 실패하면 쿨다운을 되돌립니다
    throw e;
  }
});
// ═════════════ 일일 계약 의뢰 ═════════════
// 하루(한국 시간 0시 기준)에 3개. 토벌·조사·탐험을 하면 자동으로 진행되고, 완료하면 의뢰 앱에서 보상을 받습니다.
const QRANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
const kstDay = now => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
const questText = q => q.kind === 'kill' ? '몬스터 ' + q.need + '마리 처치'
  : q.kind === 'killr' ? QRANKS[q.arg] + '급 이상 몬스터 ' + q.need + '마리 처치'
  : q.kind === 'survey' ? '적월문에서 ' + q.need + '번 조사하기'
  : '적월문 심층 탐험으로 ' + q.need + '개 층 내려가기';
async function ensureQuests(u, now) {
  const day = kstDay(now);
  const have = await db.get('SELECT COUNT(*) AS c FROM daily_quests WHERE user_id = ? AND day = ?', [u.id, day]);
  if (Number(have.c) >= 3) return day;
  const ri = Math.max(0, QRANKS.indexOf(u.rank));
  const minR = Math.min(5, Math.max(1, ri - 1));
  const third = G.rnd(0, 1) ? ['survey', 0, G.rnd(3, 5)] : ['floor', 0, G.rnd(2, 4)];
  const defs = [
    [0, 'kill', 0, 3 + ri, 80 + ri * 50, 8 + ri * 5],
    [1, 'killr', minR, 2 + Math.floor(ri / 2), 120 + ri * 70, 12 + ri * 7],
    [2, third[0], third[1], third[2], 100 + ri * 60, 10 + ri * 6],
  ];
  for (const d of defs) {
    await db.run('INSERT INTO daily_quests (user_id, day, slot, kind, arg, need, gold, exp) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, day, slot) DO NOTHING',
      [u.id, day, d[0], d[1], d[2], d[3], d[4], d[5]]);
  }
  return day;
}
// kind: 'kill'(rankIdx 필요) | 'survey' | 'floor'
async function questProg(u, kind, n, rankIdx) {
  try {
    const day = await ensureQuests(u, Date.now());
    if (kind === 'kill') await db.run("UPDATE daily_quests SET prog = MIN(need, prog + ?) WHERE user_id = ? AND day = ? AND claimed = 0 AND (kind = 'kill' OR (kind = 'killr' AND arg <= ?))", [n, u.id, day, rankIdx]);
    else await db.run('UPDATE daily_quests SET prog = MIN(need, prog + ?) WHERE user_id = ? AND day = ? AND claimed = 0 AND kind = ?', [n, u.id, day, kind]);
  } catch (e) { if (process.env.DEBUG_QUEST) console.error("questProg", e); }
}
route('GET', '/api/quests', async (req, res, ctx) => {
  const u = await userById(ctx.user.id), now = Date.now();
  const day = await ensureQuests(u, now);
  const rows = await db.all('SELECT slot, kind, arg, need, prog, gold, exp, claimed FROM daily_quests WHERE user_id = ? AND day = ? ORDER BY slot', [u.id, day]);
  const left = 24 * 3600000 - ((now + 9 * 3600000) % (24 * 3600000));
  send(res, 200, { resetIn: left, quests: rows.map(q => ({ slot: q.slot, text: questText(q), need: q.need, prog: q.prog, gold: q.gold, exp: q.exp, claimed: !!q.claimed })) });
});
route('POST', '/api/quests/claim', async (req, res, ctx) => {
  const u = await userById(ctx.user.id), now = Date.now(), slot = Number(ctx.body.slot);
  if (!Number.isInteger(slot)) return fail(res, 400, 'bad_slot');
  const day = kstDay(now);
  const q = await db.get('SELECT gold, exp, kind, arg, need FROM daily_quests WHERE user_id = ? AND day = ? AND slot = ?', [u.id, day, slot]);
  if (!q) return fail(res, 404, 'no_quest');
  const c = await db.run('UPDATE daily_quests SET claimed = 1 WHERE user_id = ? AND day = ? AND slot = ? AND claimed = 0 AND prog >= need', [u.id, day, slot]);
  if (c.changes !== 1) return fail(res, 409, 'not_ready');
  const g = await grantExp(u.id, q.exp);
  await grantGold(u.id, q.gold);
  await logAcquire(u.id, 'exp', '경험치', q.exp, '일일 의뢰', now);
  await logAcquire(u.id, 'gold', '골드', q.gold, '일일 의뢰', now);
  send(res, 200, { ok: true, gold: q.gold, exp: q.exp, levelUp: !!(g && g.up) });
});

// ═════════════ 그림자 거래소 ═════════════
// 헌터끼리 익명으로 아이템을 사고파는 암시장. 판매자는 이름이 드러나지 않고, 팔리면 수수료 10%를 뗀 골드를 받습니다. 24시간 안에 안 팔리면 아이템이 돌아옵니다.
// 그림자 거래를 하는 구매자는 흔적(오염도 +2%)이 남습니다.
const EXC = { fee: 0.10, maxListings: 8, ms: 24 * 3600000, buyTaint: 2, maxPrice: 9999999 };
const giveItem = (uid, item, qty) => db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + excluded.qty)', [uid, item, qty]);
// [EVENT:HALLOWEEN] 이벤트 모듈 연결 (끄려면 관리자 페이지에서 '끄기' — 코드 수정 불필요)
const EV = EVT.install({ db, G, route, send, fail, limited, userById, grantGold, logAcquire, giveItem, isFriend, userByCode, normCode, applyItemEffect, achReset: () => { achCache.defs = null; } });
require('./_qna').install({ db, route, send, fail, limited });      // Q&A (관리자가 올리고 헌터가 읽음)
require('./_sysmsg').install({ db, route, send, fail });      // 시스템 팝업 (관리자 → 전체 헌터)
let lastExcSweep = 0;
async function sweepExchange(force) {
  const now = Date.now();
  if (!force && now - lastExcSweep < 30000) return;
  lastExcSweep = now;
  const old = await db.all('SELECT id, seller_id, item, qty FROM exchange WHERE ends <= ? LIMIT 50', [now]);
  for (const x of old) {
    const d = await db.run('DELETE FROM exchange WHERE id = ? AND ends <= ?', [x.id, now]);
    if (d.changes === 1) await giveItem(x.seller_id, x.item, x.qty);          // 안 팔린 아이템은 판매자에게 돌아감
  }
}
route('GET', '/api/exchange', async (req, res, ctx) => {
  await sweepExchange();
  const now = Date.now(), uid = ctx.user.id;
  const rows = await db.all('SELECT id, seller_id, item, qty, price, ends FROM exchange WHERE ends > ? ORDER BY id DESC LIMIT 80', [now]);
  const inv = await db.all('SELECT item, qty FROM inventory WHERE user_id = ? AND qty > 0 ORDER BY item', [uid]);
  const me = await db.get('SELECT gold FROM users WHERE id = ?', [uid]);
  const tu = await db.get('SELECT stats FROM users WHERE id = ?', [uid]);
  send(res, 200, { gold: me.gold, taint: Number(JSON.parse(tu.stats).taint) || 0, fee: EXC.fee, maxListings: EXC.maxListings, buyTaint: EXC.buyTaint, hours: EXC.ms / 3600000,
    market: rows.filter(r => r.seller_id !== uid).map(r => ({ id: r.id, item: r.item, qty: r.qty, price: r.price, endsIn: r.ends - now })),
    mine: rows.filter(r => r.seller_id === uid).map(r => ({ id: r.id, item: r.item, qty: r.qty, price: r.price, endsIn: r.ends - now })),
    sellable: inv.map(r => ({ item: r.item, qty: Number(r.qty) })) });
});
route('POST', '/api/exchange/list', async (req, res, ctx) => {
  if (await limited('exl:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  const now = Date.now(), uid = ctx.user.id, cur = await userById(uid);
  if (corruptLock(cur, now)) return fail(res, 409, 'corrupted', { until: cur.corrupt_until });
  const item = String(ctx.body.item == null ? '' : ctx.body.item), qty = Number(ctx.body.qty), price = Number(ctx.body.price);
  if (!item || !Number.isInteger(qty) || qty < 1 || qty > 9999) return fail(res, 400, 'bad_qty');
  if (!Number.isInteger(price) || price < 1 || price > EXC.maxPrice) return fail(res, 400, 'bad_price');
  const cnt = await db.get('SELECT COUNT(*) AS c FROM exchange WHERE seller_id = ? AND ends > ?', [uid, now]);
  if (Number(cnt.c) >= EXC.maxListings) return fail(res, 409, 'too_many');
  const dec = await db.run('UPDATE inventory SET qty = qty - ? WHERE user_id = ? AND item = ? AND qty >= ?', [qty, uid, item, qty]);
  if (dec.changes !== 1) return fail(res, 404, 'no_item');
  await db.run('DELETE FROM inventory WHERE user_id = ? AND qty <= 0', [uid]);
  try { await db.run('INSERT INTO exchange (seller_id, item, qty, price, at, ends) VALUES (?, ?, ?, ?, ?, ?)', [uid, item, qty, price, now, now + EXC.ms]); }
  catch (e) { await giveItem(uid, item, qty); throw e; }
  if (item === EV.EMBER) await EV.lossLog(uid, qty, '거래소 등록', now);
  send(res, 200, { ok: true });
});
route('POST', '/api/exchange/cancel', async (req, res, ctx) => {
  const x = await db.get('SELECT id, item, qty FROM exchange WHERE id = ? AND seller_id = ?', [Number(ctx.body.id) || 0, ctx.user.id]);
  if (!x) return fail(res, 404, 'no_listing');
  const d = await db.run('DELETE FROM exchange WHERE id = ? AND seller_id = ?', [x.id, ctx.user.id]);
  if (d.changes !== 1) return fail(res, 409, 'busy');
  await giveItem(ctx.user.id, x.item, x.qty);
  send(res, 200, { ok: true });
});
route('POST', '/api/exchange/buy', async (req, res, ctx) => {
  if (await limited('exb:' + ctx.user.id, 40, 60000)) return fail(res, 429, 'rate_limited');
  const now = Date.now(), uid = ctx.user.id, cur = await userById(uid);
  if (corruptLock(cur, now)) return fail(res, 409, 'corrupted', { until: cur.corrupt_until });
  const x = await db.get('SELECT id, seller_id, item, qty, price, at, ends FROM exchange WHERE id = ?', [Number(ctx.body.id) || 0]);
  if (!x || x.ends <= now) return fail(res, 404, 'no_listing');
  if (x.seller_id === uid) return fail(res, 409, 'own');
  const have = await db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [uid, x.item]);
  if (have && Number(have.qty) + x.qty > 9999) return fail(res, 409, 'max_qty');
  const pay = await db.run('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?', [x.price, uid, x.price]);
  if (pay.changes !== 1) return fail(res, 402, 'no_gold', { price: x.price });
  const claim = await db.run('DELETE FROM exchange WHERE id = ? AND ends > ?', [x.id, now]);
  if (claim.changes !== 1) { await grantGold(uid, x.price); return fail(res, 409, 'sold'); }       // 그 사이 다른 사람이 샀음
  await giveItem(uid, x.item, x.qty);
  const fee = Math.floor(x.price * EXC.fee), got = x.price - fee;
  await grantGold(x.seller_id, got);
  await logAcquire(uid, 'item', x.item, x.qty, '그림자 거래소 (-' + x.price + ' G)', now);
  await logAcquire(x.seller_id, 'gold', '골드', got, '그림자 거래소 판매: ' + x.item + ' ×' + x.qty, now);
  const taintNow = await grantTaint(uid, EXC.buyTaint);
  send(res, 200, { ok: true, item: x.item, qty: x.qty, price: x.price, taint: EXC.buyTaint, taintNow });
});

// ═════════════ 오염 거래 (계약) ═════════════
// 오염도를 대가로 보상을 받는 계약. 계약마다 하루(한국 시간 0시 기준)에 한 번. 오염도가 100이 되면 몬스터가 되므로, 그렇게 될 계약은 확인을 한 번 더 받습니다.
const pactReward = p => p.gold ? { kind: 'gold', text: '골드 +' + p.gold + ' G' } : p.exp ? { kind: 'exp', text: '경험치 +' + p.exp }
  : p.fame ? { kind: 'fame', text: '명성 +' + p.fame } : p.stat ? { kind: 'stat', text: ({ str: '근력', agi: '민첩', luck: '행운' })[p.stat] + ' +' + p.amt } : { kind: 'item', text: p.item + ' ×' + p.qty };
route('GET', '/api/pact', async (req, res, ctx) => {
  const u = await userById(ctx.user.id), now = Date.now(), day = kstDay(now);
  const done = new Set((await db.all('SELECT pid FROM pact_log WHERE user_id = ? AND day = ?', [u.id, day])).map(r => r.pid));
  const left = 24 * 3600000 - ((now + 9 * 3600000) % (24 * 3600000));
  send(res, 200, { taint: Number(JSON.parse(u.stats).taint) || 0, resetIn: left, backlash: G.PACT_BACKLASH, backlashTaint: G.PACT_BACKLASH_TAINT,
    pacts: G.PACTS.map(p => ({ id: p.id, name: p.name, desc: p.desc, taint: p.taint, reward: pactReward(p).text, done: done.has(p.id) })) });
});
route('POST', '/api/pact/sign', async (req, res, ctx) => {
  if (await limited('pact:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  const now = Date.now(), cur = await userById(ctx.user.id), day = kstDay(now);
  const p = G.PACTS.find(x => x.id === String(ctx.body.id || ''));
  if (!p) return fail(res, 404, 'no_pact');
  if (corruptLock(cur, now)) return fail(res, 409, 'corrupted', { until: cur.corrupt_until });
  const t0 = Number(JSON.parse(cur.stats).taint) || 0;
  if (t0 >= 100) return fail(res, 409, 'tainted');
  if (t0 + p.taint >= 100 && ctx.body.confirm !== true) return fail(res, 409, 'will_corrupt', { taint: t0, add: p.taint });
  const ins = await db.run('INSERT OR IGNORE INTO pact_log (user_id, day, pid, at) VALUES (?, ?, ?, ?)', [cur.id, day, p.id, now]);
  if (ins.changes !== 1) return fail(res, 409, 'already_done');
  let levelUp = false;
  if (p.gold) { await grantGold(cur.id, p.gold); await logAcquire(cur.id, 'gold', '골드', p.gold, '오염 거래: ' + p.name, now); }
  if (p.exp) { const g = await grantExp(cur.id, p.exp); levelUp = !!(g && g.up); await logAcquire(cur.id, 'exp', '경험치', p.exp, '오염 거래: ' + p.name, now); }
  if (p.fame) await grantFame(cur.id, p.fame);
  if (p.stat) await applyItemEffect(cur.id, p.stat, p.amt, now);
  if (p.item) {
    await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + excluded.qty)', [cur.id, p.item, p.qty]);
    await logAcquire(cur.id, 'item', p.item, p.qty, '오염 거래: ' + p.name, now);
  }
  const backlash = G.chance01() < G.PACT_BACKLASH;
  const add = p.taint + (backlash ? G.PACT_BACKLASH_TAINT : 0);
  const taintNow = await grantTaint(cur.id, add);
  const fresh = await userById(cur.id);
  send(res, 200, { ok: true, name: p.name, reward: pactReward(p).text, taint: add, backlash, taintNow, levelUp, corrupted: !!fresh.corrupt_flag });
});

// ═════════════ 도시 괴담 소문 ═════════════
// 시민들 사이에 괴담 소문이 돕니다. 헌터들이 '믿는다 / 의심한다'로 표를 던지고, 한쪽이 RUMOR_NEED 명에 이르면 진실이 가려집니다.
//  · 믿는 쪽이 이기고 진짜 → 그 지역에 괴담 몬스터가 실제로 나타남 (30분, 누구나 토벌 가능). 믿은 사람은 보상.
//  · 믿는 쪽이 이기고 거짓 → 헛소문. 믿은 사람은 골드를 잃고, 의심한 사람은 보상.
//  · 의심하는 쪽이 이기고 거짓 → 의심한 사람 보상. 진짜였다면 소문은 묻히고 아무 일도 없음.
//  · 아무도 결론을 못 내고 6시간이 지나면 잊혀짐.
const rumorPlace = r => G.placeLong(r.region);
let lastRumorTick = 0;
async function tickRumors() {
  const now = Date.now();
  if (now - lastRumorTick < 20000) return;
  lastRumorTick = now;
  await db.run("DELETE FROM rumor_votes WHERE rumor_id IN (SELECT id FROM rumors WHERE status <> 'open' AND resolved > 0 AND resolved < ?)", [now - 7 * 24 * 3600000]);
  await db.run("DELETE FROM rumors WHERE status <> 'open' AND resolved > 0 AND resolved < ?", [now - 7 * 24 * 3600000]);
  const old = await db.all("SELECT id FROM rumors WHERE status = 'open' AND ends <= ? LIMIT 20", [now]);
  for (const o of old) await db.run("UPDATE rumors SET status = 'faded', resolved = ? WHERE id = ? AND status = 'open'", [now, o.id]);
  const open = await db.get("SELECT COUNT(*) AS c FROM rumors WHERE status = 'open'");
  if (Number(open.c) >= G.RUMOR_MAX_OPEN) return;
  const row = await db.get("SELECT next_at FROM spawn_state WHERE tier = 'rumor'");
  if (!row) await db.run("INSERT OR IGNORE INTO spawn_state (tier, next_at) VALUES ('rumor', 0)");
  const from = row ? row.next_at : 0;
  if (from > now) return;
  const claim = await db.run("UPDATE spawn_state SET next_at = ? WHERE tier = 'rumor' AND next_at = ?", [now + G.RUMOR_GAP_MS + G.rnd(0, 30) * G.MIN, from]);
  if (claim.changes !== 1) return;
  await makeRumor(now);
}
async function makeRumor(now, forceTruth) {
  const live = await db.all("SELECT tpl FROM rumors WHERE status = 'open'");
  const used = new Set(live.map(x => x.tpl));
  await EV.refresh();
  let idxs = G.RUMOR_TPL.map((_, i) => i).filter(i => !used.has(i) && (!G.RUMOR_TPL[i].ev || EV.on()));
  const evIdx = idxs.filter(i => G.RUMOR_TPL[i].ev);      // [EVENT:HALLOWEEN] 이벤트 중에는 혼령 소문이 60% 확률로 우선
  if (evIdx.length && G.chance01() < 0.6) idxs = evIdx;
  const i = idxs[G.rnd(0, idxs.length - 1)], tp = G.RUMOR_TPL[i];
  const region = G.SPAWN_REGIONS[G.rnd(0, G.SPAWN_REGIONS.length - 1)].id;
  const place = G.placeName(region);
  const truth = forceTruth === undefined ? (G.chance01() < 0.5 ? 1 : 0) : (forceTruth ? 1 : 0);
  const title = tp.t.replace('{p}', place), body = tp.body.replace('{p}', place);
  const r = await db.run('INSERT INTO rumors (title, body, region, mon_name, rank, tpl, truth, status, created, ends) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [title, body, region, tp.mon, tp.rank, i, truth, 'open', now, now + G.RUMOR_OPEN_MS]);
  await db.run('INSERT INTO board_posts (who, title, body, tag, at) VALUES (?, ?, ?, ?, ?)', ['익명의 시민', '[괴담] ' + title, body + ' 헌터 기기의 괴담 앱에서 믿을지 의심할지 정해 주세요.', '괴담', now]);
  return r.lastId;
}
// side: 'believe' | 'doubt' — 이긴 쪽
async function resolveRumor(r, side, now) {
  const status = side === 'believe' ? (r.truth ? 'true' : 'false') : (r.truth ? 'buried' : 'debunked');
  const claim = await db.run("UPDATE rumors SET status = ?, resolved = ? WHERE id = ? AND status = 'open'", [status, now, r.id]);
  if (claim.changes !== 1) return null;
  const votes = await db.all('SELECT user_id, vote FROM rumor_votes WHERE rumor_id = ?', [r.id]);
  const RW = G.RUMOR_REWARD;
  const pay = async (uid, rw) => {
    let delta = 0;
    if (rw.gold > 0) { await grantGold(uid, rw.gold); await logAcquire(uid, 'gold', '골드', rw.gold, '괴담 소문', now); delta = rw.gold; }
    if (rw.gold < 0) {
      const cur = await db.get('SELECT gold FROM users WHERE id = ?', [uid]);
      delta = -Math.min(Number(cur ? cur.gold : 0), -rw.gold);
      if (delta < 0) await db.run('UPDATE users SET gold = gold - MIN(gold, ?) WHERE id = ?', [-delta, uid]);
    }
    if (rw.exp > 0) { await grantExp(uid, rw.exp); await logAcquire(uid, 'exp', '경험치', rw.exp, '괴담 소문', now); }
    await db.run(`INSERT INTO rumor_stats (user_id, gained, lost, last_delta, last_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET gained = gained + excluded.gained, lost = lost + excluded.lost, last_delta = excluded.last_delta, last_at = excluded.last_at`,
      [uid, delta > 0 ? delta : 0, delta < 0 ? -delta : 0, delta, now]);
  };
  if (status === 'true') {
    await db.run('INSERT INTO monsters (region, name, rank, spawned_at, rumor_id) VALUES (?, ?, ?, ?, ?)', [r.region, r.mon_name, r.rank, now, r.id]);
    await db.run('INSERT INTO board_posts (who, title, body, tag, at) VALUES (?, ?, ?, ?, ?)', ['익명의 시민', '[괴담] 소문이 사실이었다', G.placeName(r.region) + '에 "' + r.mon_name + '"이(가) 실제로 나타났습니다. 조심하세요.', '괴담', now]);
    for (const v of votes) await pay(v.user_id, v.vote === 1 ? RW.believeTrue : { gold: 0, exp: 0 });
    const bn = (G.RUMOR_TPL[r.tpl] || {}).bonus;      // [EVENT:HALLOWEEN] 혼령 소문이 사실이면 믿은 사람에게 불씨
    if (bn) for (const v of votes) if (v.vote === 1) { await giveItem(v.user_id, bn.item, bn.qty); await logAcquire(v.user_id, 'item', bn.item, bn.qty, '혼령 소문', now); }
  } else if (status === 'false') {
    for (const v of votes) await pay(v.user_id, v.vote === 1 ? RW.believeFalse : RW.doubtFalse);
  } else if (status === 'buried') {
    for (const v of votes) await pay(v.user_id, { gold: 0, exp: 0 });
  } else if (status === 'debunked') {
    for (const v of votes) await pay(v.user_id, v.vote === 0 ? RW.doubtFalse : { gold: 0, exp: 0 });
  }
  return status;
}
const rumorMine = async (uid) => {
  const m = new Map((await db.all('SELECT rumor_id, vote FROM rumor_votes WHERE user_id = ?', [uid])).map(x => [x.rumor_id, x.vote]));
  return m;
};
route('GET', '/api/rumors', async (req, res, ctx) => {
  await tickRumors();
  const now = Date.now();
  const rows = await db.all("SELECT id, title, body, region, mon_name, rank, tpl, truth, status, created, ends, resolved FROM rumors WHERE status = 'open' OR resolved > ? ORDER BY id DESC LIMIT 12", [now - 24 * 3600000]);
  const cnt = new Map((await db.all('SELECT rumor_id, vote, COUNT(*) AS c FROM rumor_votes WHERE rumor_id IN (SELECT id FROM rumors WHERE status = \'open\' OR resolved > ?) GROUP BY rumor_id, vote', [now - 24 * 3600000])).map(x => [x.rumor_id + ':' + x.vote, Number(x.c)]));
  const mine = await rumorMine(ctx.user.id);
  const HOAX = i => (G.RUMOR_TPL[i] || {}).hoax || '';
  const rs = await db.get('SELECT gained, lost, last_delta, last_at FROM rumor_stats WHERE user_id = ?', [ctx.user.id]);
  send(res, 200, { need: G.RUMOR_NEED, stats: { gained: rs ? Number(rs.gained) : 0, lost: rs ? Number(rs.lost) : 0, last: rs ? Number(rs.last_delta) : null }, rumors: rows.map(r => {
    const open = r.status === 'open', my = mine.has(r.id) ? mine.get(r.id) : null;
    const o = { id: r.id, title: r.title, body: r.body, place: rumorPlace(r), status: r.status, believers: cnt.get(r.id + ':1') || 0, doubters: cnt.get(r.id + ':0') || 0, my, endsIn: open ? Math.max(0, r.ends - now) : 0 };
    if (!open) {
      o.truth = !!r.truth; o.mon = r.mon_name; o.hoax = r.truth ? '' : HOAX(r.tpl);
      const RW = G.RUMOR_REWARD;
      if (my !== null) o.reward = r.status === 'true' && my === 1 ? RW.believeTrue : r.status === 'false' ? (my === 1 ? RW.believeFalse : RW.doubtFalse) : r.status === 'debunked' && my === 0 ? RW.doubtFalse : null;
    }
    return o;
  }) });
});
route('POST', '/api/rumors/vote', async (req, res, ctx) => {
  if (await limited('rumor:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  const now = Date.now(), id = Number(ctx.body.id) || 0, vote = ctx.body.vote === 'believe' ? 1 : ctx.body.vote === 'doubt' ? 0 : -1;
  if (vote < 0) return fail(res, 400, 'bad_vote');
  const r = await db.get('SELECT id, title, body, region, mon_name, rank, tpl, truth, status, created, ends, resolved FROM rumors WHERE id = ?', [id]);
  if (!r) return fail(res, 404, 'no_rumor');
  if (r.status !== 'open' || r.ends <= now) return fail(res, 409, 'closed');
  const ins = await db.run('INSERT OR IGNORE INTO rumor_votes (rumor_id, user_id, vote, at) VALUES (?, ?, ?, ?)', [id, ctx.user.id, vote, now]);
  if (ins.changes !== 1) return fail(res, 409, 'already_voted');
  const c = await db.all('SELECT vote, COUNT(*) AS n FROM rumor_votes WHERE rumor_id = ? GROUP BY vote', [id]);
  const bel = Number((c.find(x => x.vote === 1) || {}).n || 0), dou = Number((c.find(x => x.vote === 0) || {}).n || 0);
  let status = 'open';
  const side = vote === 1 ? (bel >= G.RUMOR_NEED ? 'believe' : null) : (dou >= G.RUMOR_NEED ? 'doubt' : null);
  if (side) status = (await resolveRumor(r, side, now)) || 'open';
  send(res, 200, { ok: true, status, believers: bel, doubters: dou });
});

// ═════════════ 오염된 친구 구조 의뢰 ═════════════
// 오염 폭주(오염도 100)에 빠진 친구에게 정화 아이템을 써서 구해 줍니다. 구한 사람에게는 보상, 구해진 친구는 오염도가 40으로 내려가고 폭주가 풀립니다.
const RESCUE_REWARD = { gold: 200, exp: 40, fame: 3 };
async function cureItems() {
  const m = new Map();
  Object.keys(G.CRAFT_DEFS).forEach(n => { const d = G.CRAFT_DEFS[n]; if (d.stat === 'taint' && d.amt < 0) m.set(n, d.amt); });
  (await db.all("SELECT name, eff_amt FROM shop_items WHERE eff_stat = 'taint' AND eff_amt < 0")).forEach(r => m.set(r.name, Number(r.eff_amt)));
  return m;
}
async function findCure(userId) {
  const m = await cureItems();
  if (!m.size) return null;
  const names = [...m.keys()];
  const rows = await db.all('SELECT item, qty FROM inventory WHERE user_id = ? AND qty > 0 AND item IN (' + names.map(() => '?').join(',') + ')', [userId, ...names]);
  if (!rows.length) return null;
  rows.sort((a, b) => Math.abs(m.get(a.item)) - Math.abs(m.get(b.item)));      // 가장 약한 정화 아이템부터 사용
  return rows[0].item;
}
route('POST', '/api/friends/rescue', async (req, res, ctx) => {
  if (await limited('rescue:' + ctx.user.id, 20, 60000)) return fail(res, 429, 'rate_limited');
  const me = await userById(ctx.user.id), now = Date.now();
  const f = await userByCode(normCode(ctx.body.code));
  if (!f || f.id === me.id || !(await isFriend(me.id, f.id))) return fail(res, 404, 'not_found');
  if (corruptLock(me, now) || (Number(JSON.parse(me.stats).taint) || 0) >= 100) return fail(res, 409, 'corrupted');
  if (!f.corrupt_flag || (Number(JSON.parse(f.stats).taint) || 0) < 100) return fail(res, 409, 'not_corrupted');
  if (await db.get('SELECT 1 AS x FROM rescues WHERE rescuer_id = ? AND target_id = ? AND at > ?', [me.id, f.id, now - 6 * 3600000])) return fail(res, 429, 'pair_cooldown');
  const cnt = await db.get('SELECT COUNT(*) AS c FROM rescues WHERE rescuer_id = ? AND at > ?', [me.id, now - 24 * 3600000]);
  if (Number(cnt.c) >= 5) return fail(res, 429, 'daily_limit');
  const item = await findCure(me.id);
  if (!item) return fail(res, 409, 'no_item');
  const dec = await db.run('UPDATE inventory SET qty = qty - 1 WHERE user_id = ? AND item = ? AND qty > 0', [me.id, item]);
  if (dec.changes !== 1) return fail(res, 409, 'no_item');
  await db.run('DELETE FROM inventory WHERE user_id = ? AND item = ? AND qty <= 0', [me.id, item]);
  // 친구의 오염도를 40으로 내리고 폭주를 풉니다 (이미 누군가 구했다면 한 번만 적용)
  let done = false;
  for (let i = 0; i < 6; i++) {
    const cur = await db.get('SELECT stats FROM users WHERE id = ?', [f.id]);
    const st = JSON.parse(cur.stats);
    if ((Number(st.taint) || 0) < 100) break;
    st.taint = 40;
    const w = await db.run('UPDATE users SET stats = ? WHERE id = ? AND stats = ?', [JSON.stringify(st), f.id, cur.stats]);
    if (w.changes === 1) { done = true; break; }
  }
  if (!done) {            // 그 사이 이미 풀렸으면 아이템을 돌려줍니다
    await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, 1) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + 1)', [me.id, item]);
    return fail(res, 409, 'not_corrupted');
  }
  await db.run('UPDATE users SET corrupt_until = 0, corrupt_flag = 0 WHERE id = ?', [f.id]);
  await db.run('UPDATE monsters SET spawned_at = 0 WHERE corrupt_of = ?', [f.id]);
  await db.run('DELETE FROM monsters WHERE corrupt_of = ? AND NOT EXISTS (SELECT 1 FROM kills k WHERE k.monster_id = monsters.id)', [f.id]);
  await db.run('INSERT INTO rescues (target_id, rescuer_id, at, seen) VALUES (?, ?, ?, 0)', [f.id, me.id, now]);
  const g = await grantExp(me.id, RESCUE_REWARD.exp);
  await grantGold(me.id, RESCUE_REWARD.gold);
  await grantFame(me.id, RESCUE_REWARD.fame);
  await logAcquire(me.id, 'exp', '경험치', RESCUE_REWARD.exp, '친구 구조', now);
  await logAcquire(me.id, 'gold', '골드', RESCUE_REWARD.gold, '친구 구조', now);
  send(res, 200, { ok: true, item, friend: f.hunter_name, gold: RESCUE_REWARD.gold, exp: RESCUE_REWARD.exp, fame: RESCUE_REWARD.fame, levelUp: !!(g && g.up) });
});

// ═════════════ 적월문 심층 탐험 (층 구조) ═════════════
// 시작 → 한 층씩 내려가며 재료·골드를 모음 → 복귀하면 전부 가져감. 깊을수록 보상이 크지만 오염도가 쌓이고, 함정에 걸리면 절반을 잃습니다.
// 오염도가 100이 되면 폭주하며 모은 것을 전부 잃습니다.
// ═════════════ 장비 ═════════════
const EQ_BY_ID = new Map(G.EQUIPS.map(e => [e.id, e]));
const EQ_BY_NAME = new Map(G.EQUIPS.map(e => [e.name, e]));
const eqBonusOf = e => { if (e.bonus) return { stat: e.bonus.stat, val: e.bonus.val }; const sl = G.EQ_SLOTS[e.slot], gi = 'CBAS'.indexOf(e.grade); return { stat: sl.stat, val: sl.v[gi] }; };      // e.bonus: 이벤트 가면처럼 능력치를 직접 지정한 장비
const EQ_STAT_KO = { str: ['근력', ''], agi: ['민첩', ''], luck: ['행운', ''], hpGuard: ['체력 피해 감소', '%'], taintRes: ['오염도 증가 감소', '%'] };
async function equipBonus(uid) {
  const b = { str: 0, agi: 0, luck: 0, hpGuard: 0, taintRes: 0 };
  const rows = await db.all('SELECT key FROM equip_inv WHERE user_id = ? AND equipped = 1 AND dur > 0', [uid]);
  for (const r of rows) { const e = EQ_BY_ID.get(r.key); if (e) { const x = eqBonusOf(e); b[x.stat] += x.val; } }
  b.hpGuard = Math.min(80, b.hpGuard); b.taintRes = Math.min(70, b.taintRes);
  return b;
}
const withEq = (st, eb) => Object.assign({}, st, { agi: (Number(st.agi) || 0) + eb.agi, luck: (Number(st.luck) || 0) + eb.luck, str: (Number(st.str) || 0) + eb.str });
const eqTaint = (t, eb) => Math.max(0, Math.round(t * (1 - eb.taintRes / 100) * 10) / 10);
// 토벌 한 번마다 착용 중인 장비의 내구도가 1씩 줄어듭니다.
async function equipWear(uid) { await db.run('UPDATE equip_inv SET dur = dur - 1 WHERE user_id = ? AND equipped = 1 AND dur > 0', [uid]); }


const EQ_MAX_OWN = 40;
const eqView = e => { const x = eqBonusOf(e), sl = G.EQ_SLOTS[e.slot], g = G.EQ_GRADE[e.grade];
  const sk = e.bonus ? EQ_STAT_KO[e.bonus.stat] : [sl.ko_stat, sl.unit];
  return { id: e.id, name: e.name, slot: e.slot, slotKo: sl.ko, grade: e.grade, desc: e.desc, stat: sk[0], val: x.val, unit: sk[1], maxDur: g.dur, repair: g.repair, ev: e.ev || undefined }; };
route('GET', '/api/equip', async (req, res, ctx) => {
  await EV.refresh();
  const inv = new Map((await db.all('SELECT item, qty FROM inventory WHERE user_id = ? AND qty > 0', [ctx.user.id])).map(r => [r.item, Number(r.qty)]));
  const mine = await db.all('SELECT id, key, dur, equipped FROM equip_inv WHERE user_id = ? ORDER BY equipped DESC, id', [ctx.user.id]);
  const eb = await equipBonus(ctx.user.id);
  send(res, 200, {
    gold: (await db.get('SELECT gold FROM users WHERE id = ?', [ctx.user.id])).gold,
    defs: G.EQUIPS.filter(e => !e.ev || EV.on()).map(e => Object.assign(eqView(e), { mats: Object.keys(e.mats).map(k => ({ item: k, qty: e.mats[k], have: inv.get(k) || 0 })) })),
    mine: mine.filter(r => EQ_BY_ID.has(r.key)).map(r => { const e = EQ_BY_ID.get(r.key); return Object.assign(eqView(e), { uid: r.id, dur: r.dur, equipped: !!r.equipped, broken: r.dur <= 0 }); }),
    bonus: eb,
  });
});
route('POST', '/api/equip/craft', async (req, res, ctx) => {
  if (await limited('eqc:' + ctx.user.id, 40, 60000)) return fail(res, 429, 'rate_limited');
  await EV.refresh();
  const e = EQ_BY_ID.get(String(ctx.body.id || ''));
  if (!e) return fail(res, 404, 'no_recipe');
  if (e.ev && !EV.on()) return fail(res, 403, 'event_off');      // [EVENT:HALLOWEEN] 이벤트 장비는 이벤트 기간에만 조합
  const cur = await userById(ctx.user.id);
  if (corruptLock(cur, Date.now())) return fail(res, 409, 'corrupted', { until: cur.corrupt_until });
  const own = await db.get('SELECT COUNT(*) AS c FROM equip_inv WHERE user_id = ?', [cur.id]);
  if (Number(own.c) >= EQ_MAX_OWN) return fail(res, 409, 'full');
  const taken = [];
  const restore = async () => { for (const t of taken) await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + excluded.qty)', [cur.id, t[0], t[1]]); };
  try {
    for (const [item, need] of Object.entries(e.mats)) {
      const d = await db.run('UPDATE inventory SET qty = qty - ? WHERE user_id = ? AND item = ? AND qty >= ?', [need, cur.id, item, need]);
      if (d.changes !== 1) { await restore(); return fail(res, 400, 'no_mats', { item }); }
      taken.push([item, need]);
    }
    await db.run('INSERT INTO equip_inv (user_id, key, dur, equipped, at) VALUES (?, ?, ?, 0, ?)', [cur.id, e.id, G.EQ_GRADE[e.grade].dur, Date.now()]);
  } catch (err) { await restore(); throw err; }
  if (e.mats[EV.EMBER]) await EV.lossLog(cur.id, e.mats[EV.EMBER], '장비 조합 (' + e.name + ')', Date.now());
  await db.run('DELETE FROM inventory WHERE user_id = ? AND qty <= 0', [cur.id]);
  await logAcquire(cur.id, 'item', e.name + ' (' + e.grade + '급 장비)', 1, '장비 조합', Date.now());
  send(res, 200, { ok: true, name: e.name, grade: e.grade });
});
route('POST', '/api/equip/wear', async (req, res, ctx) => {
  const uid = Number(ctx.body.uid) || 0;
  const r = await db.get('SELECT id, key, dur FROM equip_inv WHERE id = ? AND user_id = ?', [uid, ctx.user.id]);
  if (!r || !EQ_BY_ID.has(r.key)) return fail(res, 404, 'no_equip');
  const e = EQ_BY_ID.get(r.key);
  const same = await db.all('SELECT id, key FROM equip_inv WHERE user_id = ? AND equipped = 1', [ctx.user.id]);
  for (const o of same) { const oe = EQ_BY_ID.get(o.key); if (oe && oe.slot === e.slot && o.id !== r.id) await db.run('UPDATE equip_inv SET equipped = 0 WHERE id = ?', [o.id]); }
  await db.run('UPDATE equip_inv SET equipped = 1 WHERE id = ? AND user_id = ?', [r.id, ctx.user.id]);
  send(res, 200, { ok: true, broken: r.dur <= 0 });
});
route('POST', '/api/equip/unwear', async (req, res, ctx) => {
  const w = await db.run('UPDATE equip_inv SET equipped = 0 WHERE id = ? AND user_id = ?', [Number(ctx.body.uid) || 0, ctx.user.id]);
  if (w.changes !== 1) return fail(res, 404, 'no_equip');
  send(res, 200, { ok: true });
});
// 전체 해제: 착용 중인 장비를 모두 벗습니다
route('POST', '/api/equip/unwear-all', async (req, res, ctx) => {
  const w = await db.run('UPDATE equip_inv SET equipped = 0 WHERE user_id = ? AND equipped = 1', [ctx.user.id]);
  send(res, 200, { ok: true, n: w.changes || 0 });
});
// 전체 수리: 내구도가 모자란 장비를 모두 고치고, 비용은 한 번에 냅니다 (골드가 모자라면 아무것도 수리하지 않음)
route('POST', '/api/equip/repair-all', async (req, res, ctx) => {
  if (await limited('eqr:' + ctx.user.id, 40, 60000)) return fail(res, 429, 'rate_limited');
  const rows = (await db.all('SELECT id, key, dur FROM equip_inv WHERE user_id = ?', [ctx.user.id])).filter(r => EQ_BY_ID.has(r.key));
  const todo = [];
  for (const r of rows) { const g = G.EQ_GRADE[EQ_BY_ID.get(r.key).grade], missing = g.dur - Math.max(0, r.dur); if (missing > 0) todo.push({ r, g, cost: Math.max(1, Math.round(g.repair * missing / g.dur)) }); }
  if (!todo.length) return fail(res, 409, 'full_dur');
  const total = todo.reduce((t, x) => t + x.cost, 0);
  const pay = await db.run('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?', [total, ctx.user.id, total]);
  if (pay.changes !== 1) return fail(res, 402, 'no_gold', { cost: total });
  let paid = 0, n = 0;
  for (const x of todo) {
    const w = await db.run('UPDATE equip_inv SET dur = ? WHERE id = ? AND user_id = ? AND dur = ?', [x.g.dur, x.r.id, ctx.user.id, x.r.dur]);
    if (w.changes === 1) { paid += x.cost; n++; }
  }
  if (paid < total) await grantGold(ctx.user.id, total - paid);      // 그 사이 바뀐 장비 몫은 돌려줌
  if (!n) return fail(res, 409, 'busy');
  send(res, 200, { ok: true, cost: paid, n });
});
// 수리: 부족한 내구도 비율만큼 골드를 냅니다 (최소 1 G)
route('POST', '/api/equip/repair', async (req, res, ctx) => {
  if (await limited('eqr:' + ctx.user.id, 40, 60000)) return fail(res, 429, 'rate_limited');
  const r = await db.get('SELECT id, key, dur FROM equip_inv WHERE id = ? AND user_id = ?', [Number(ctx.body.uid) || 0, ctx.user.id]);
  if (!r || !EQ_BY_ID.has(r.key)) return fail(res, 404, 'no_equip');
  const e = EQ_BY_ID.get(r.key), g = G.EQ_GRADE[e.grade], missing = g.dur - Math.max(0, r.dur);
  if (missing <= 0) return fail(res, 409, 'full_dur');
  const cost = Math.max(1, Math.round(g.repair * missing / g.dur));
  const pay = await db.run('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?', [cost, ctx.user.id, cost]);
  if (pay.changes !== 1) return fail(res, 402, 'no_gold', { cost });
  const w = await db.run('UPDATE equip_inv SET dur = ? WHERE id = ? AND user_id = ? AND dur = ?', [g.dur, r.id, ctx.user.id, r.dur]);
  if (w.changes !== 1) { await grantGold(ctx.user.id, cost); return fail(res, 409, 'busy'); }
  send(res, 200, { ok: true, cost, dur: g.dur });
});
route('POST', '/api/equip/discard', async (req, res, ctx) => {
  const w = await db.run('DELETE FROM equip_inv WHERE id = ? AND user_id = ?', [Number(ctx.body.uid) || 0, ctx.user.id]);
  if (w.changes !== 1) return fail(res, 404, 'no_equip');
  send(res, 200, { ok: true });
});

const GATE_MAX = 50, GATE_CD_OK = 10 * 60000, GATE_CD_FAIL = 30 * 60000;
const zoneIdx = n => Math.min(G.GATE_ZONES.length - 1, Math.max(0, Math.floor((n - 1) / 10)));       // 1~10층 = 0구간 … 41~50층 = 4구간
const isBoss = n => n % 10 === 0;                                                                     // 10층마다 구간의 수문장
// 처음 도달 보너스 [명성, 골드]: 3·5·7·10층은 기존 값, 15층부터는 5층마다
function gateMilestone(n) {
  const old = { 3: [1, 150], 5: [2, 300], 7: [3, 500], 10: [5, 1000] };
  if (old[n]) return old[n];
  return n > 10 && n % 5 === 0 ? [Math.round(n / 5) + 3, n * 60] : null;
}
const gateLoot = r => { try { const o = JSON.parse(r.loot || '{}'); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } };
async function gateRow(uid) {
  let r = await db.get('SELECT user_id, active, floor, best, loot, gold, cd_until, started_at, from_floor FROM gate_run WHERE user_id = ?', [uid]);
  if (!r) { await db.run('INSERT INTO gate_run (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING', [uid]); r = await db.get('SELECT user_id, active, floor, best, loot, gold, cd_until, started_at, from_floor FROM gate_run WHERE user_id = ?', [uid]); }
  return r;
}
// 다음 층(n층)의 확률표 — 화면에도 그대로 보여 줍니다 (모두 0~1)
function gateOdds(n, st) {
  const agi = Number(st && st.agi) || 0, luck = Number(st && st.luck) || 0;
  const cut = Math.min(0.25, agi * 0.0015 + luck * 0.0008);                                // 민첩·행운으로 줄일 수 있는 위험은 최대 25%p
  const lk = 1 + luck * 0.004;
  const boss = isBoss(n);
  return {
    n, zone: zoneIdx(n), boss,
    danger: Math.min(0.65, Math.max(0.04, 0.06 + 0.010 * n + (boss ? 0.08 : 0) - cut)),
    rare: Math.min(0.4, (0.03 + 0.006 * n) * lk),
    epic: n >= 10 ? Math.min(0.15, 0.003 * (n - 5) * lk) : 0,
    legend: n >= 10 ? Math.min(0.03, 0.0006 * (n - 5) * lk) : 0,
    spring: boss ? 0 : 0.05 + zoneIdx(n) * 0.01,
    treasure: boss ? 0 : Math.min(0.15, 0.06 + luck * 0.001),
  };
}
const gateView = (r, now, st) => {
  const next = r.floor < GATE_MAX ? gateOdds(r.floor + 1, st) : null;
  const starts = []; for (let f = 10; f < GATE_MAX; f += 10) if (f <= r.best) starts.push(f);
  return { active: !!r.active, floor: r.floor, from: r.from_floor | 0, best: r.best, max: GATE_MAX, loot: gateLoot(r), gold: r.gold, cd: Math.max(0, Number(r.cd_until) - now),
    zones: G.GATE_ZONES.map(z => z.name), zone: r.floor > 0 ? zoneIdx(r.floor) : 0, starts, next, taint: Math.round((Number(st && st.taint) || 0) * 10) / 10 };
};
// 모은 것을 가져가고 탐험을 끝냅니다. keep 은 가져가는 비율(1=전부, 0.5=절반, 0=전부 잃음)
async function gateFinish(uid, r, now, keep, cdMs) {
  const w = await db.run('UPDATE gate_run SET active = 0, floor = 0, from_floor = 0, loot = ?, gold = 0, cd_until = ? WHERE user_id = ? AND active = 1 AND floor = ?', ['{}', now + cdMs, uid, r.floor]);
  if (w.changes !== 1) return null;
  const loot = gateLoot(r), got = {};
  for (const name of Object.keys(loot)) {
    const q = Math.floor(Number(loot[name]) * keep);
    if (q <= 0) continue;
    got[name] = q;
    await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + excluded.qty)', [uid, name, q]);
    await logAcquire(uid, 'item', name, q, '적월문 심층 탐험', now);
  }
  const gold = Math.floor(r.gold * keep);
  if (gold > 0) { await grantGold(uid, gold); await logAcquire(uid, 'gold', '골드', gold, '적월문 심층 탐험', now); }
  let exp = 0;
  const climbed = r.floor - (r.from_floor | 0);
  if (keep >= 1 && climbed > 0) { exp = climbed * 6; await grantExp(uid, exp); await logAcquire(uid, 'exp', '경험치', exp, '적월문 심층 탐험', now); }
  return { got, gold, exp };
}
route('GET', '/api/gate/run', async (req, res, ctx) => {
  const u = await userById(ctx.user.id);
  send(res, 200, gateView(await gateRow(ctx.user.id), Date.now(), withEq(JSON.parse(u.stats), await equipBonus(u.id))));
});
route('POST', '/api/gate/start', async (req, res, ctx) => {
  const now = Date.now(), cur = await userById(ctx.user.id);
  if (G.countryOf(cur.region) !== 'GT') return fail(res, 409, 'not_here');
  if (corruptLock(cur, now)) return fail(res, 409, 'corrupted', { until: cur.corrupt_until });
  if ((Number(JSON.parse(cur.stats).taint) || 0) >= 100) return fail(res, 409, 'tainted');
  const r = await gateRow(cur.id), st = withEq(JSON.parse(cur.stats), await equipBonus(cur.id));
  if (r.active) return send(res, 200, Object.assign({ ok: true }, gateView(r, now, st)));
  if (Number(r.cd_until) > now) return fail(res, 429, 'cooldown', { cd: Number(r.cd_until) - now });
  // 10층 단위 거점: 그 층 수문장을 이미 넘은 적이 있다면(최고 기록 이상) 그 층에서부터 시작할 수 있습니다.
  const from = ctx.body.from === undefined ? 0 : Number(ctx.body.from);
  if (!Number.isInteger(from) || from < 0 || from >= GATE_MAX || (from > 0 && (from % 10 !== 0 || from > r.best))) return fail(res, 400, 'bad_from');
  const w = await db.run('UPDATE gate_run SET active = 1, floor = ?, from_floor = ?, loot = ?, gold = 0, started_at = ? WHERE user_id = ? AND active = 0', [from, from, '{}', now, cur.id]);
  if (w.changes !== 1) return fail(res, 409, 'busy');
  send(res, 200, Object.assign({ ok: true }, gateView(await gateRow(cur.id), now, st)));
});
// 한 층에서 얻는 재료: 등급(일반·희귀·영웅·전설)을 먼저 굴리고, 그 구간의 재료에서 고릅니다.
function gateRoll(odds, force) {
  const z = odds.zone, roll = x => G.rnd(1, 100000) <= x * 100000;
  const tier = force || (roll(odds.legend) ? 'l' : roll(odds.epic) ? 'e' : roll(odds.rare) ? 'r' : 'c');
  const pool = t => G.GATE_MATS.filter(m => m.zone === z && m.tier === t && !m.special);
  const pickOf = arr => arr[G.rnd(0, arr.length - 1)].name;
  if (tier === 'l') return { name: odds.n >= 30 && G.rnd(1, 100) <= 40 ? '월식의 조각' : pickOf(pool('l')), tier };
  if (tier === 'e' || tier === 'r') return { name: pickOf(pool(tier)), tier };
  if (G.rnd(1, 100) <= 60) return { name: pickOf(pool('c')), tier };       // 일반: 60% 구간 재료, 40% 일반 재료
  const regions = Object.keys(G.SV_MARKS);
  return { name: pickMaterial(regions[G.rnd(0, regions.length - 1)]).name, tier };
}
route('POST', '/api/gate/descend', async (req, res, ctx) => {
  if (await limited('gate:' + ctx.user.id, 40, 60000)) return fail(res, 429, 'rate_limited');
  const now = Date.now(), cur = await userById(ctx.user.id);
  if (G.countryOf(cur.region) !== 'GT') return fail(res, 409, 'not_here');
  if (corruptLock(cur, now)) return fail(res, 409, 'corrupted', { until: cur.corrupt_until });
  const r = await gateRow(cur.id);
  if (!r.active) return fail(res, 409, 'not_active');
  if (r.floor >= GATE_MAX) return fail(res, 409, 'bottom');
  const n = r.floor + 1, eb = await equipBonus(cur.id), st = withEq(JSON.parse(cur.stats), eb), od = gateOdds(n, st), zi = od.zone;
  if (Math.random() < od.danger) {          // 함정·습격: 종류마다 잃는 정도가 다릅니다
    let kind, keep;
    if (od.boss) { kind = 'boss'; keep = 0.3; }
    else {
      const wRock = 55 - zi * 6, wGas = 30, wAmb = 15 + zi * 6;
      const x = G.rnd(1, wRock + wGas + wAmb);
      if (x <= wRock) { kind = 'rock'; keep = 0.6; } else if (x <= wRock + wGas) { kind = 'gas'; keep = 0.5; } else { kind = 'ambush'; keep = 0.3; }
    }
    const f = await gateFinish(cur.id, r, now, keep, GATE_CD_FAIL);
    if (!f) return fail(res, 409, 'busy');
    const tAdd = eqTaint(4 + Math.round(n * 0.4) + (kind === 'gas' ? Math.round(n * 0.3) : 0), eb);
    const taintNow = await grantTaint(cur.id, tAdd);
    return send(res, 200, { result: 'trap', kind, floor: n, kept: f.got, gold: f.gold, keep, taint: tAdd, taintNow, cd: GATE_CD_FAIL });
  }
  // 안전하게 내려감
  const loot = gateLoot(r), found = {}, tiers = {};
  let event = od.boss ? 'boss' : null;
  if (!event) { const x = Math.random(); if (x < od.spring) event = 'spring'; else if (x < od.spring + od.treasure) event = 'treasure'; }
  const picks = 1 + Math.floor(n / 12) + (od.boss ? 1 : 0) + (event === 'treasure' ? 1 : 0);
  for (let i = 0; i < picks; i++) {
    const force = od.boss && i === 0 ? 'e' : event === 'treasure' && i === 0 ? 'r' : null;      // 수문장은 영웅 재료, 보물방은 희귀 재료가 반드시 나옴
    const it = gateRoll(od, force);
    found[it.name] = (found[it.name] || 0) + 1; tiers[it.name] = it.tier;
  }
  if (n >= 3 && G.rnd(1, 100) <= Math.min(25, n * 3 / 2 + 2)) { found['적월석 가루'] = (found['적월석 가루'] || 0) + 1; tiers['적월석 가루'] = 'r'; }
  Object.keys(found).forEach(nm => { loot[nm] = (loot[nm] || 0) + found[nm]; });
  const gold = Math.round(G.rnd(12, 24) * (1 + n * 0.5) * (event === 'treasure' ? 3 : od.boss ? 2 : 1));
  const w = await db.run('UPDATE gate_run SET floor = ?, best = ?, loot = ?, gold = gold + ? WHERE user_id = ? AND active = 1 AND floor = ?',
    [n, Math.max(r.best, n), JSON.stringify(loot), gold, cur.id, r.floor]);
  if (w.changes !== 1) return fail(res, 409, 'busy');
  await questProg(cur, 'floor', 1);
  let bonus = null;
  const ms = gateMilestone(n);
  if (n > r.best && ms) {
    bonus = { fame: ms[0], gold: ms[1] };
    await grantFame(cur.id, bonus.fame); await grantGold(cur.id, bonus.gold);
    await logAcquire(cur.id, 'gold', '골드', bonus.gold, '심층 탐험 ' + n + '층 최초 도달', now);
  }
  let spring = 0;
  if (event === 'spring') {         // 정화의 샘: 오염도를 덜어 줌
    spring = 3 + zi * 2;
    await applyItemEffect(cur.id, 'taint', -spring, now);
  }
  const taintAdd = eqTaint(Math.round(1 + n * 0.5), eb);
  const taintNow = await grantTaint(cur.id, taintAdd);
  if (taintNow !== null && taintNow >= 100) {       // 오염 폭주: 모은 것을 전부 잃습니다
    const row = await gateRow(cur.id);
    await gateFinish(cur.id, row, now, 0, GATE_CD_FAIL);
    return send(res, 200, { result: 'tainted', floor: n, taint: taintAdd, taintNow, cd: GATE_CD_FAIL, bonus });
  }
  const after = await userById(cur.id);
  send(res, 200, Object.assign({ result: 'ok', found, tiers, gold, taint: taintAdd, taintNow, bonus, event, spring, odds: od }, gateView(await gateRow(cur.id), now, withEq(JSON.parse(after.stats), eb))));
});
route('POST', '/api/gate/retreat', async (req, res, ctx) => {
  const now = Date.now(), r = await gateRow(ctx.user.id);
  if (!r.active) return fail(res, 409, 'not_active');
  const cdMs = r.floor > (r.from_floor | 0) ? GATE_CD_OK : 0;
  const f = await gateFinish(ctx.user.id, r, now, 1, cdMs);
  if (!f) return fail(res, 409, 'busy');
  send(res, 200, { ok: true, floor: r.floor, got: f.got, gold: f.gold, exp: f.exp, cd: cdMs });
});
// 문 밖으로 나가면(다른 지역으로 이동하면) 자동으로 복귀 처리합니다
async function gateAutoRetreat(uid) {
  try {
    const r = await db.get('SELECT user_id, active, floor, best, loot, gold, cd_until, started_at, from_floor FROM gate_run WHERE user_id = ? AND active = 1', [uid]);
    if (r) await gateFinish(uid, r, Date.now(), 1, r.floor > (r.from_floor | 0) ? GATE_CD_OK : 0);
  } catch (_) {}
}

// ── 조합: 재료를 모아 완성 아이템을 만듭니다 ──
route('GET', '/api/craft', async (req, res, ctx) => {
  send(res, 200, {
    materials: G.MATERIALS.concat(G.GATE_MATS).map(m => ({ name: m.name, desc: m.desc })),
    recipes: G.RECIPES.map(r => ({ id: r.id, name: r.name, desc: r.desc, mats: Object.keys(r.mats).map(k => ({ item: k, qty: r.mats[k] })), eff: { stat: r.stat, amt: r.amt } })),
  });
});
route('POST', '/api/craft', async (req, res, ctx) => {
  if (await limited('craft:' + ctx.user.id, 60, 60000)) return fail(res, 429, 'rate_limited');
  const rc = G.RECIPES.find(r => r.id === String(ctx.body.id || ''));
  if (!rc) return fail(res, 404, 'no_recipe');
  const cur = await userById(ctx.user.id);
  if (corruptLock(cur, Date.now())) return fail(res, 409, 'corrupted', { until: cur.corrupt_until });
  const have = await db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [cur.id, rc.name]);
  if (have && Number(have.qty) >= 9999) return fail(res, 409, 'max_qty');
  const taken = [];
  const restore = async () => { for (const t of taken) await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + excluded.qty)', [cur.id, t[0], t[1]]); };
  try {
    for (const [item, need] of Object.entries(rc.mats)) {
      const d = await db.run('UPDATE inventory SET qty = qty - ? WHERE user_id = ? AND item = ? AND qty >= ?', [need, cur.id, item, need]);
      if (d.changes !== 1) { await restore(); return fail(res, 400, 'no_mats', { item }); }
      taken.push([item, need]);
    }
    await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, 1) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + 1)', [cur.id, rc.name]);
  } catch (e) { await restore(); throw e; }
  await db.run('DELETE FROM inventory WHERE user_id = ? AND qty <= 0', [cur.id]);
  await logAcquire(cur.id, 'item', rc.name, 1, '조합', Date.now());
  send(res, 200, { ok: true, item: rc.name });
});
route('GET', '/api/gifts', async (req, res, ctx) => {
  const rows = await db.all(`SELECT g.id, g.kind, g.item, g.qty, g.ts, g.seen, u.hunter_name AS hn FROM gifts g LEFT JOIN users u ON u.id = g.from_id
    WHERE g.to_id = ? ORDER BY g.id DESC LIMIT 20`, [ctx.user.id]);
  send(res, 200, { gifts: rows.map(r => ({ id: r.id, kind: r.kind, item: r.item, qty: r.qty, from: r.hn || '(탈퇴한 헌터)', ts: r.ts, isNew: !r.seen })) });
});
route('POST', '/api/gifts/seen', async (req, res, ctx) => {
  await db.run('UPDATE gifts SET seen = 1 WHERE to_id = ? AND seen = 0', [ctx.user.id]);
  send(res, 200, { ok: true });
});

// 세계 지도(나라와 세부 지역)
route('GET', '/api/world', async (req, res) => {
  send(res, 200, { countries: G.COUNTRIES.map(c => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon, gate: !!c.gate,
    regions: c.regions.map(r => ({ id: r.id, name: r.name, sub: r.sub, icon: r.icon, danger: r.danger, pos: r.pos })) })) });
});

// 나라별 현재 헌터 수와 S급 출몰 여부 (지구본에 표시)
route('GET', '/api/world/stats', async (req, res) => {
  const now = Date.now();
  const rows = await db.all('SELECT region, COUNT(*) AS c FROM users GROUP BY region');
  const hunters = {};
  rows.forEach(r => { const k = G.countryOf(r.region); hunters[k] = (hunters[k] || 0) + r.c; });
  const ss = await db.all(`SELECT id, name, region, spawned_at FROM monsters m WHERE rank = 'SS' AND owner_id IS NULL AND corrupt_of IS NULL AND spawned_at > ?
    AND id NOT IN (SELECT monster_id FROM s_close)`, [now - G.ACTIVE_MS_S]);
  send(res, 200, { hunters, s: ss.map(m => ({ id: m.id, name: m.name, country: m.region, left: m.spawned_at + G.ACTIVE_MS_S - now })) });
});

route('POST', '/api/move', async (req, res, ctx) => {
  let id = ctx.body.region;
  if (typeof id === 'string' && G.COUNTRY_BY_ID[id]) id = G.COUNTRY_BY_ID[id].regions[0].id;      // 나라를 고르면 그 나라의 첫 지역으로 이동
  if (typeof id !== 'string' || !G.REGION_BY_ID[id]) return fail(res, 400, 'bad_region');
  // 게이트 구역(적월문): 밖에서 들어올 때는 어느 지역을 골라도 안쪽 지역 중 무작위 한 곳으로 이동합니다.
  const dest = G.COUNTRY_BY_ID[G.countryOf(id)];
  const banned = r => stageOf(ctx.user) >= 3 && G.TAINT_BAN_DANGER.has(r.danger);      // 오염도 80% 이상: 위험 지역(B·A급 지역)에는 들어갈 수 없음
  if (dest.gate && G.countryOf(ctx.user.region) !== dest.id) { const ok = dest.regions.filter(r => !banned(r)); id = (ok.length ? ok : dest.regions)[G.rnd(0, (ok.length ? ok : dest.regions).length - 1)].id; }
  if (banned(G.REGION_BY_ID[id]) && id !== ctx.user.region) return fail(res, 409, 'taint_ban', { region: id, rname: G.placeName(id) });
  if (ctx.user.block_flags & 2) return fail(res, 403, 'blocked', { what: 'move' });
  if (corruptLock(ctx.user, Date.now())) return fail(res, 409, 'corrupted', { until: ctx.user.corrupt_until });
  if (G.countryOf(ctx.user.region) === 'GT' && G.countryOf(id) !== 'GT') await gateAutoRetreat(ctx.user.id);
  await db.run('UPDATE users SET region = ? WHERE id = ?', [id, ctx.user.id]);
  if (id !== ctx.user.region) await db.run('INSERT INTO visit_counts (user_id, region, n) VALUES (?, ?, 1) ON CONFLICT(user_id, region) DO UPDATE SET n = n + 1', [ctx.user.id, id]);   // 방문 횟수 (업적)
  send(res, 200, { region: id, country: G.countryOf(id) });
});

route('POST', '/api/hunt', async (req, res, ctx) => {
  const u = ctx.user, now = Date.now();
  if (await limited('hunt:' + u.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  await catchUp();
  const cur = await userById(u.id);
  if (cur.block_flags & 1) return fail(res, 403, 'blocked', { what: 'hunt' });      // 운영자가 토벌을 막아 둠
  const m = await db.get('SELECT id, region, name, rank, spawned_at, owner_id, rumor_id, corrupt_of FROM monsters WHERE id = ?', [Number(ctx.body.id)]);
  if (!m) return fail(res, 410, 'expired');
  if (m.owner_id != null && EV.nightOnly(Date.now()) && !EV.GHOST_SET.has(m.name)) return fail(res, 404, 'no_monster');      // [EVENT:HALLOWEEN] 백귀야행 중에는 잡귀만 상대할 수 있음
  if (EV.isGhostInGate(m)) return fail(res, 404, 'no_monster');      // [EVENT:HALLOWEEN] 적월문 안의 잡귀는 상대할 수 없음
  if ((m.owner_id != null && m.owner_id !== cur.id) || (m.owner_id == null && m.rank !== 'SS' && m.corrupt_of == null && m.rumor_id == null)) return fail(res, 404, 'no_monster');
  const cm = m.corrupt_of != null;
  if (corruptLock(cur, now)) return fail(res, 409, 'corrupted', { until: cur.corrupt_until });   // 오염도 100: 1시간 활동 불가
  if ((Number(JSON.parse(cur.stats).taint) || 0) >= 100) return fail(res, 409, 'tainted');          // 오염도를 줄여야 토벌 가능
  if (await db.get('SELECT 1 AS x FROM kills WHERE user_id = ? AND monster_id = ?', [cur.id, m.id])) return fail(res, 409, 'already_done');
  if (now - m.spawned_at >= (cm ? CORRUPT_MON_MS : G.activeMsOf(m.rank))) return fail(res, 410, 'expired');
  // S급은 나라 단위, 나머지는 세부 지역 단위로 같은 곳에 있어야 합니다.
  const here = m.rank === 'SS' && !cm ? G.countryOf(cur.region) : cur.region;
  if (here !== m.region) return fail(res, 409, 'wrong_region', { region: m.region, rname: G.placeName(m.region) });

  await settleDying(cur.id, now);
  const me = await db.get('SELECT stats, dying_until FROM users WHERE id = ?', [cur.id]);
  if (me.dying_until > now) return fail(res, 409, 'dying', { until: me.dying_until });        // 빈사 상태: 5분간 토벌 불가
  const eb = await equipBonus(cur.id);
  const myStats = withEq(JSON.parse(me.stats), eb);
  if (cm && m.corrupt_of === cur.id) return fail(res, 404, 'no_monster');

  if (m.rank === 'SS' && !cm) {
    if (await db.get('SELECT 1 AS x FROM s_close WHERE monster_id = ?', [m.id])) return fail(res, 409, 'already_done');
    // 도전권 1장 사용: 1시간 창이 끝났으면 새로 시작, 아니면 3회까지만 (한 문장으로 처리해 동시 요청에도 안전)
    const W = G.S_WINDOW_MS;
    const use = await db.run(
      `INSERT INTO s_window (user_id, start, n) VALUES (?, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET
         start = CASE WHEN ? - start >= ? THEN ? ELSE start END,
         n     = CASE WHEN ? - start >= ? THEN 1 ELSE n + 1 END
       WHERE ? - start >= ? OR n < ?`,
      [cur.id, now, now, W, now, now, W, now, W, G.S_MAX]);
    if (use.changes !== 1) return fail(res, 429, 's_limit', { resetAt: (await sInfo(cur.id, now)).resetAt });
    const at = now + G.S_WAIT_MS;
    await db.run('INSERT INTO s_attempts (user_id, monster_id, created_at, resolve_at) VALUES (?, ?, ?, ?)', [cur.id, m.id, now, at]);
    await logHunt(cur.id, m, 'pending', 0, now);
    const tot = await db.get('SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS p FROM s_attempts WHERE monster_id = ?', [m.id]);
    if (tot.p >= G.RAID_NEED || tot.n >= G.RAID_ATTEMPTS) await declareSuccess(m, 'auto');
    return send(res, 200, { result: 'pending', resolveAt: at, s: await sInfo(cur.id, now) });
  }

  const cd = cm ? null : await db.get('SELECT until FROM fail_cd WHERE user_id = ? AND monster_id = ?', [cur.id, m.id]);
  if (cd && cd.until > now) return fail(res, 429, 'cooldown', { until: cd.until });
  // 내 등급과 같거나 높은 몬스터는 턴제 전투로 진행합니다 (오염 몬스터는 예전처럼 바로 처치)
  if (!cm && (G.SPECIAL_MON[m.name] || G.isTurnBased(m.rank, cur.rank))) {      // 오염 사냥꾼·혈월의 잔영은 등급과 상관없이 항상 턴제 전투
    const bv = await battleStart(cur, m, myStats, now);
    if (bv.error) return fail(res, 409, bv.error, { battle: bv.view });
    return send(res, 200, { result: 'battle', battle: bv.view });
  }
  if (cm || G.chance01() < G.huntChance(m.rank, cur.lv, 0, myStats.str)) {   // 오염 몬스터는 무조건 성공
    const w = await huntWin(cur, m, eb, now);
    if (w.err) return fail(res, 409, w.err);
    return send(res, 200, w.payload);
  }
  return send(res, 200, await huntLose(cur, m, myStats, eb, now));
});

// 토벌 성공 처리 (바로 토벌과 턴제 전투 승리가 같은 보상을 씁니다)
async function huntWin(cur, m, eb, now) {
  const k = await db.run('INSERT OR IGNORE INTO kills (user_id, monster_id, at) VALUES (?, ?, ?)', [cur.id, m.id, now]);
  if (k.changes !== 1) return { err: 'already_done' };
  const sp = G.SPECIAL_MON[m.name];      // 오염 사냥꾼·혈월의 잔영: 보상 배수, 정화, 아이템
  // 오염 사냥꾼: 토벌할수록 강해지고 보상도 조금씩 늘어납니다
  const hl = m.name === '오염 사냥꾼' ? await hunterLv(cur.id) : 0, hr = hl > 0 ? G.hunterScale(hl).reward : 1;
  const gain = Math.round(G.KILL_EXP[m.rank] * (sp ? sp.exp : 1) * hr);
  const r = await grantExp(cur.id, gain);
  const gold = Math.round(G.rollGold(m.rank) * (sp ? sp.gold : 1) * hr); await grantGold(cur.id, gold);
  let taint = 0, taintNow = null, note = '';
  if (sp && sp.purge) {
    const pr = await applyItemEffect(cur.id, 'taint', -sp.purge, now);
    taintNow = pr ? pr.after : null; note = '오염도 -' + sp.purge + '% 정화';
    if (m.name === '오염 사냥꾼') {
      const hs = await SYSMSG.hunterKilled(db, now);      // 서버 전체 토벌 횟수 +1 · 자동 시스템 팝업(켜져 있을 때)
      note += ' · 오염 사냥꾼이 한층 강해졌다' + (hs.kills <= G.HUNTER_LV_MAX ? ' (' + hs.kills + '단계)' : ' (최대 단계)');
    }
  } else { taint = eqTaint(G.rollTaint(m.rank), eb); taintNow = await grantTaint(cur.id, taint); }
  if (sp && sp.drop) {
    await giveItem(cur.id, sp.drop[0], sp.drop[1]); await logAcquire(cur.id, 'item', sp.drop[0], sp.drop[1], m.name + ' 토벌', now);
    note = sp.drop[0] + ' ×' + sp.drop[1] + ' 획득';
  }
  await equipWear(cur.id);
  await logHunt(cur.id, m, 'success', gain, now);
  await logAcquire(cur.id, 'exp', '경험치', gain, m.name + ' 토벌', now);
  await logAcquire(cur.id, 'gold', '골드', gold, m.name + ' 토벌', now);
  await questProg(cur, 'kill', 1, G.RANK_IDX[m.rank]);
  const ember = await EV.onKill(cur, m, now);      // [EVENT:HALLOWEEN] 잡귀 처치 시 도깨비 불씨
  return { payload: { result: 'success', gain, gold, taint, taintNow, levelUp: r.up, lv: r.lv, exp: r.exp, ember: ember || undefined, note: note || undefined } };
}
// 토벌 실패 처리
async function huntLose(cur, m, myStats, eb, now) {
  await equipWear(cur.id);
  await logHunt(cur.id, m, 'fail', 0, now);
  // 행운: 실패해도 시간 제한 없이 바로 재토벌할 수 있습니다 (1회). 재토벌에서 또 실패하면 보통의 대기 시간이 적용됩니다.
  const prev = await db.get('SELECT free FROM fail_cd WHERE user_id = ? AND monster_id = ?', [cur.id, m.id]);
  const free = !(prev && prev.free === 1) && G.chance01() < G.freeChance(myStats.luck);
  const until = free ? now : now + G.cdOf(m.rank);
  await db.run(`INSERT INTO fail_cd (user_id, monster_id, until, free) VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, monster_id) DO UPDATE SET until = excluded.until, free = excluded.free`, [cur.id, m.id, until, free ? 1 : 0]);
  const hp = await applyHpLoss(cur.id, m.rank, now, eb);
  // 오염 2단계(60%)부터: 토벌에 실패하면 골드를 잃습니다 (그 등급 평균 토벌 골드의 배수, 가진 만큼까지)
  let goldLoss = 0;
  if (stageOf(cur) >= 2) {
    const kg = G.KILL_GOLD[m.rank] || [0, 0], g0 = await db.get('SELECT gold FROM users WHERE id = ?', [cur.id]);
    goldLoss = Math.min(Number(g0 && g0.gold) || 0, Math.round((kg[0] + kg[1]) / 2 * G.TAINT_LOSE_GOLD_MUL));
    if (goldLoss > 0) { await db.run('UPDATE users SET gold = MAX(0, gold - ?) WHERE id = ?', [goldLoss, cur.id]); }
  }
  return { result: 'fail', goldLoss: goldLoss || undefined, until, free, hpLoss: hp.loss, prevented: hp.prevented, hpNow: hp.hp, dying: hp.dying, dyingUntil: hp.dying ? hp.until : 0 };
}

// ═════════════ 턴제 전투 ═════════════
const btView = (b, extra) => Object.assign({
  mon: b.mname, rank: b.mrank, mhp: b.mhp, mmax: b.mmax, php: b.php, pmax: b.pmax, round: b.round, intent: b.intent,
  heavyCd: b.cd_heavy, guarded: !!b.buff, log: (() => { try { return JSON.parse(b.log); } catch (_) { return []; } })(), id: b.monster_id,
}, extra || {});
async function battleLive(uid, now) {
  const b = await db.get('SELECT user_id, monster_id, mname, mrank, mhp, mmax, php, pmax, round, intent, cd_heavy, buff, log, ver, started, upd FROM battles WHERE user_id = ?', [uid]);
  if (!b) return null;
  const m = await db.get('SELECT id, spawned_at, rank, corrupt_of FROM monsters WHERE id = ?', [b.monster_id]);
  if (now - b.upd > G.BT.idleMs || !m || now - m.spawned_at >= G.activeMsOf(m.rank)) {        // 오래 방치했거나 몬스터가 사라짐: 불이익 없이 취소
    await db.run('DELETE FROM battles WHERE user_id = ? AND ver = ?', [uid, b.ver]);
    return null;
  }
  return b;
}
const hunterLv = async () => (await SYSMSG.hunterState(db)).kills;      // 오염 사냥꾼 강화 단계 = 서버 전체 토벌 횟수 (G.HUNTER_LV_MAX 에서 멈춤)
async function battleStart(cur, m, myStats, now) {
  const have = await battleLive(cur.id, now);
  if (have) return have.monster_id === m.id ? { view: btView(have) } : { error: 'in_battle', view: btView(have) };
  const pl = G.btPlayer(cur.lv, myStats), hl = m.name === '오염 사냥꾼' ? await hunterLv(cur.id) : 0, mo = G.btMon(m.rank, m.name, pl, hl);
  const log = JSON.stringify([m.name + '이(가) 나타났다!' + (hl > 0 ? ' (강화 ' + hl + '단계)' : '') + ' 전투 시작.']);
  const ins = await db.run('INSERT OR IGNORE INTO battles (user_id, monster_id, mname, mrank, mhp, mmax, php, pmax, round, intent, cd_heavy, buff, log, ver, started, upd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0, ?, 0, ?, ?)',
    [cur.id, m.id, m.name, m.rank, mo.hp, mo.hp, pl.max, pl.max, 'atk', log, now, now]);
  const b = await db.get('SELECT user_id, monster_id, mname, mrank, mhp, mmax, php, pmax, round, intent, cd_heavy, buff, log, ver, started, upd FROM battles WHERE user_id = ?', [cur.id]);
  if (ins.changes !== 1 && b.monster_id !== m.id) return { error: 'in_battle', view: btView(b) };
  return { view: btView(b) };
}
route('GET', '/api/battle', async (req, res, ctx) => {
  const b = await battleLive(ctx.user.id, Date.now());
  send(res, 200, { battle: b ? btView(b) : null });
});
route('POST', '/api/battle/act', async (req, res, ctx) => {
  if (await limited('btl:' + ctx.user.id, 120, 60000)) return fail(res, 429, 'rate_limited');
  const now = Date.now(), action = String(ctx.body.action || '');
  if (!['attack', 'heavy', 'guard', 'flee'].includes(action)) return fail(res, 400, 'bad_action');
  const cur = await userById(ctx.user.id);
  const b = await battleLive(cur.id, now);
  if (!b) return fail(res, 404, 'no_battle');
  if (corruptLock(cur, now)) return fail(res, 409, 'corrupted', { until: cur.corrupt_until });
  if (action === 'heavy' && b.cd_heavy > 0) return fail(res, 409, 'heavy_cd', { battle: btView(b) });
  const m = await db.get('SELECT id, region, name, rank, spawned_at, owner_id, rumor_id, corrupt_of FROM monsters WHERE id = ?', [b.monster_id]);
  const eb = await equipBonus(cur.id), myStats = withEq(JSON.parse(cur.stats), eb);
  const pl = G.btPlayer(cur.lv, myStats), hl = b.mname === '오염 사냥꾼' ? await hunterLv(cur.id) : 0, mo = G.btMon(b.mrank, b.mname, pl, hl), BT = G.BT;
  const log = [];
  let mhp = b.mhp, php = b.php, buff = b.buff, cd = Math.max(0, b.cd_heavy - 1), outcome = null;
  const rr = (lo, hi) => lo + Math.random() * (hi - lo);
  // 내 행동
  if (action === 'flee') {
    if (Math.random() < pl.flee) { outcome = 'fled'; log.push('전투에서 빠져나왔다!'); }
    else log.push('도망치지 못했다!');
  } else if (action === 'guard') {
    buff = 1; log.push('방어 자세를 취했다. (이번 라운드 피해 감소 · 다음 공격 강화)');
  } else {
    let hit = true, mul = 1;
    if (action === 'heavy') { mul = BT.heavy.mul; cd = BT.heavy.cd; hit = Math.random() < BT.heavy.hit; }
    if (!hit) log.push('강타가 빗나갔다!');
    else {
      let dmg = pl.atk * mul * rr(0.85, 1.15);
      if (buff) { dmg *= 1 + BT.guardBonus; buff = 0; }
      const crit = Math.random() < pl.crit; if (crit) dmg *= 1.8;
      dmg = Math.max(1, Math.round(dmg));
      mhp = Math.max(0, mhp - dmg);
      const sp = G.SPECIAL_MON[b.mname];
      const held = !!(sp && sp.minRounds && mhp <= 0 && b.round < sp.minRounds + G.hunterScale(hl).rounds);      // 오염 사냥꾼: 10라운드가 지나기 전에는 쓰러지지 않음
      if (held) mhp = 1;
      log.push((action === 'heavy' ? '강타! ' : '공격! ') + b.mname + '에게 ' + dmg + ' 피해' + (crit ? ' (치명타!)' : '') + '.');
      if (held) log.push(b.mname + '은(는) 쓰러지지 않고 버텨냈다!');
    }
  }
  const guarding = action === 'guard';
  if (action !== 'guard' && action !== 'flee') { /* buff는 위에서 소모 */ }
  if (!outcome && mhp <= 0) outcome = 'win';
  // 몬스터 행동
  if (!outcome) {
    const heavy = b.intent === 'heavy';
    if (Math.random() < pl.dodge) log.push(b.mname + '의 ' + (heavy ? '강공' : '공격') + '을 피했다!');
    else {
      let dmg = mo.atk * (heavy ? BT.mHeavy : 1) * rr(0.85, 1.15);
      if (b.round > 20) dmg *= 1 + (b.round - 20) * 0.1;        // 오래 끌면 몬스터가 광폭해짐
      if (guarding) dmg *= BT.guardTaken;
      dmg = Math.max(1, Math.round(dmg));
      php = Math.max(0, php - dmg);
      log.push(b.mname + '의 ' + (heavy ? '강공!' : '공격!') + ' ' + dmg + ' 피해를 입었다' + (guarding ? ' (방어로 감소)' : '') + '.');
    }
    if (php <= 0) outcome = 'lose';
    else if (b.round >= BT.maxRound) { outcome = 'lose'; log.push('전투가 너무 길어져 쓰러졌다…'); }
  }
  const round = b.round + 1;
  const intent = round >= 2 && Math.random() < BT.mHeavyChance ? 'heavy' : 'atk';
  const prevLog = (() => { try { return JSON.parse(b.log); } catch (_) { return []; } })();
  const nlog = prevLog.concat(['— ' + b.round + '라운드 —'], log).slice(-40);
  if (!outcome) {
    const w = await db.run('UPDATE battles SET mhp = ?, php = ?, round = ?, intent = ?, cd_heavy = ?, buff = ?, log = ?, ver = ver + 1, upd = ? WHERE user_id = ? AND ver = ?',
      [mhp, php, round, intent, cd, buff, JSON.stringify(nlog), now, cur.id, b.ver]);
    if (w.changes !== 1) return fail(res, 409, 'busy');
    const nb = await db.get('SELECT user_id, monster_id, mname, mrank, mhp, mmax, php, pmax, round, intent, cd_heavy, buff, log, ver, started, upd FROM battles WHERE user_id = ?', [cur.id]);
    return send(res, 200, { done: false, battle: btView(nb, { last: log }) });
  }
  // 전투 종료: 먼저 전투 기록을 지워 한 번만 정산합니다
  const del = await db.run('DELETE FROM battles WHERE user_id = ? AND ver = ?', [cur.id, b.ver]);
  if (del.changes !== 1) return fail(res, 409, 'busy');
  const finalView = btView(Object.assign({}, b, { mhp, php, round: b.round, intent: b.intent, log: JSON.stringify(nlog), cd_heavy: cd, buff }), { last: log });
  if (outcome === 'fled') return send(res, 200, { done: true, outcome, battle: finalView, result: null });
  if (!m) return send(res, 200, { done: true, outcome: 'fled', battle: finalView, result: null });
  if (outcome === 'win') {
    const w = await huntWin(cur, m, eb, now);
    if (w.err) return send(res, 200, { done: true, outcome: 'fled', battle: finalView, result: null, error: w.err });
    return send(res, 200, { done: true, outcome, battle: finalView, result: w.payload });
  }
  return send(res, 200, { done: true, outcome, battle: finalView, result: await huntLose(cur, m, myStats, eb, now) });
});

route('POST', '/api/results/ack', async (req, res, ctx) => {
  const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids.slice(0, 100).map(Number).filter(Number.isInteger) : [];
  if (ids.length) await db.batch(ids.map(id => ['UPDATE s_attempts SET notified = 1 WHERE id = ? AND user_id = ?', [id, ctx.user.id]]));
  send(res, 200, { ok: true });
});

route('GET', '/api/friends', async (req, res, ctx) => {
  const rows = await db.all(`SELECT u.code, u.hunter_name AS hn, u.rank, u.corrupt_flag AS cf, u.last_seen AS ls,
      (SELECT COUNT(*) FROM messages m WHERE m.from_id = f.friend_id AND m.to_id = f.user_id AND m.id > f.last_read) AS unread
    FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.hunter_name`, [ctx.user.id]);
  const inc = await db.all(`SELECT u.code, u.hunter_name AS hn, u.rank, r.at FROM friend_requests r JOIN users u ON u.id = r.from_id
    WHERE r.to_id = ? ORDER BY r.at DESC LIMIT 100`, [ctx.user.id]);
  const out = await db.all(`SELECT u.code, u.hunter_name AS hn, u.rank, r.at FROM friend_requests r JOIN users u ON u.id = r.to_id
    WHERE r.from_id = ? ORDER BY r.at DESC LIMIT 100`, [ctx.user.id]);
  const mp = x => ({ code: x.code, hn: x.hn, rank: x.rank, at: x.at });
  const nowMs = Date.now();
  send(res, 200, { friends: rows.map(f => ({ code: f.code, hn: f.hn, rank: f.rank, unread: f.unread, corrupt: !!f.cf, on: nowMs - (Number(f.ls) || 0) < 120000 })), incoming: inc.map(mp), outgoing: out.map(mp) });
});

const makeFriends = (a, b) => db.batch([
  ['INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)', [a, b]],
  ['INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)', [b, a]],
  ['DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)', [a, b, b, a]],
]);

// 고유 코드로 친구 요청을 보냅니다. 상대가 수락해야 친구가 되고 메신저를 쓸 수 있습니다.
route('POST', '/api/friends', async (req, res, ctx) => {
  const u = ctx.user;
  if (await limited('addf:' + u.id, 15, 60000)) return fail(res, 429, 'rate_limited');
  const code = normCode(ctx.body.code);
  if (!code) return fail(res, 400, 'bad_code');
  if (code === u.code) return fail(res, 400, 'self');
  const f = await userByCode(code);
  if (!f) return fail(res, 404, 'not_found');
  if (await isFriend(u.id, f.id)) return fail(res, 409, 'already');
  // 상대가 이미 나에게 요청을 보낸 상태라면 바로 친구가 됩니다.
  if (await db.get('SELECT 1 AS x FROM friend_requests WHERE from_id = ? AND to_id = ?', [f.id, u.id])) {
    await makeFriends(u.id, f.id);
    return send(res, 201, { accepted: true, friend: { code: f.code, hn: f.hunter_name, rank: f.rank, unread: 0 } });
  }
  if (await db.get('SELECT 1 AS x FROM friend_requests WHERE from_id = ? AND to_id = ?', [u.id, f.id])) return fail(res, 409, 'pending');
  const cnt = await db.get('SELECT COUNT(*) AS c FROM friend_requests WHERE from_id = ?', [u.id]);
  if (cnt.c >= 30) return fail(res, 429, 'too_many_pending');
  await db.run('INSERT OR IGNORE INTO friend_requests (from_id, to_id, at) VALUES (?, ?, ?)', [u.id, f.id, Date.now()]);
  send(res, 201, { requested: true, to: { code: f.code, hn: f.hunter_name } });
});

route('POST', '/api/friends/respond', async (req, res, ctx) => {
  const u = ctx.user;
  const f = await userByCode(normCode(ctx.body.code));
  if (!f) return fail(res, 404, 'not_found');
  const rq = await db.get('SELECT 1 AS x FROM friend_requests WHERE from_id = ? AND to_id = ?', [f.id, u.id]);
  if (!rq) return fail(res, 404, 'no_request');
  if (ctx.body.accept) await makeFriends(u.id, f.id);
  else await db.run('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?', [f.id, u.id]);
  send(res, 200, { ok: true, accepted: !!ctx.body.accept });
});

route('POST', '/api/friends/read', async (req, res, ctx) => {
  const u = ctx.user;
  const f = await userByCode(normCode(ctx.body.code));
  if (!f || !(await isFriend(u.id, f.id))) return fail(res, 404, 'not_found');
  const last = await db.get('SELECT MAX(id) AS m FROM messages WHERE from_id = ? AND to_id = ?', [f.id, u.id]);
  if (last && last.m) await db.run('UPDATE friends SET last_read = MAX(last_read, ?) WHERE user_id = ? AND friend_id = ?', [last.m, u.id, f.id]);
  send(res, 200, { ok: true });
});

// 친구 삭제: 양쪽 친구 관계와 둘 사이의 대화를 지웁니다.
route('POST', '/api/friends/remove', async (req, res, ctx) => {
  const u = ctx.user;
  const f = await userByCode(normCode(ctx.body.code));
  if (!f || !(await isFriend(u.id, f.id))) return fail(res, 404, 'not_found');
  await db.batch([
    ['DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', [u.id, f.id, f.id, u.id]],
    ['DELETE FROM messages WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)', [u.id, f.id, f.id, u.id]],
    ['DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)', [u.id, f.id, f.id, u.id]],
  ]);
  send(res, 200, { ok: true });
});

route('POST', '/api/friends/cancel', async (req, res, ctx) => {
  const f = await userByCode(normCode(ctx.body.code));
  if (!f) return fail(res, 404, 'not_found');
  await db.run('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?', [ctx.user.id, f.id]);
  send(res, 200, { ok: true });
});

// 친구 프로필: 이미지, 헌터 네임, 등급, 현재 위치, 소개글, 대표 업적(가장 최근 획득 1개), 등록(달아 둔) 업적
const traitsOf = raw => { try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a.map(String).slice(0, 5) : []; } catch (_) { return []; } };
route('GET', '/api/friend/profile', async (req, res, ctx) => {
  const u = ctx.user;
  const f = await userByCode(normCode(new URL(req.url, 'http://x').searchParams.get('code')));
  if (!f || !(await isFriend(u.id, f.id))) return fail(res, 404, 'not_found');
  await syncAchEarned(f, Date.now(), true);
  const a = await db.get(`SELECT a.name, a.descr, e.at FROM ach_earned e JOIN achievements a ON a.id = e.ach_id
    WHERE e.user_id = ? ORDER BY e.at DESC, e.rowid DESC LIMIT 1`, [f.id]);
  send(res, 200, { profile: { code: f.code, hn: f.hunter_name, rank: f.rank, image: imgUrl(f.id, f.img_ver),
    region: G.placeLong(f.region), ach: a ? { name: a.name, desc: a.descr, at: a.at } : null,
    bio: f.bio || '', pins: pinnedList(f, await loadAch()).map(p => p.name), traits: traitsOf((await withText(f)).traits),
    corrupt: !!f.corrupt_flag, canRescue: !!f.corrupt_flag && !!(await findCure(u.id)) } });
});


route('GET', '/api/messages', async (req, res, ctx) => {
  const u = ctx.user, url = new URL(req.url, 'http://x');
  const f = await db.get('SELECT id, code FROM users WHERE code = ?', [normCode(url.searchParams.get('with'))]);
  if (!f || !(await isFriend(u.id, f.id))) return fail(res, 404, 'not_found');
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
  const M = m => ({ id: m.id, me: m.from_id === u.id, t: m.from_id === u.id ? m.text : G.garble(m.text, m.taint, m.id), ts: m.ts });   // 보낸 사람 오염도가 높으면 받는 사람에게만 글자가 깨져 보임
  // 미리보기: 최근 4개만 돌려주고 읽음 처리는 하지 않습니다.
  if (url.searchParams.get('preview')) {
    const pr = await db.all(`SELECT id, from_id, text, ts, taint FROM (SELECT id, from_id, text, ts, taint FROM messages
        WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id DESC LIMIT 4) ORDER BY id`, [u.id, f.id, f.id, u.id]);
    return send(res, 200, { messages: pr.map(M) });
  }
  const rows = after
    ? await db.all(`SELECT id, from_id, text, ts, taint FROM messages
        WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND id > ? ORDER BY id LIMIT 200`, [u.id, f.id, f.id, u.id, after])
    : await db.all(`SELECT id, from_id, text, ts, taint FROM (SELECT id, from_id, text, ts, taint FROM messages
        WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id DESC LIMIT 100) ORDER BY id`, [u.id, f.id, f.id, u.id]);
  if (rows.length) await db.run('UPDATE friends SET last_read = MAX(last_read, ?) WHERE user_id = ? AND friend_id = ?', [rows[rows.length - 1].id, u.id, f.id]);
  send(res, 200, { messages: rows.map(M) });
});

route('POST', '/api/messages', async (req, res, ctx) => {
  const u = ctx.user;
  if (u.block_flags & 8) return fail(res, 403, 'blocked', { what: 'msg' });
  if (await limited('msg:' + u.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  const f = await userByCode(normCode(ctx.body.to));
  const text = String(ctx.body.text || '').trim();
  if (!f || !(await isFriend(u.id, f.id))) return fail(res, 404, 'not_found');
  if (!text || cp(text) > 200) return fail(res, 400, 'bad_text');
  const ts = Date.now();
  const tn = Number(JSON.parse((await db.get('SELECT stats FROM users WHERE id = ?', [u.id])).stats).taint) || 0;
  const r = await db.run('INSERT INTO messages (from_id, to_id, text, ts, taint) VALUES (?, ?, ?, ?, ?)', [u.id, f.id, text, ts, tn]);
  send(res, 201, { message: { id: r.lastId, me: true, t: text, ts } });
});

route('GET', '/api/notices', async (req, res, ctx) => {
  const rows = await db.all(`SELECT n.id, n.title, n.text, n.item, n.qty, n.created_at,
      (SELECT 1 FROM notice_claims c WHERE c.user_id = ? AND c.notice_id = n.id) AS claimed
    FROM notices n WHERE NOT EXISTS (SELECT 1 FROM notice_del d WHERE d.user_id = ? AND d.notice_id = n.id) ORDER BY n.id DESC LIMIT 50`, [ctx.user.id, ctx.user.id]);
  // 아이템은 알림이 발송된 뒤에 가입한 헌터에게는 지급되지 않습니다
  send(res, 200, { notices: rows.map(n => ({ id: n.id, title: n.title || '', text: n.text, ts: n.created_at,
    item: n.item || '', qty: n.item ? n.qty : 0, claimed: !!n.claimed, can: !!n.item && ctx.user.created_at < n.created_at && (n.item !== EV.EMBER || EV.on()) })), seen: ctx.user.notice_seen });
});

// 알림에 첨부된 아이템 수령 (헌터당 알림 1회)
route('POST', '/api/notices/claim', async (req, res, ctx) => {
  if (await limited('claim:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  const n = await db.get('SELECT id, item, qty, created_at FROM notices WHERE id = ?', [Number(ctx.body.id) || 0]);
  if (!n) return fail(res, 404, 'no_notice');
  if (!n.item) return fail(res, 400, 'no_item');
  if (!(ctx.user.created_at < n.created_at)) return fail(res, 403, 'not_eligible');
  if (n.item === EV.EMBER && !EV.on()) return fail(res, 403, 'event_off');      // 이벤트가 꺼진 뒤에는 도깨비 불씨 수령 불가
  const now = Date.now();
  const eq = EQ_BY_NAME.get(n.item);       // 첨부 아이템이 장비이면 장비 보관함으로 지급 (장비는 개당 내구도를 가짐)
  if (eq) {
    const own = await db.get('SELECT COUNT(*) AS c FROM equip_inv WHERE user_id = ?', [ctx.user.id]);
    if (Number(own.c) + n.qty > EQ_MAX_OWN) return fail(res, 409, 'full', { max: EQ_MAX_OWN });
  }
  const c = await db.run('INSERT OR IGNORE INTO notice_claims (user_id, notice_id, at) VALUES (?, ?, ?)', [ctx.user.id, n.id, now]);
  if (c.changes !== 1) return fail(res, 409, 'claimed');
  try {
    if (eq) {
      for (let i = 0; i < n.qty; i++) await db.run('INSERT INTO equip_inv (user_id, key, dur, equipped, at) VALUES (?, ?, ?, 0, ?)', [ctx.user.id, eq.id, G.EQ_GRADE[eq.grade].dur, now]);
      await logAcquire(ctx.user.id, 'item', eq.name + ' (' + eq.grade + '급 장비)', n.qty, '시스템 알림', now);
      return send(res, 200, { ok: true, item: n.item, qty: n.qty });
    }
    await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + excluded.qty)', [ctx.user.id, n.item, n.qty]);
  } catch (e) {
    await db.run('DELETE FROM notice_claims WHERE user_id = ? AND notice_id = ?', [ctx.user.id, n.id]);
    throw e;
  }
  await logAcquire(ctx.user.id, 'item', n.item, n.qty, '시스템 알림', now);
  send(res, 200, { ok: true, item: n.item, qty: n.qty });
});

// 읽은 알림만 지울 수 있습니다 (알림 목록을 한 번 열어 '읽음'으로 기록된 뒤에만)
route('POST', '/api/notices/delete', async (req, res, ctx) => {
  const id = Number(ctx.body.id);
  if (!Number.isInteger(id) || id < 1) return fail(res, 400, 'bad_id');
  if (!(await db.get('SELECT 1 AS x FROM notices WHERE id = ?', [id]))) return fail(res, 404, 'no_notice');
  const me = await db.get('SELECT notice_seen FROM users WHERE id = ?', [ctx.user.id]);
  if (!me || id > me.notice_seen) return fail(res, 409, 'unread');
  const nn = await db.get('SELECT item, created_at FROM notices WHERE id = ?', [id]);
  if (nn.item && ctx.user.created_at < nn.created_at && !(await db.get('SELECT 1 AS x FROM notice_claims WHERE user_id = ? AND notice_id = ?', [ctx.user.id, id]))) return fail(res, 409, 'unclaimed');
  await db.run('INSERT OR IGNORE INTO notice_del (user_id, notice_id) VALUES (?, ?)', [ctx.user.id, id]);
  send(res, 200, { ok: true });
});

route('POST', '/api/notices/seen', async (req, res, ctx) => {
  await db.run('UPDATE users SET notice_seen = (SELECT COALESCE(MAX(id), 0) FROM notices) WHERE id = ?', [ctx.user.id]);
  send(res, 200, { ok: true });
});

// 관리자 알림 발송: 관리자 창(로그인 쿠키) 또는 ADMIN_TOKEN(Bearer) 중 하나로 인증
route('POST', '/api/admin/notice', async (req, res, ctx) => {
  if (await limited('admin:' + ctx.ip, 60, 10 * 60000)) return fail(res, 429, 'rate_limited');
  let okAuth = await authAdmin(req);
  if (!okAuth) {
    if (!ADMIN_TOKEN) return fail(res, 401, 'unauthorized');
    const h = String(req.headers.authorization || '');
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    okAuth = !!tok && safeEq(sha256(tok), sha256(ADMIN_TOKEN));
  }
  if (!okAuth) return fail(res, 401, 'unauthorized');
  const text = String(ctx.body.text || '').trim();
  const title = String(ctx.body.title || '').trim();
  if (!text || cp(text) > 300 || cp(title) > 40) return fail(res, 400, 'bad_text');      // 본문 최대 300자, 제목 최대 40자
  const item = String(ctx.body.item == null ? '' : ctx.body.item).trim();
  const qty = item ? Number(ctx.body.qty) : 0;
  if (item && (cp(item) > 30 || !Number.isInteger(qty) || qty < 1 || qty > (EQ_BY_NAME.has(item) ? EQ_MAX_OWN : 9999))) return fail(res, 400, 'bad_item');
  const r = await db.run('INSERT INTO notices (title, text, item, qty, created_at) VALUES (?, ?, ?, ?, ?)', [title, text, item, qty, Date.now()]);
  send(res, 201, { id: r.lastId });
}, { auth: false });

// 관리자: 보낸 시스템 알림 목록 · 내용 수정 (제목·본문만 고칠 수 있고, 첨부 아이템과 수령 기록은 그대로)
route('GET', '/api/admin/notices', async (req, res) => {
  const rows = await db.all('SELECT id, title, text, item, qty, created_at FROM notices ORDER BY id DESC LIMIT 30');
  send(res, 200, { notices: rows.map(n => ({ id: n.id, title: n.title || '', text: n.text, item: n.item || '', qty: n.item ? n.qty : 0, ts: n.created_at })) });
}, { auth: false, admin: true });
route('POST', '/api/admin/notice/edit', async (req, res, ctx) => {
  const id = Number(ctx.body.id) || 0;
  const text = String(ctx.body.text || '').trim();
  const title = String(ctx.body.title || '').trim();
  if (!text || cp(text) > 300 || cp(title) > 40) return fail(res, 400, 'bad_text');
  const r = await db.run('UPDATE notices SET title = ?, text = ? WHERE id = ?', [title, text, id]);
  if (!r.changes) return fail(res, 404, 'no_notice');
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// ───────────── 관리자 창 ─────────────
route('POST', '/api/admin/login', async (req, res, ctx) => {
  if (!ADMIN_ID || !ADMIN_PASSWORD) return fail(res, 503, 'admin_disabled');
  if (await limited('alogin:' + ctx.ip, 6, 10 * 60000)) return fail(res, 429, 'rate_limited');
  const id = String(ctx.body.id || ''), pw = String(ctx.body.password || '');
  const ok = safeEq(sha256(id), sha256(ADMIN_ID)) & safeEq(sha256(pw), sha256(ADMIN_PASSWORD));   // 둘 다 항상 비교
  if (!ok) { await new Promise(r => setTimeout(r, 600)); return fail(res, 401, 'bad_credentials'); }
  const token = crypto.randomBytes(32).toString('base64url');
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, -1, ?)', [sha256(token), Date.now() + ADMIN_MS]);
  send(res, 200, { ok: true }, { 'Set-Cookie': adminCookie(token, ADMIN_MS / 1000) });
}, { auth: false });

route('POST', '/api/admin/logout', async (req, res) => {
  const t = cookies(req).asid;
  if (t) await db.run('DELETE FROM sessions WHERE token_hash = ? AND user_id = -1', [sha256(t)]);
  send(res, 200, { ok: true }, { 'Set-Cookie': adminCookie('', 0) });
}, { auth: false });

route('GET', '/api/admin/overview', async (req, res) => {
  const [users, ranks, kills, hunts, pend, notices] = await Promise.all([
    db.get('SELECT COUNT(*) AS c FROM users'),
    db.all('SELECT rank, COUNT(*) AS c FROM users GROUP BY rank'),
    db.get("SELECT COALESCE(SUM(n), 0) AS c FROM hunt_log WHERE result = 'success'"),
    db.all('SELECT result, SUM(n) AS c FROM hunt_log GROUP BY result'),
    db.get('SELECT COUNT(*) AS c FROM s_attempts WHERE resolved = 0'),
    db.get('SELECT COUNT(*) AS c FROM notices'),
  ]);
  send(res, 200, { users: users.c, ranks, kills: kills.c, hunts, pendingS: pend.c, notices: notices.c, now: Date.now() });
}, { auth: false, admin: true });

// 동시 접속자 수: 최근 2분 안에 요청을 보낸 헌터 (탭이 백그라운드여도 1분에 한 번은 요청이 가므로 2분 기준)
route('GET', '/api/admin/online', async (req, res) => {
  const now = Date.now();
  const r = await db.get('SELECT SUM(CASE WHEN last_seen > ? THEN 1 ELSE 0 END) AS a, SUM(CASE WHEN last_seen > ? THEN 1 ELSE 0 END) AS b, SUM(CASE WHEN last_seen > ? THEN 1 ELSE 0 END) AS c FROM users',
    [now - 30000, now - 120000, now - 600000]);
  send(res, 200, { now30: Number(r.a) || 0, now2m: Number(r.b) || 0, now10m: Number(r.c) || 0, at: now });
}, { auth: false, admin: true });

route('GET', '/api/admin/players', async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 40);
  const like = '%' + q.replace(/[%_]/g, '') + '%';
  const rows = await db.all(`SELECT u.code, u.invite_code AS inv, u.hunter_name AS hn, u.name, u.rank, u.lv, u.exp, u.region, u.created_at, u.last_seen,
      (SELECT COALESCE(SUM(h2.n), 0) FROM hunt_log h2 WHERE h2.user_id = u.id AND h2.result = 'success') AS kills,
      (SELECT MAX(at) FROM hunt_log h WHERE h.user_id = u.id) AS last_hunt,
      (SELECT m.region FROM hunt_log h JOIN monsters m ON m.id = h.monster_id WHERE h.user_id = u.id ORDER BY h.id DESC LIMIT 1) AS last_region
    FROM users u WHERE (? = '' OR u.hunter_name LIKE ? OR u.name LIKE ? OR u.code LIKE ?)
    ORDER BY (u.hunter_name = ?) DESC, u.created_at DESC LIMIT 300`, [q, like, like, like.toUpperCase(), q]);
  const rn = id => id ? G.placeLong(id) : '';
  send(res, 200, { players: rows.map(r => ({ code: r.code, hunterName: r.hn, name: r.name, rank: r.rank, lv: r.lv, exp: r.exp,
    region: rn(r.region), lastRegion: rn(r.last_region), created: r.created_at, lastSeen: Number(r.last_seen) || 0, invite: r.inv || '', kills: r.kills, lastHunt: r.last_hunt || 0 })), now: Date.now() });
}, { auth: false, admin: true });

route('GET', '/api/admin/player', async (req, res) => {
  const code = normCode(new URL(req.url, 'http://x').searchParams.get('code'));
  const u = code && await userByCode(code);
  if (!u) return fail(res, 404, 'not_found');
  const [inv, acq, hunts, cnt, fr, pend] = await Promise.all([
    db.all('SELECT item, qty FROM inventory WHERE user_id = ? ORDER BY item', [u.id]),
    db.all('SELECT id, kind, name, qty, source, at FROM acquire_log WHERE user_id = ? ORDER BY id DESC LIMIT 200', [u.id]),
    db.all('SELECT id, mon, rank, result, exp_gain, at FROM hunt_log WHERE user_id = ? ORDER BY id DESC LIMIT 200', [u.id]),
    db.all('SELECT result, SUM(n) AS c FROM hunt_log WHERE user_id = ? GROUP BY result', [u.id]),
    db.get('SELECT COUNT(*) AS c FROM friends WHERE user_id = ?', [u.id]),
    db.all(`SELECT m.name, a.resolve_at FROM s_attempts a JOIN monsters m ON m.id = a.monster_id WHERE a.user_id = ? AND a.resolved = 0`, [u.id]),
  ]);
  const ach = await achOf(u);
  send(res, 200, {
    achievements: ach.map(a => ({ id: a.id, name: a.name, desc: a.descr, kind: a.kind, met: a.met, granted: a.granted, done: a.done })),
    player: Object.assign(publicUser(await withImage(u)), { inviteReward: await inviteRewardOf(u.id), invite: u.invite_code || '', created: u.created_at, lastSeen: Number(u.last_seen) || 0, region: G.placeLong(u.region), friends: fr.c }),
    items: inv, acquired: acq, hunts, counts: cnt, pendingS: pend.map(p => ({ mon: p.name, at: p.resolve_at })),
    activity: { corruptMonster: !!(await db.get('SELECT 1 AS x FROM monsters WHERE corrupt_of = ? AND spawned_at > ?', [u.id, Date.now() - CORRUPT_MON_MS])), adminChar: !!u.admin_char, blocked: u.block_flags | 0, corruptUntil: corruptLock(u, Date.now()) ? u.corrupt_until : 0, dyingUntil: u.dying_until > Date.now() ? u.dying_until : 0,
      taint: Number(JSON.parse(u.stats).taint) || 0, now: Date.now() },
  });
}, { auth: false, admin: true });

const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
route('POST', '/api/admin/player/update', async (req, res, ctx) => {
  const b = ctx.body;
  const u = await withText(await userByCode(normCode(b.code)));      // 성격·특징은 수정할 때만 읽음
  if (!u) return fail(res, 404, 'not_found');
  const str = v => String(v == null ? '' : v).trim();
  const hn = str(b.hunterName);
  if (cp(hn) < 2 || cp(hn) > 12) return fail(res, 400, 'bad_hunter_name');
  const lv = Number(b.lv), exp = Number(b.exp);
  if (!Number.isInteger(lv) || lv < 1 || lv > 999) return fail(res, 400, 'bad_lv');
  if (!Number.isInteger(exp) || exp < 0 || exp >= G.powNeed(lv)) return fail(res, 400, 'bad_exp', { max: G.powNeed(lv) - 1 });
  const stats = Object.assign({}, JSON.parse(u.stats));
  for (const k of ['hp', 'str', 'agi', 'luck']) {
    const v = Number(b.stats && b.stats[k]);
    const cap = k === 'hp' ? 9999 : G.STAT_MAX;      // 근력·민첩·행운 최대 100
    if (!Number.isInteger(v) || v < 0 || (v > cap && v !== Number(stats[k]))) return fail(res, 400, 'bad_stat', { field: k, max: cap });
    stats[k] = Math.min(v, cap);
  }
  if (b.stats && b.stats.taint !== undefined) {
    const t = Number(b.stats.taint);
    if (!Number.isFinite(t) || t < 0 || t > 100 || Math.round(t * 10) / 10 !== t) return fail(res, 400, 'bad_stat', { field: 'taint' });
    stats.taint = t;
  }
  // 프로필 항목 (보낸 경우에만 변경)
  let name = u.name, gender = u.gender, age = u.age, pers = u.personality, traits = JSON.parse(u.traits), rank = u.rank;
  if (b.name !== undefined) { name = str(b.name); if (!name || cp(name) > 30) return fail(res, 400, 'bad_name'); }
  if (b.gender !== undefined) { gender = b.gender; if (!['여성', '남성', '기타'].includes(gender)) return fail(res, 400, 'bad_gender'); }
  if (b.age !== undefined) { age = Number(b.age); if (!Number.isInteger(age) || age < 1 || age > 999) return fail(res, 400, 'bad_age'); }
  if (b.personality !== undefined) { pers = str(b.personality); if (!pers || cp(pers) > 1000) return fail(res, 400, 'bad_personality'); }
  if (b.traits !== undefined) {
    traits = Array.isArray(b.traits) ? b.traits.map(str).filter(Boolean) : null;
    if (!traits || traits.length > 5 || traits.some(t => cp(t) > 50)) return fail(res, 400, 'bad_traits');
  }
  // 명성: 레벨·등급이 올라가면 함께 오르고, 관리자가 명성 칸을 직접 바꿨다면 그 값을 따릅니다
  const oldStats = JSON.parse(u.stats);
  let fame = Number(oldStats.fame) || 0;
  const fameEdited = b.stats && b.stats.fame !== undefined && Number(b.stats.fame) !== fame;
  if (fameEdited) {
    fame = Number(b.stats.fame);
    if (!Number.isInteger(fame) || fame < 0 || fame > G.FAME_MAX) return fail(res, 400, 'bad_stat', { field: 'fame' });
  }
  let gold = u.gold;
  if (b.gold !== undefined) { gold = Number(b.gold); if (!Number.isInteger(gold) || gold < 0 || gold > 99999999) return fail(res, 400, 'bad_gold'); }
  if (b.rank !== undefined) { rank = b.rank; if (!RANKS.includes(rank)) return fail(res, 400, 'bad_rank'); }
  if (!fameEdited) {
    if (lv > u.lv) fame += (lv - u.lv) * G.FAME_PER_LV;
    if (G.RANK_IDX[rank] > G.RANK_IDX[u.rank]) fame += (G.RANK_IDX[rank] - G.RANK_IDX[u.rank]) * G.FAME_PER_RANK;
  }
  stats.fame = Math.min(G.FAME_MAX, fame);
  if (lv > u.lv) stats.sp = (stats.sp === undefined || stats.sp === null ? Math.max(0, u.lv - 1) : spOf(stats, u.lv)) + (lv - u.lv);   // 관리자가 전투력을 올려도 레벨당 스탯포인트 1
  if (Number(stats.hp) > G.HP_MIN) await db.run('UPDATE users SET dying_until = 0 WHERE id = ?', [u.id]);
  await db.run(`UPDATE users SET hunter_name = ?, stats = ?, lv = ?, exp = ?, name = ?, gender = ?, age = ?, personality = ?, traits = ?, rank = ?, gold = ? WHERE id = ?`,
    [hn, JSON.stringify(stats), lv, exp, name, gender, age, pers, JSON.stringify(traits), rank, gold, u.id]);
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// ── 아이템 / 습득 정보 / 토벌 기록 관리 ──
const adminTarget = async (ctx, res) => {
  const u = await userByCode(normCode(ctx.body.code));
  if (!u) { fail(res, 404, 'not_found'); return null; }
  return u;
};
const intIds = v => (Array.isArray(v) ? v : []).slice(0, 500).map(Number).filter(Number.isInteger);

// 아이템 추가·수량 변경 (같은 이름이면 수량을 덮어씁니다)
// ── 문의: 헌터 ↔ 관리자 1:1 대화 (메신저와 같은 방식, 상대는 관리자뿐) ──
const inqOut = m => ({ id: m.id, admin: !!m.from_admin, t: m.text, ts: m.ts });
route('GET', '/api/inquiry', async (req, res, ctx) => {
  const after = Math.max(0, Number(new URL(req.url, 'http://x').searchParams.get('after')) || 0);
  const rows = after
    ? await db.all('SELECT id, user_id, from_admin, text, ts FROM inquiries WHERE user_id = ? AND id > ? ORDER BY id LIMIT 200', [ctx.user.id, after])
    : await db.all('SELECT id, user_id, from_admin, text, ts FROM (SELECT id, user_id, from_admin, text, ts FROM inquiries WHERE user_id = ? ORDER BY id DESC LIMIT 100) ORDER BY id', [ctx.user.id]);
  if (rows.length) await db.run('UPDATE users SET inq_read = MAX(inq_read, ?) WHERE id = ?', [rows[rows.length - 1].id, ctx.user.id]);
  send(res, 200, { messages: rows.map(inqOut) });
});
route('POST', '/api/inquiry', async (req, res, ctx) => {
  if (await limited('inq:' + ctx.user.id, 20, 60000)) return fail(res, 429, 'rate_limited');
  const text = String(ctx.body.text || '').trim();
  if (!text || cp(text) > 200) return fail(res, 400, 'bad_text');
  const ts = Date.now();
  const r = await db.run('INSERT INTO inquiries (user_id, from_admin, text, ts) VALUES (?, 0, ?, ?)', [ctx.user.id, text, ts]);
  send(res, 201, { message: { id: r.lastId, admin: false, t: text, ts } });
});
const inqThreads = async () => (await db.all(`SELECT u.code, u.hunter_name AS hn, u.rank, COUNT(*) AS n,
    (SELECT i2.text FROM inquiries i2 WHERE i2.user_id = u.id ORDER BY i2.id DESC LIMIT 1) AS last,
    (SELECT i2.from_admin FROM inquiries i2 WHERE i2.user_id = u.id ORDER BY i2.id DESC LIMIT 1) AS last_admin,
    MAX(i.ts) AS ts FROM inquiries i JOIN users u ON u.id = i.user_id GROUP BY u.id ORDER BY ts DESC LIMIT 200`))
  .map(x => ({ code: x.code, hn: x.hn, rank: x.rank, n: x.n, last: x.last, waiting: !x.last_admin, ts: x.ts }));
const inqThread = async code => {
  const u = code && await userByCode(code);
  if (!u) return null;
  const rows = await db.all('SELECT id, user_id, from_admin, text, ts FROM (SELECT id, user_id, from_admin, text, ts FROM inquiries WHERE user_id = ? ORDER BY id DESC LIMIT 200) ORDER BY id', [u.id]);
  return { hn: u.hunter_name, code: u.code, messages: rows.map(inqOut) };
};
// 관리자 전용 캐릭터: 받은 문의를 메신저에서 열람 (읽기 전용)
route('GET', '/api/inquiry/inbox', async (req, res, ctx) => {
  if (!ctx.user.admin_char) return fail(res, 403, 'forbidden');
  const url = new URL(req.url, 'http://x'), code = normCode(url.searchParams.get('code'));
  if (code) { const t = await inqThread(code); return t ? send(res, 200, t) : fail(res, 404, 'not_found'); }
  send(res, 200, { threads: await inqThreads() });
});
route('GET', '/api/admin/inquiries', async (req, res) => {
  const code = normCode(new URL(req.url, 'http://x').searchParams.get('code'));
  if (code) { const t = await inqThread(code); return t ? send(res, 200, t) : fail(res, 404, 'not_found'); }
  send(res, 200, { threads: await inqThreads() });
}, { auth: false, admin: true });
route('POST', '/api/admin/inquiry/reply', async (req, res, ctx) => {
  const u = await adminTarget(ctx, res); if (!u) return;
  const text = String(ctx.body.text || '').trim();
  if (!text || cp(text) > 200) return fail(res, 400, 'bad_text');
  await db.run('INSERT INTO inquiries (user_id, from_admin, text, ts) VALUES (?, 1, ?, ?)', [u.id, text, Date.now()]);
  send(res, 200, { ok: true });
}, { auth: false, admin: true });
// 오염 폭주 해제: 활동 불가를 풀고, 그 헌터의 오염 몬스터를 즉시 소멸시키고, 오염도를 0%로 낮춤
route('POST', '/api/admin/player/uncorrupt', async (req, res, ctx) => {
  const u = await adminTarget(ctx, res); if (!u) return;
  for (let i = 0; i < 6; i++) {          // 오염도 0% (동시 요청에도 안전하게 비교 후 갱신)
    const cur = await db.get('SELECT stats FROM users WHERE id = ?', [u.id]);
    const st = JSON.parse(cur.stats); st.taint = 0;
    const w = await db.run('UPDATE users SET stats = ? WHERE id = ? AND stats = ?', [JSON.stringify(st), u.id, cur.stats]);
    if (w.changes === 1) break;
    if (i === 5) return fail(res, 409, 'conflict');
  }
  await db.run('UPDATE users SET corrupt_until = 0, corrupt_flag = 0 WHERE id = ?', [u.id]);
  await db.run('UPDATE monsters SET spawned_at = 0 WHERE corrupt_of = ?', [u.id]);   // 만료 처리 (토벌 기록이 있어도 목록에서 사라짐, 곧 정리됨)
  await db.run('DELETE FROM monsters WHERE corrupt_of = ? AND NOT EXISTS (SELECT 1 FROM kills k WHERE k.monster_id = monsters.id)', [u.id]);
  send(res, 200, { ok: true });
}, { auth: false, admin: true });
route('POST', '/api/admin/player/adminchar', async (req, res, ctx) => {
  const u = await adminTarget(ctx, res); if (!u) return;
  if (typeof ctx.body.on !== 'boolean') return fail(res, 400, 'bad_on');
  await db.run('UPDATE users SET admin_char = ? WHERE id = ?', [ctx.body.on ? 1 : 0, u.id]);
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// 활동 관리: allow 에서 true 인 활동만 가능, false 는 운영자가 막습니다
const ACT_BITS = { hunt: 1, move: 2, shop: 4, msg: 8 };
route('POST', '/api/admin/player/activity', async (req, res, ctx) => {
  const u = await adminTarget(ctx, res); if (!u) return;
  const allow = ctx.body.allow;
  if (!allow || typeof allow !== 'object') return fail(res, 400, 'bad_allow');
  let flags = 0;
  for (const k of Object.keys(ACT_BITS)) { if (typeof allow[k] !== 'boolean') return fail(res, 400, 'bad_allow'); if (!allow[k]) flags |= ACT_BITS[k]; }
  await db.run('UPDATE users SET block_flags = ? WHERE id = ?', [flags, u.id]);
  send(res, 200, { ok: true, blocked: flags });
}, { auth: false, admin: true });

route('POST', '/api/admin/player/item', async (req, res, ctx) => {
  const u = await adminTarget(ctx, res); if (!u) return;
  const item = String(ctx.body.item == null ? '' : ctx.body.item).trim(), qty = Number(ctx.body.qty);
  if (!item || cp(item) > 30) return fail(res, 400, 'bad_item');
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return fail(res, 400, 'bad_qty');
  const prev = await db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [u.id, item]);
  await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = excluded.qty', [u.id, item, qty]);
  const delta = qty - (prev ? prev.qty : 0);
  if (delta > 0) await logAcquire(u.id, 'item', item, delta, '운영자 지급', Date.now());
  if (delta < 0 && item === EV.EMBER) await EV.lossLog(u.id, -delta, '운영자 회수', Date.now());
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// 모든 유저에게 골드 일괄 지급 (보유 골드 상한 99,999,999 G)
route('POST', '/api/admin/gold/all', async (req, res, ctx) => {
  const amt = Number(ctx.body.amount);
  if (!Number.isInteger(amt) || amt < 1 || amt > 9999999) return fail(res, 400, 'bad_amount');
  if (await limited('goldall', 10, 60000)) return fail(res, 429, 'rate_limited');
  const now = Date.now(), CAP = 99999999;
  const n = await db.get('SELECT COUNT(*) AS c FROM users');
  await db.run('INSERT INTO acquire_log (user_id, kind, name, qty, source, at) SELECT id, ?, ?, MIN(?, ? - gold), ?, ? FROM users WHERE gold < ?', ['gold', '골드', amt, CAP, '관리자 일괄 지급', now, CAP]);
  await db.run('UPDATE users SET gold = MIN(?, gold + ?)', [CAP, amt]);
  send(res, 200, { ok: true, users: Number(n.c), amount: amt });
}, { auth: false, admin: true });

route('POST', '/api/admin/player/item/delete', async (req, res, ctx) => {
  const u = await adminTarget(ctx, res); if (!u) return;
  if (ctx.body.all === true || String(ctx.body.item || '') === EV.EMBER) { const eq = await db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [u.id, EV.EMBER]); if (eq) await EV.lossLog(u.id, eq.qty, '운영자 삭제', Date.now()); }
  if (ctx.body.all === true) await db.run('DELETE FROM inventory WHERE user_id = ?', [u.id]);
  else await db.run('DELETE FROM inventory WHERE user_id = ? AND item = ?', [u.id, String(ctx.body.item || '')]);
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// ───────────── 상점 ─────────────
route('GET', '/api/shop', async (req, res, ctx) => {
  const items = await db.all('SELECT id, name, descr, price, eff_stat, eff_amt FROM shop_items ORDER BY id');
  const stg = stageOf(ctx.user);       // 오염 단계가 오르면 상점 가격이 오릅니다
  send(res, 200, { gold: ctx.user.gold, markup: G.TAINT_SHOP_PCT[stg], items: items.map(i => ({ id: i.id, name: i.name, desc: i.descr, price: G.taintPrice(i.price, stg), eff: i.eff_stat ? { stat: i.eff_stat, amt: i.eff_amt } : null })) });
});

route('POST', '/api/shop/buy', async (req, res, ctx) => {
  if (await limited('buy:' + ctx.user.id, 60, G.HOUR)) return fail(res, 429, 'rate_limited');
  if (ctx.user.block_flags & 4) return fail(res, 403, 'blocked', { what: 'shop' });
  if (corruptLock(ctx.user, Date.now())) return fail(res, 409, 'corrupted', { until: ctx.user.corrupt_until });
  const it = await db.get('SELECT id, name, price FROM shop_items WHERE id = ?', [Number(ctx.body.id) || 0]);
  if (!it) return fail(res, 404, 'no_item');
  const qty = ctx.body.qty === undefined ? 1 : Number(ctx.body.qty);          // 한 번에 여러 개 구매 (1~9999)
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return fail(res, 400, 'bad_qty');
  const cur = await db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [ctx.user.id, it.name]);
  const have = cur ? Number(cur.qty) : 0;
  if (have + qty > 9999) return fail(res, 400, 'max_qty', { room: Math.max(0, 9999 - have) });
  const total = G.taintPrice(it.price, stageOf(ctx.user)) * qty;
  if (total > 0) {      // 잔액이 충분할 때만 원자적으로 차감
    const pay = await db.run('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?', [total, ctx.user.id, total]);
    if (pay.changes !== 1) return fail(res, 402, 'no_gold');
  }
  try {
    await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = MIN(9999, qty + excluded.qty)', [ctx.user.id, it.name, qty]);
  } catch (e) {
    if (total > 0) await grantGold(ctx.user.id, total);
    throw e;
  }
  await logAcquire(ctx.user.id, 'item', it.name, qty, total > 0 ? '상점 (-' + total + ' G)' : '상점', Date.now());
  const me = await db.get('SELECT gold FROM users WHERE id = ?', [ctx.user.id]);
  send(res, 200, { ok: true, item: it.name, qty, spent: total, gold: me.gold });
});

// 아이템 사용: 상점에 등록된 아이템의 효과대로 스탯이 바뀝니다 (예: 회복 포션 = 체력 +10)
const STAT_KO = { hp: '체력', str: '근력', agi: '민첩', luck: '행운', taint: '오염도' };
async function applyItemEffect(userId, stat, amt, now) {
  for (let i = 0; i < 6; i++) {
    const u = await db.get('SELECT stats, dying_until FROM users WHERE id = ?', [userId]);
    if (!u) return null;
    const st = JSON.parse(u.stats), before = Number(st[stat]) || 0;
    let after, dying = u.dying_until;
    if (stat === 'hp') {
      after = Math.max(G.HP_MIN, Math.min(Math.max(G.HP_START, before), before + amt));    // 체력은 100(원래 더 높았다면 그 값)까지만, 5 아래로는 내려가지 않음
      if (after > G.HP_MIN) dying = 0;                                                       // 5보다 높아지면 빈사 상태에서 벗어남
      else if (!dying) dying = now + G.HP_DYING_MS;
    } else if (stat === 'taint') after = Math.max(0, Math.min(100, Math.round((before + amt) * 10) / 10));
    else after = Math.max(0, Math.min(Math.max(G.STAT_MAX, before), before + amt));   // 근력·민첩·행운은 100까지(원래 더 높았다면 그 값 유지)
    st[stat] = after;
    const w = await db.run('UPDATE users SET stats = ?, dying_until = ? WHERE id = ? AND stats = ? AND dying_until = ?', [JSON.stringify(st), dying, userId, u.stats, u.dying_until]);
    if (w.changes === 1) return { before, after, dying: dying > now ? dying : 0 };
  }
  throw new Error('stat_conflict');
}
// 스탯 투자: 스탯포인트를 근력·민첩·행운 중 하나에 씁니다 (포인트 1당 스탯 +1)
// ── 스탯 초기화: 투자한 스탯포인트를 모두 돌려받는 대신 골드를 냅니다 (기본 요금 + 되돌려 받는 포인트 1개당 요금, 일괄 초기화) ──
// 투자한 포인트 = (전투력 레벨 - 1) - 남은 포인트. 이 기능 이전에 투자한 몫은 기록이 없어, 기록된 투자분을 먼저 빼고
// 나머지는 각 스탯이 1을 넘는 만큼에 비례해 뺍니다.
function resetPlan(st, lv) {
  const T = Math.max(0, (lv - 1) - spOf(st, lv));
  const out = Object.assign({}, st);
  const inv = Object.assign({ str: 0, agi: 0, luck: 0 }, st.inv);
  const keys = ['str', 'agi', 'luck'];
  let left = T;
  keys.forEach(k => { const d = Math.min(left, Math.max(0, Math.min(inv[k] | 0, (Number(out[k]) || 1) - 1))); out[k] = (Number(out[k]) || 1) - d; left -= d; });
  if (left > 0) {
    const ex = keys.map(k => Math.max(0, (Number(out[k]) || 1) - 1)), tot = ex.reduce((a, b) => a + b, 0);
    if (tot > 0) {
      const take = Math.min(left, tot);
      const q = ex.map(e => e * take / tot), f = q.map(Math.floor);
      let rem = take - f.reduce((a, b) => a + b, 0);
      q.map((v, i) => [v - f[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rem > 0 && f[i] < ex[i]) { f[i]++; rem--; } });
      keys.forEach((k, i) => { out[k] -= f[i]; });
    }
  }
  out.sp = spOf(st, lv) + T;
  delete out.inv;
  return { T, stats: out, cost: G.statResetCost(T) };
}
route('POST', '/api/stats/reset', async (req, res, ctx) => {
  if (await limited('streset:' + ctx.user.id, 10, 60000)) return fail(res, 429, 'rate_limited');
  for (let i = 0; i < 6; i++) {
    const u = await db.get('SELECT lv, stats, gold FROM users WHERE id = ?', [ctx.user.id]);
    const st = JSON.parse(u.stats), plan = resetPlan(st, u.lv);
    if (plan.T < 1) return fail(res, 400, 'nothing', { cost: 0 });
    if (Number(u.gold) < plan.cost) return fail(res, 400, 'no_gold', { cost: plan.cost, gold: Number(u.gold) });
    const w = await db.run('UPDATE users SET stats = ?, gold = gold - ? WHERE id = ? AND stats = ? AND gold >= ?', [JSON.stringify(plan.stats), plan.cost, ctx.user.id, u.stats, plan.cost]);
    if (w.changes === 1) return send(res, 200, { ok: true, stats: plan.stats, fx: fxOf(plan.stats), cost: plan.cost, gold: Number(u.gold) - plan.cost, points: plan.T });
  }
  fail(res, 409, 'busy');
});
route('POST', '/api/stats/invest', async (req, res, ctx) => {
  const stat = String(ctx.body.stat || ''), amt = ctx.body.amt === undefined ? 1 : Number(ctx.body.amt);
  if (!['str', 'agi', 'luck'].includes(stat)) return fail(res, 400, 'bad_stat');
  if (!Number.isInteger(amt) || amt < 1 || amt > 100) return fail(res, 400, 'bad_amt');
  for (let i = 0; i < 8; i++) {
    const u = await db.get('SELECT lv, stats FROM users WHERE id = ?', [ctx.user.id]);
    const st = JSON.parse(u.stats), sp = spOf(st, u.lv);
    if (sp < amt) return fail(res, 400, 'no_points', { sp });
    if ((Number(st[stat]) || 0) + amt > G.STAT_MAX) return fail(res, 400, 'max_stat', { max: G.STAT_MAX });
    st.sp = sp - amt; st[stat] = (Number(st[stat]) || 0) + amt;
    st.inv = Object.assign({ str: 0, agi: 0, luck: 0 }, st.inv); st.inv[stat] += amt;      // 투자한 만큼 기록 (초기화할 때 정확히 되돌리기 위해)
    const w = await db.run('UPDATE users SET stats = ? WHERE id = ? AND stats = ?', [JSON.stringify(st), ctx.user.id, u.stats]);
    if (w.changes === 1) return send(res, 200, { ok: true, stats: st, fx: fxOf(st) });
  }
  fail(res, 409, 'busy');
});

// ── 헌터 등급 승급 ──
// F~D급은 전투력(레벨)만 오르면 됩니다. C급부터는 처치 기록 등 조건이 더해집니다. (조건표: G.PROMO)
async function promoInfo(u) {
  const rule = G.PROMO[u.rank];
  if (!rule) return { rank: u.rank, next: '', conds: [], can: false, max: true };
  const conds = [{ t: '전투력 Lv.' + rule.lv + ' 이상', have: u.lv, need: rule.lv, ok: u.lv >= rule.lv }];
  if (rule.kills) {
    const rows = await db.all("SELECT rank, SUM(n) AS c FROM hunt_log WHERE user_id = ? AND result = 'success' GROUP BY rank", [u.id]);
    for (const k of rule.kills) {
      const h = rows.reduce((a, r) => a + (G.RANK_IDX[r.rank] >= G.RANK_IDX[k.min] ? Number(r.c) || 0 : 0), 0);
      conds.push({ t: k.min + '급 이상 몬스터 ' + k.n + '마리 처치', have: Math.min(h, k.n), need: k.n, ok: h >= k.n });
    }
  }
  if (rule.sTry) { const h = Number((await db.get('SELECT COUNT(*) AS c FROM s_attempts WHERE user_id = ?', [u.id])).c) || 0; conds.push({ t: 'SS급 몬스터 토벌 도전 ' + rule.sTry + '회', have: Math.min(h, rule.sTry), need: rule.sTry, ok: h >= rule.sTry }); }
  if (rule.taintMax != null) {
    let tn = 0; try { tn = Number(JSON.parse(u.stats).taint) || 0; } catch (_) {}
    conds.push({ t: '오염도 ' + rule.taintMax + '% 이하 (정화의 물약 등으로 낮추기)', have: Math.round(tn * 10) / 10, need: rule.taintMax, ok: tn <= rule.taintMax, atMost: true });
  }
  return { rank: u.rank, next: rule.to, conds, can: conds.every(c => c.ok), max: false, fame: G.FAME_PER_RANK };
}
route('GET', '/api/promote', async (req, res, ctx) => {
  const u = await userById(ctx.user.id);
  send(res, 200, await promoInfo(u));
});
route('POST', '/api/promote', async (req, res, ctx) => {
  const u = await userById(ctx.user.id);
  const info = await promoInfo(u);
  if (info.max) return fail(res, 400, 'max_rank');
  if (!info.can) return fail(res, 400, 'not_ready', { conds: info.conds });
  const w = await db.run('UPDATE users SET rank = ? WHERE id = ? AND rank = ?', [info.next, u.id, u.rank]);
  if (w.changes !== 1) return fail(res, 409, 'busy');
  const fame = await grantFame(u.id, G.FAME_PER_RANK);
  send(res, 200, { ok: true, from: u.rank, rank: info.next, fame, next: await promoInfo(Object.assign({}, u, { rank: info.next })) });
});

// 비공개 유저 설정 (켜면 헌터 커뮤니티에서 언급되지 않음)
// 캐릭터 이미지 변경 (가입 때와 같은 규격: JPEG 데이터 주소, 빈 값이면 삭제)
const IMG_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const validThumb = t => typeof t === 'string' && t.length > 0 && t.length <= 14000 && IMG_RE.test(t);
const validImage = im => typeof im === 'string' && (im === '' || (im.length <= 800000 && IMG_RE.test(im)));
route('POST', '/api/me/image', async (req, res, ctx) => {
  if (await limited('img:' + ctx.user.id, 10, 60000)) return fail(res, 429, 'rate_limited');
  const image = ctx.body.image;
  if (!validImage(image)) return fail(res, 400, 'bad_image');
  const ver = image ? Date.now() : 0;
  const thumb = image && validThumb(ctx.body.thumb) ? ctx.body.thumb : '';      // 작은 사진이 없거나 이상하면 비워 두고, 나중에 화면이 채워 줍니다
  await db.run('UPDATE users SET image = ?, thumb = ?, img_ver = ? WHERE id = ?', [image, thumb, ver, ctx.user.id]);
  send(res, 200, { ok: true, image: imgUrl(ctx.user.id, ver) });
}, { limit: 1200000 });
// 예전에 올린 사진에 작은 사진이 없을 때 화면이 한 번 만들어서 올립니다 (사진 버전이 같고 아직 비어 있을 때만 저장)
route('POST', '/api/me/thumb', async (req, res, ctx) => {
  if (await limited('thb:' + ctx.user.id, 10, 60000)) return fail(res, 429, 'rate_limited');
  if (!validThumb(ctx.body.thumb)) return fail(res, 400, 'bad_thumb');
  const w = await db.run("UPDATE users SET thumb = ? WHERE id = ? AND img_ver = ? AND img_ver > 0 AND thumb = ''", [ctx.body.thumb, ctx.user.id, Number(ctx.body.ver) || -1]);
  send(res, 200, { ok: true, saved: w.changes === 1 });
});      // 이미지는 최대 약 700KB 라서 기본 요청 크기(20KB)보다 크게 허용
route('POST', '/api/admin/player/image', async (req, res, ctx) => {
  const u = await adminTarget(ctx, res); if (!u) return;
  if (!validImage(ctx.body.image)) return fail(res, 400, 'bad_image');
  await db.run("UPDATE users SET image = ?, thumb = '', img_ver = ? WHERE id = ?", [ctx.body.image, ctx.body.image ? Date.now() : 0, u.id]);      // 작은 사진은 비우고, 그 헌터가 접속하면 화면이 다시 만듭니다
  send(res, 200, { ok: true });
}, { auth: false, admin: true, limit: 1200000 });
// 프로필 소개글 (최대 200자, 줄바꿈 최대 5줄) — 친구 프로필에도 보입니다
route('POST', '/api/me/bio', async (req, res, ctx) => {
  let t = String(ctx.body.text == null ? '' : ctx.body.text).replace(/\r/g, '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '');
  t = t.split('\n').slice(0, 5).join('\n').trim();
  if (t.length > 200) t = t.slice(0, 200);
  await db.run('UPDATE users SET bio = ? WHERE id = ?', [t, ctx.user.id]);
  send(res, 200, { ok: true, bio: t });
});

// 내 특징 수정 (가입할 때와 같은 규칙: 최대 5개, 칸당 50자)
route('POST', '/api/me/traits', async (req, res, ctx) => {
  if (await limited('trt:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  const raw = ctx.body.traits;
  if (!Array.isArray(raw)) return fail(res, 400, 'bad_traits');
  const traits = raw.map(t => String(t == null ? '' : t).replace(/[\u0000-\u001F\u007F]/g, ' ').trim()).filter(Boolean);
  if (traits.length > 5 || traits.some(t => cp(t) > 50)) return fail(res, 400, 'bad_traits');
  await db.run('UPDATE users SET traits = ? WHERE id = ?', [JSON.stringify(traits), ctx.user.id]);
  send(res, 200, { ok: true, traits });
});

route('POST', '/api/me/private', async (req, res, ctx) => {
  const on = ctx.body.on === true ? 1 : 0;
  await db.run('UPDATE users SET is_private = ? WHERE id = ?', [on, ctx.user.id]);
  send(res, 200, { ok: true, private: !!on });
});

route('POST', '/api/inventory/use', async (req, res, ctx) => {
  if (await limited('use:' + ctx.user.id, 120, 60000)) return fail(res, 429, 'rate_limited');
  const name = String(ctx.body.item == null ? '' : ctx.body.item);
  let it = await db.get('SELECT eff_stat, eff_amt FROM shop_items WHERE name = ?', [name]);
  if ((!it || !it.eff_stat) && G.CRAFT_DEFS[name]) it = { eff_stat: G.CRAFT_DEFS[name].stat, eff_amt: G.CRAFT_DEFS[name].amt };
  if (!it || !it.eff_stat) return fail(res, 400, 'no_effect');
  const dec = await db.run('UPDATE inventory SET qty = qty - 1 WHERE user_id = ? AND item = ? AND qty > 0', [ctx.user.id, name]);
  if (dec.changes !== 1) return fail(res, 404, 'no_item');
  let r;
  try { r = await applyItemEffect(ctx.user.id, it.eff_stat, it.eff_amt, Date.now()); }
  catch (e) { await db.run('UPDATE inventory SET qty = qty + 1 WHERE user_id = ? AND item = ?', [ctx.user.id, name]); throw e; }
  await db.run('DELETE FROM inventory WHERE user_id = ? AND item = ? AND qty <= 0', [ctx.user.id, name]);
  send(res, 200, { ok: true, item: name, stat: it.eff_stat, label: STAT_KO[it.eff_stat], amt: it.eff_amt, before: r.before, after: r.after, dyingUntil: r.dying });
});

route('GET', '/api/admin/shop', async (req, res) => {
  const items = await db.all('SELECT id, name, descr, price, eff_stat, eff_amt FROM shop_items ORDER BY id');
  send(res, 200, { items: items.map(i => ({ id: i.id, name: i.name, desc: i.descr, price: i.price, stat: i.eff_stat, amt: i.eff_amt })),
    equips: G.EQUIPS.map(e => ({ name: e.name, grade: e.grade, slot: e.slot })),
    special: [{ name: EV.EMBER, note: '할로윈 이벤트 아이템 · 이벤트를 끄면 사라짐' }] });
}, { auth: false, admin: true });

route('POST', '/api/admin/shop/save', async (req, res, ctx) => {
  const name = String(ctx.body.name == null ? '' : ctx.body.name).trim();
  const desc = String(ctx.body.desc == null ? '' : ctx.body.desc).trim();
  if (!name || cp(name) > 30) return fail(res, 400, 'bad_item');
  if (cp(desc) > 100) return fail(res, 400, 'bad_desc');
  const price = ctx.body.price == null || ctx.body.price === '' ? 0 : Number(ctx.body.price);
  if (!Number.isInteger(price) || price < 0 || price > 9999999) return fail(res, 400, 'bad_price');
  const stat = String(ctx.body.stat == null ? '' : ctx.body.stat);
  const amt = stat ? Number(ctx.body.amt) : 0;
  if (!['', 'hp', 'str', 'agi', 'luck', 'taint'].includes(stat)) return fail(res, 400, 'bad_stat');
  if (stat && (!Number.isInteger(amt) || amt === 0 || amt < -999 || amt > 999)) return fail(res, 400, 'bad_amt');
  const id = Number(ctx.body.id) || 0;
  const dup = await db.get('SELECT id FROM shop_items WHERE name = ? AND id != ?', [name, id]);
  if (dup) return fail(res, 409, 'duplicate');
  if (id) {
    const r = await db.get('SELECT id FROM shop_items WHERE id = ?', [id]);
    if (!r) return fail(res, 404, 'no_item');
    await db.run('UPDATE shop_items SET name = ?, descr = ?, price = ?, eff_stat = ?, eff_amt = ? WHERE id = ?', [name, desc, price, stat, amt, id]);
  } else {
    await db.run('INSERT INTO shop_items (name, descr, price, at, eff_stat, eff_amt) VALUES (?, ?, ?, ?, ?, ?)', [name, desc, price, Date.now(), stat, amt]);
  }
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

route('POST', '/api/admin/shop/delete', async (req, res, ctx) => {
  await db.run('DELETE FROM shop_items WHERE id = ?', [Number(ctx.body.id) || 0]);
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// ── S급 토벌 현황 / 출현·회수 (서버 전체 공통) ──
const inList = ids => ids.map(() => '?').join(',');
route('GET', '/api/admin/s', async (req, res) => {
  await purgeMonsters(true);
  const now = Date.now();
  const live = await db.all("SELECT id, name, region, spawned_at FROM monsters WHERE rank = 'SS' AND owner_id IS NULL AND corrupt_of IS NULL ORDER BY spawned_at DESC");
  const logs = await db.all('SELECT monster_id AS id, name, region, spawned_at, status FROM s_log ORDER BY spawned_at DESC');
  const ids = live.map(m => m.id);
  const kc = new Map(), pc = new Map(), part = new Map(), cl = new Map(), pp = new Map();
  if (ids.length) {
    (await db.all(`SELECT monster_id, ok FROM s_close WHERE monster_id IN (${inList(ids)})`, ids)).forEach(r => cl.set(r.monster_id, r.ok));
    (await db.all(`SELECT monster_id, COUNT(*) AS n, COUNT(DISTINCT user_id) AS p FROM s_attempts WHERE monster_id IN (${inList(ids)}) GROUP BY monster_id`, ids)).forEach(r => pp.set(r.monster_id, r));
    (await db.all(`SELECT monster_id, COUNT(*) AS c FROM kills WHERE monster_id IN (${inList(ids)}) GROUP BY monster_id`, ids)).forEach(r => kc.set(r.monster_id, r.c));
    (await db.all(`SELECT monster_id, COUNT(*) AS c FROM s_attempts WHERE resolved != 1 AND monster_id IN (${inList(ids)}) GROUP BY monster_id`, ids)).forEach(r => pc.set(r.monster_id, r.c));
  }
  const recent = [...live.map(m => {
    const alive = now - m.spawned_at < G.ACTIVE_MS_S, k = kc.get(m.id) || 0, p = pc.get(m.id) || 0;
    const c = cl.get(m.id);
    const st = c === 1 ? 'killed' : c === 0 ? 'fled' : k ? 'killed' : p ? 'waiting' : alive ? 'active' : 'fled';
    return { id: m.id, name: m.name, region: m.region, at: m.spawned_at, status: st, alive, live: true };
  }), ...logs.map(l => ({ id: l.id, name: l.name, region: l.region, at: l.spawned_at, status: l.status, alive: false, live: false }))]
    .sort((a, b) => b.at - a.at);
  const top = recent.slice(0, 40), tids = top.map(r => r.id);
  if (tids.length) {
    (await db.all(`SELECT a.monster_id, u.hunter_name AS hn, a.resolved, a.success FROM s_attempts a JOIN users u ON u.id = a.user_id WHERE a.monster_id IN (${inList(tids)}) ORDER BY a.id`, tids))
      .forEach(r => { if (!part.has(r.monster_id)) part.set(r.monster_id, []); part.get(r.monster_id).push({ hn: r.hn, st: r.resolved === 1 ? (r.success ? 'win' : 'lose') : 'wait' }); });
  }
  const catalog = G.MON.SS.map(name => {
    const rows = recent.filter(r => r.name === name);
    return {
      name,
      present: rows.filter(r => r.live && r.alive && (r.status === 'active' || r.status === 'waiting')).map(r => ({ id: r.id, region: r.region, rname: G.placeName(r.region), left: r.at + G.ACTIVE_MS_S - now, status: r.status })),
      appear: rows.length,
      killed: rows.filter(r => r.status === 'killed').length,
      fled: rows.filter(r => r.status === 'fled').length,
      recalled: rows.filter(r => r.status === 'recalled').length,
    };
  });
  const players = await db.all(`SELECT u.code, u.hunter_name AS hn, u.rank, u.lv, COUNT(*) AS attempts,
      SUM(CASE WHEN a.resolved = 1 AND a.success = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN a.resolved = 1 AND a.success = 0 THEN 1 ELSE 0 END) AS fails,
      SUM(CASE WHEN a.resolved != 1 THEN 1 ELSE 0 END) AS pending
    FROM s_attempts a JOIN users u ON u.id = a.user_id GROUP BY u.id ORDER BY attempts DESC, u.hunter_name LIMIT 300`);
  send(res, 200, {
    open: live.filter(m => !cl.has(m.id) && ((now - m.spawned_at < G.ACTIVE_MS_S) || (pc.get(m.id) || 0) > 0)).map(m => {
      const t = pp.get(m.id) || { n: 0, p: 0 };
      return { id: m.id, name: m.name, rname: G.placeName(m.region), at: m.spawned_at, alive: now - m.spawned_at < G.ACTIVE_MS_S, left: m.spawned_at + G.ACTIVE_MS_S - now, people: t.p, tries: t.n, need: G.RAID_NEED, needTries: G.RAID_ATTEMPTS };
    }),
    catalog, players,
    totals: { appear: recent.length, killed: recent.filter(r => r.status === 'killed').length, fled: recent.filter(r => r.status === 'fled').length, recalled: recent.filter(r => r.status === 'recalled').length, players: players.length },
    recent: top.map(r => ({ id: r.id, name: r.name, rname: G.placeName(r.region), at: r.at, status: r.status, parts: part.get(r.id) || [] })),
  });
}, { auth: false, admin: true });

route('POST', '/api/admin/s/spawn', async (req, res, ctx) => {
  const name = String(ctx.body.name || '');
  if (!G.MON.SS.includes(name)) return fail(res, 400, 'bad_name');
  let region = String(ctx.body.region || '');
  if (region && (!G.COUNTRY_BY_ID[region] || G.COUNTRY_BY_ID[region].gate)) return fail(res, 400, 'bad_region');      // S급은 나라 단위로만 출현
  const now = Date.now();
  if (!region) region = pickSCountry(await liveSCountries(now));
  const live = await db.get("SELECT COUNT(*) AS c FROM monsters WHERE rank = 'SS' AND owner_id IS NULL AND corrupt_of IS NULL AND spawned_at > ?", [now - G.ACTIVE_MS_S]);
  if (live.c >= 20) return fail(res, 400, 'too_many');
  const r = await db.run("INSERT INTO monsters (region, name, rank, spawned_at) VALUES (?, ?, 'SS', ?)", [region, name, now]);
  send(res, 200, { ok: true, id: r.lastId, region });
}, { auth: false, admin: true });

// 성공 팝업의 '확인' → 참여한 헌터에게만 보상 지급
// (최소화한 뒤 1시간 안에 받지 않으면 buildState 가 같은 함수로 자동 수령시킵니다)
const SWIN_HOLD_MS = 60 * 60000;
async function claimSWin(u, id, now) {
  const c = await db.get('SELECT m.name FROM s_close s JOIN monsters m ON m.id = s.monster_id WHERE s.monster_id = ? AND s.ok = 1', [id]);
  if (!c) return null;
  if (await db.get('SELECT 1 AS x FROM s_ack WHERE user_id = ? AND monster_id = ?', [u.id, id])) return { already: true, reward: null, mon: c.name };
  let reward = null, up = false;
  const r = await db.get('SELECT exp, gold, taint FROM s_rewards WHERE user_id = ? AND monster_id = ?', [u.id, id]);
  if (r) {
    const cl = await db.run('UPDATE s_rewards SET claimed = 1 WHERE user_id = ? AND monster_id = ? AND claimed = 0', [u.id, id]);
    if (cl.changes === 1) {
      const g = await grantExp(u.id, r.exp); up = !!(g && g.up);
      await grantGold(u.id, r.gold); await grantTaint(u.id, r.taint);
      await logAcquire(u.id, 'exp', '경험치', r.exp, c.name + ' 토벌', now);
      await logAcquire(u.id, 'gold', '골드', r.gold, c.name + ' 토벌', now);
      reward = { exp: r.exp, gold: r.gold, taint: r.taint, levelUp: up };
    }
  }
  await db.run('INSERT OR IGNORE INTO s_ack (user_id, monster_id, at) VALUES (?, ?, ?)', [u.id, id, now]);
  await db.run('DELETE FROM s_min WHERE user_id = ? AND monster_id = ?', [u.id, id]);
  return { reward, mon: c.name };
}
route('POST', '/api/swin/claim', async (req, res, ctx) => {
  const out = await claimSWin(ctx.user, Number(ctx.body.id) || 0, Date.now());
  if (!out) return fail(res, 404, 'no_win');
  send(res, 200, out.already ? { ok: true, already: true } : { ok: true, reward: out.reward });
});
// 최소화: 보상을 받지 않은 채로 창만 접어 둡니다. 처음 접은 시각부터 1시간이 지나면 자동으로 수령됩니다.
route('POST', '/api/swin/minimize', async (req, res, ctx) => {
  const id = Number(ctx.body.id) || 0, now = Date.now();
  if (!(await db.get('SELECT 1 AS x FROM s_close WHERE monster_id = ? AND ok = 1', [id]))) return fail(res, 404, 'no_win');
  if (await db.get('SELECT 1 AS x FROM s_ack WHERE user_id = ? AND monster_id = ?', [ctx.user.id, id])) return send(res, 200, { ok: true, already: true });
  await db.run('INSERT OR IGNORE INTO s_min (user_id, monster_id, at) VALUES (?, ?, ?)', [ctx.user.id, id, now]);
  const r = await db.get('SELECT at FROM s_min WHERE user_id = ? AND monster_id = ?', [ctx.user.id, id]);
  send(res, 200, { ok: true, minAt: r ? Number(r.at) : now, holdMs: SWIN_HOLD_MS });
});

route('POST', '/api/admin/s/decide', async (req, res, ctx) => {
  const m = await db.get("SELECT id, region, name, rank, spawned_at, owner_id, rumor_id, corrupt_of FROM monsters WHERE id = ? AND rank = 'SS' AND owner_id IS NULL AND corrupt_of IS NULL", [Number(ctx.body.id) || 0]);
  if (!m) return fail(res, 404, 'no_monster');
  if (await db.get('SELECT 1 AS x FROM s_close WHERE monster_id = ?', [m.id])) return fail(res, 409, 'already_decided');
  const ok = ctx.body.success === true ? await declareSuccess(m, 'admin') : await declareFail(m, 'admin');
  send(res, 200, { ok, success: ctx.body.success === true });
}, { auth: false, admin: true });

// 회수: 아직 아무도 처치하지 못한 S급을 서버 전체에서 거둬들입니다. 대기 중이던 도전은 취소하고 도전권을 돌려줍니다.
route('POST', '/api/admin/s/recall', async (req, res, ctx) => {
  const now = Date.now();
  let rows;
  if (ctx.body.all === true) rows = await db.all("SELECT id, region, name, rank, spawned_at, owner_id, rumor_id, corrupt_of FROM monsters WHERE rank = 'SS' AND owner_id IS NULL AND corrupt_of IS NULL AND spawned_at > ?", [now - G.ACTIVE_MS_S]);
  else if (ctx.body.id) rows = await db.all("SELECT id, region, name, rank, spawned_at, owner_id, rumor_id, corrupt_of FROM monsters WHERE id = ? AND rank = 'SS' AND owner_id IS NULL AND corrupt_of IS NULL", [Number(ctx.body.id) || 0]);
  else if (ctx.body.name) rows = await db.all("SELECT id, region, name, rank, spawned_at, owner_id, rumor_id, corrupt_of FROM monsters WHERE name = ? AND rank = 'SS' AND owner_id IS NULL AND corrupt_of IS NULL AND spawned_at > ?", [String(ctx.body.name), now - G.ACTIVE_MS_S]);
  else return fail(res, 400, 'bad_target');
  let recalled = 0, skipped = 0, cancelled = 0;
  for (const m of rows) {
    if (await db.get('SELECT 1 AS x FROM kills WHERE monster_id = ?', [m.id]) || await db.get('SELECT 1 AS x FROM s_close WHERE monster_id = ?', [m.id])) { skipped++; continue; }   // 이미 처치된 건 되돌리지 않음
    const att = await db.all('SELECT id, user_id FROM s_attempts WHERE monster_id = ? AND resolved = 0', [m.id]);
    const list = [];
    for (const a of att) {
      list.push(['UPDATE s_window SET n = MAX(0, n - 1) WHERE user_id = ?', [a.user_id]]);
      list.push(["DELETE FROM hunt_log WHERE user_id = ? AND monster_id = ? AND result = 'pending'", [a.user_id, m.id]]);
    }
    list.push(['DELETE FROM s_attempts WHERE monster_id = ? AND resolved = 0', [m.id]]);
    list.push(["INSERT OR REPLACE INTO s_log (monster_id, name, region, spawned_at, status, ended_at) VALUES (?, ?, ?, ?, 'recalled', ?)", [m.id, m.name, m.region, m.spawned_at, now]]);
    list.push(['DELETE FROM fail_cd WHERE monster_id = ?', [m.id]]);
    list.push(['DELETE FROM monsters WHERE id = ?', [m.id]]);
    await db.batch(list);
    recalled++; cancelled += att.length;
  }
  send(res, 200, { ok: true, recalled, skipped, cancelled });
}, { auth: false, admin: true });

// ── 업적 API ──
route('GET', '/api/achievements', async (req, res, ctx) => {
  const u = await userById(ctx.user.id);
  const list = await achOf(u), pins = pinnedList(u, list).map(p => p.id);
  await syncAchEarned(u, Date.now(), true);
  const seen = Number(u.ach_seen) || 0;
  const at = new Map((await db.all('SELECT ach_id, at FROM ach_earned WHERE user_id = ?', [u.id])).map(r => [r.ach_id, Number(r.at)]));
  send(res, 200, { max: G.ACH_PIN_MAX, list: list.map(a => ({ id: a.id, name: a.name, desc: a.descr, done: a.done, pinned: pins.includes(a.id), isNew: !!(a.done && seen && (at.get(a.id) || 0) > seen) })) });
});
route('POST', '/api/achievements/seen', async (req, res, ctx) => {
  await db.run('UPDATE users SET ach_seen = ? WHERE id = ?', [Date.now(), ctx.user.id]);
  send(res, 200, { ok: true });
});

route('POST', '/api/achievements/pin', async (req, res, ctx) => {
  const u = await userById(ctx.user.id);
  const list = await achOf(u), a = list.find(x => x.id === String(ctx.body.id));
  if (!a) return fail(res, 404, 'no_ach');
  let pins = pinnedList(u, list).map(p => p.id);
  if (ctx.body.on === false) pins = pins.filter(x => x !== a.id);
  else {
    if (!a.done) return fail(res, 403, 'locked');
    if (!pins.includes(a.id)) {
      if (pins.length >= G.ACH_PIN_MAX) return fail(res, 409, 'full', { max: G.ACH_PIN_MAX });
      pins.push(a.id);
    }
  }
  await db.run('UPDATE users SET pinned_ach = ? WHERE id = ?', [JSON.stringify(pins), u.id]);
  send(res, 200, { ok: true, pinned: pins.map(id => ({ id, name: list.find(x => x.id === id).name })) });
});

// 관리자: 업적 정의 추가·수정·삭제 (모든 헌터에게 즉시 적용)
route('GET', '/api/admin/achievements', async (req, res) => {
  const list = await loadAch(true);
  send(res, 200, { kinds: G.ACH_KINDS, places: G.COUNTRIES.flatMap(c => [[c.id, c.name + ' (나라 전체)']].concat(c.regions.map(r => [r.id, c.name + ' · ' + r.name]))), list: list.map(a => ({ id: a.id, name: a.name, desc: a.descr, kind: a.kind, val: a.val })) });
}, { auth: false, admin: true });

route('POST', '/api/admin/achievements/save', async (req, res, ctx) => {
  const str = v => String(v == null ? '' : v).trim();
  const name = str(ctx.body.name), desc = str(ctx.body.desc), kind = str(ctx.body.kind);
  let val = str(ctx.body.val);
  if (!name || cp(name) > 20) return fail(res, 400, 'bad_name');
  if (cp(desc) > 60) return fail(res, 400, 'bad_desc');
  if (!G.ACH_KINDS.includes(kind)) return fail(res, 400, 'bad_kind');
  if (G.ACH_NUM.includes(kind)) {
    const n = Number(val);
    if (!Number.isInteger(n) || n < 1 || n > 99999) return fail(res, 400, 'bad_val');
    val = String(n);
  } else if (kind === 'rank' || kind === 'hrank') { if (G.RANK_IDX[val] == null) return fail(res, 400, 'bad_val'); }
  else if (G.ACH_COMPOUND.includes(kind)) {
    const [k, c] = splitVal(val);
    if (!Number.isInteger(c) || c < 1 || c > 99999 || !k.trim() || cp(k) > 30 || k.includes(':')) return fail(res, 400, 'bad_val');
    if (kind === 'visit' && !G.REGION_BY_ID[k] && !G.COUNTRY_BY_ID[k]) return fail(res, 400, 'bad_val');
    if (kind === 'stat' && !['str', 'agi', 'luck'].includes(k)) return fail(res, 400, 'bad_val');
    val = k.trim() + ':' + c;
  }
  else val = '';
  const id = str(ctx.body.id);
  if (id) {
    const r = await db.get('SELECT id FROM achievements WHERE id = ?', [id]);
    if (!r) return fail(res, 404, 'no_ach');
    await db.run('UPDATE achievements SET name = ?, descr = ?, kind = ?, val = ? WHERE id = ?', [name, desc, kind, val, id]);
    achCache.defs = null;
  } else {
    await loadAch();
    const c = await db.get('SELECT COUNT(*) AS c FROM achievements');
    if (c.c >= 100) return fail(res, 400, 'too_many');
    const nid = 'c' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    await db.run('INSERT INTO achievements (id, name, descr, kind, val, at) VALUES (?, ?, ?, ?, ?, ?)', [nid, name, desc, kind, val, Date.now()]);
    achCache.defs = null;
  }
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

route('POST', '/api/admin/achievements/delete', async (req, res, ctx) => {
  const id = String(ctx.body.id || '');
  await db.batch([['DELETE FROM achievements WHERE id = ?', [id]], ['DELETE FROM ach_grants WHERE ach_id = ?', [id]]]);
  achCache.defs = null;
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// 관리자: 특정 헌터에게 업적 부여/회수
route('POST', '/api/admin/player/ach', async (req, res, ctx) => {
  const u = await userByCode(normCode(ctx.body.code));
  if (!u) return fail(res, 404, 'not_found');
  const id = String(ctx.body.id || '');
  if (!(await db.get('SELECT 1 AS x FROM achievements WHERE id = ?', [id]))) return fail(res, 404, 'no_ach');
  if (ctx.body.on === false) await db.run('DELETE FROM ach_grants WHERE user_id = ? AND ach_id = ?', [u.id, id]);
  else await db.run('INSERT OR IGNORE INTO ach_grants (user_id, ach_id, at) VALUES (?, ?, ?)', [u.id, id, Date.now()]);
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// ── 오늘의 추천 ──
// 헌터 커뮤니티 게시글 관리 (관리자만 수정·삭제 가능)
route('GET', '/api/admin/board', async (req, res) => {
  const posts = await db.all('SELECT id, who, title, body, tag, at FROM board_posts ORDER BY id DESC LIMIT 100');
  send(res, 200, { posts });
}, { auth: false, admin: true });

route('POST', '/api/admin/board/save', async (req, res, ctx) => {
  const b = ctx.body, id = Number(b.id);
  const clean = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
  const who = clean(b.who, 30).replace(/\s+/g, ' '), tag = clean(b.tag, 10).replace(/\s+/g, ' ');
  const title = clean(b.title, 100).replace(/\s+/g, ' '), body = clean(b.body, 1000);
  if (!Number.isInteger(id) || id < 1) return fail(res, 400, 'bad_id');
  if (!who || !tag || !title || !body) return fail(res, 400, 'empty');
  if (cp(title) > 60 || cp(body) > 500 || cp(who) > 20 || cp(tag) > 8) return fail(res, 400, 'too_long');
  const r = await db.run('UPDATE board_posts SET who = ?, title = ?, body = ?, tag = ? WHERE id = ?', [who, title, body, tag, id]);
  if (r.changes !== 1) return fail(res, 404, 'not_found');
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

route('POST', '/api/admin/board/delete', async (req, res, ctx) => {
  const id = Number(ctx.body.id);
  if (!Number.isInteger(id) || id < 1) return fail(res, 400, 'bad_id');
  const r = await db.run('DELETE FROM board_posts WHERE id = ?', [id]);
  send(res, 200, { ok: true, deleted: r.changes });
}, { auth: false, admin: true });

route('GET', '/api/admin/rec', async (req, res) => {
  send(res, 200, { rec: await getRec() });
}, { auth: false, admin: true });

route('POST', '/api/admin/rec/save', async (req, res, ctx) => {
  const text = String(ctx.body.text == null ? '' : ctx.body.text).replace(/\s+/g, ' ').trim();
  if (!text) return fail(res, 400, 'empty');
  if (cp(text) > 100) return fail(res, 400, 'bad_text');
  const rec = { text, at: Date.now() };
  recCache.at = 0;
  await db.run("INSERT INTO settings (key, value) VALUES ('daily_rec', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(rec)]);
  send(res, 200, { ok: true, rec });
}, { auth: false, admin: true });

route('POST', '/api/admin/rec/clear', async (req, res) => {
  recCache.at = 0;
  await db.run("DELETE FROM settings WHERE key = 'daily_rec'");
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// 습득 정보 삭제 (선택 또는 전체)
route('POST', '/api/admin/player/acquired/delete', async (req, res, ctx) => {
  const u = await adminTarget(ctx, res); if (!u) return;
  if (ctx.body.all === true) await db.run('DELETE FROM acquire_log WHERE user_id = ?', [u.id]);
  else {
    const ids = intIds(ctx.body.ids);
    if (!ids.length) return fail(res, 400, 'no_ids');
    await db.batch(ids.map(id => ['DELETE FROM acquire_log WHERE id = ? AND user_id = ?', [id, u.id]]));
  }
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// 토벌 기록 변경 / 삭제. (기록만 바뀌며, 헌터의 레벨·경험치·토벌 완료 상태는 바뀌지 않습니다)
route('POST', '/api/admin/player/hunt/update', async (req, res, ctx) => {
  const u = await adminTarget(ctx, res); if (!u) return;
  const id = Number(ctx.body.id), mon = String(ctx.body.mon == null ? '' : ctx.body.mon).trim();
  const rank = ctx.body.rank, result = ctx.body.result, exp = Number(ctx.body.exp);
  if (!Number.isInteger(id)) return fail(res, 400, 'bad_id');
  if (!mon || cp(mon) > 30) return fail(res, 400, 'bad_mon');
  if (!RANKS.concat(['SS']).includes(rank)) return fail(res, 400, 'bad_rank');
  if (!['success', 'fail', 'pending'].includes(result)) return fail(res, 400, 'bad_result');
  if (!Number.isInteger(exp) || exp < 0 || exp > 99999) return fail(res, 400, 'bad_exp');
  const r = await db.run('UPDATE hunt_log SET mon = ?, rank = ?, result = ?, exp_gain = ? WHERE id = ? AND user_id = ?', [mon, rank, result, exp, id, u.id]);
  if (!r.changes) return fail(res, 404, 'not_found');
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

route('POST', '/api/admin/player/hunt/delete', async (req, res, ctx) => {
  const u = await adminTarget(ctx, res); if (!u) return;
  if (ctx.body.all === true) await db.run('DELETE FROM hunt_log WHERE user_id = ?', [u.id]);
  else {
    const ids = intIds(ctx.body.ids);
    if (!ids.length) return fail(res, 400, 'no_ids');
    await db.batch(ids.map(id => ['DELETE FROM hunt_log WHERE id = ? AND user_id = ?', [id, u.id]]));
  }
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// 강제 탈퇴: 캐릭터와 관련 데이터를 모두 삭제합니다. (확인용으로 헌터 네임을 정확히 보내야 합니다)
route('POST', '/api/admin/player/delete', async (req, res, ctx) => {
  const u = await userByCode(normCode(ctx.body.code));
  if (!u) return fail(res, 404, 'not_found');
  if (String(ctx.body.confirm || '') !== u.hunter_name) return fail(res, 400, 'confirm_mismatch');
  const id = u.id;
  await db.batch([
    ['DELETE FROM sessions WHERE user_id = ?', [id]],
    ['DELETE FROM kills WHERE user_id = ?', [id]],
    ['DELETE FROM fail_cd WHERE user_id = ?', [id]],
    ['DELETE FROM s_window WHERE user_id = ?', [id]],
    ['DELETE FROM s_attempts WHERE user_id = ?', [id]],
    ['DELETE FROM friends WHERE user_id = ? OR friend_id = ?', [id, id]],
    ['DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?', [id, id]],
    ['DELETE FROM messages WHERE from_id = ? OR to_id = ?', [id, id]],
    ['DELETE FROM inquiries WHERE user_id = ?', [id]],
    ['DELETE FROM qna_ask WHERE user_id = ?', [id]],
    ['DELETE FROM gw_mentions WHERE target_id = ? OR by_id = ? OR post_id IN (SELECT id FROM gw_posts WHERE user_id = ?)', [id, id, id]],
    ['DELETE FROM gw_likes WHERE user_id = ? OR comment_id IN (SELECT id FROM gw_comments WHERE user_id = ? OR post_id IN (SELECT id FROM gw_posts WHERE user_id = ?))', [id, id, id]],
    ['DELETE FROM gw_comments WHERE user_id = ? OR post_id IN (SELECT id FROM gw_posts WHERE user_id = ?)', [id, id]],
    ['DELETE FROM gw_posts WHERE user_id = ?', [id]],
    ['DELETE FROM gifts WHERE from_id = ? OR to_id = ?', [id, id]],
    ['DELETE FROM hunt_log WHERE user_id = ?', [id]],
    ['DELETE FROM acquire_log WHERE user_id = ?', [id]],
    ['DELETE FROM inventory WHERE user_id = ?', [id]],
    ['DELETE FROM survey_marks WHERE user_id = ?', [id]],
    ['DELETE FROM s_min WHERE user_id = ?', [id]],
    ['DELETE FROM pact_log WHERE user_id = ?', [id]],
    ['DELETE FROM battles WHERE user_id = ?', [id]],
    ['DELETE FROM exchange WHERE seller_id = ?', [id]],
    ['DELETE FROM equip_inv WHERE user_id = ?', [id]],
    ['DELETE FROM rumor_votes WHERE user_id = ?', [id]],
    ['DELETE FROM rumor_stats WHERE user_id = ?', [id]],
    ['DELETE FROM daily_quests WHERE user_id = ?', [id]],
    ['DELETE FROM gate_run WHERE user_id = ?', [id]],
    ['DELETE FROM rescues WHERE target_id = ? OR rescuer_id = ?', [id, id]],
    ['DELETE FROM visit_counts WHERE user_id = ?', [id]],
    ['DELETE FROM invite_rewards WHERE user_id = ?', [id]],
    ['DELETE FROM notice_del WHERE user_id = ?', [id]],
    ['DELETE FROM ach_grants WHERE user_id = ?', [id]],
    ['DELETE FROM user_spawn WHERE user_id = ?', [id]],
    ['DELETE FROM monsters WHERE owner_id = ?', [id]],
    ['DELETE FROM users WHERE id = ?', [id]],
  ]);
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// ── 오래된 기록 압축 (무료 DB 용량 아끼기) ──
// 화면에는 최근 200건만 보이므로, 그보다 오래된 토벌·획득 기록은 '같은 종류끼리 한 줄'로 합칩니다.
// 합쳐도 처치 수·업적·승급 조건에 쓰는 숫자(n 열의 합)와 획득 수량은 그대로 유지됩니다.
const KEEP_LOG = 200;
async function compactLogs(table, keyCols, sumCols, lim) {
  const users = await db.all('SELECT user_id, COUNT(*) AS c FROM ' + table + ' GROUP BY user_id HAVING COUNT(*) > ?', [KEEP_LOG + 50]);
  let done = 0;
  for (const u of users) {
    if (done >= lim) break;
    const cut = await db.get('SELECT id FROM ' + table + ' WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?', [u.user_id, KEEP_LOG]);
    if (!cut) continue;
    const extra = table === 'hunt_log' ? " AND result <> 'pending'" : '';
    const groups = await db.all('SELECT ' + keyCols.join(', ') + ', MIN(id) AS mid, COUNT(*) AS c, SUM(n) AS sn, MAX(at) AS mat' + sumCols.map(k => ', SUM(' + k + ') AS s_' + k).join('') +
      ' FROM ' + table + ' WHERE user_id = ? AND id <= ?' + extra + ' GROUP BY ' + keyCols.join(', ') + ' HAVING COUNT(*) > 1', [u.user_id, cut.id]);
    const list = [];
    for (const g of groups) {
      list.push(['UPDATE ' + table + ' SET n = ?, at = ?' + sumCols.map(k => ', ' + k + ' = ?').join('') + ' WHERE id = ?', [Number(g.sn), Number(g.mat)].concat(sumCols.map(k => Number(g['s_' + k]))).concat([g.mid])]);
      list.push(['DELETE FROM ' + table + ' WHERE user_id = ? AND id <= ? AND id <> ?' + extra + ' AND ' + keyCols.map(k => k + ' = ?').join(' AND '), [u.user_id, cut.id, g.mid].concat(keyCols.map(k => g[k]))]);
    }
    for (let i = 0; i < list.length; i += 100) await db.batch(list.slice(i, i + 100));
    done++;
  }
}
async function compactOld(now) {
  await compactLogs('hunt_log', ['mon', 'rank', 'result'], ['exp_gain'], 80);
  await compactLogs('acquire_log', ['kind', 'name', 'source'], ['qty'], 80);
  const day = kstDay(now - 7 * 24 * 3600000);
  await db.run('DELETE FROM pact_log WHERE day < ?', [day]);
  await db.run('DELETE FROM daily_quests WHERE day < ?', [day]);
  // 이틀이 지난 개인 몬스터(처치 기록 포함)는 더 이상 쓰이지 않습니다
  const old = now - 2 * 24 * 3600000;
  await db.run('DELETE FROM kills WHERE monster_id IN (SELECT id FROM monsters WHERE owner_id IS NOT NULL AND corrupt_of IS NULL AND rumor_id IS NULL AND spawned_at < ?)', [old]);
  await db.run('DELETE FROM monsters WHERE owner_id IS NOT NULL AND corrupt_of IS NULL AND rumor_id IS NULL AND spawned_at < ?', [old]);
  await db.run('DELETE FROM fail_cd WHERE monster_id NOT IN (SELECT id FROM monsters)');
}

// Cron 이 호출: 출몰·S급 결과 따라잡기 + 오래된 데이터 정리. Vercel 은 CRON_SECRET 을 Bearer 로 보냅니다.
route('GET', '/api/cron', async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  const h = String(req.headers.authorization || '');
  if (!secret || !safeEq(sha256(h), sha256('Bearer ' + secret))) return fail(res, 401, 'unauthorized');
  const now = Date.now();
  await catchUp();
  await purgeMonsters(true);
  await db.run('UPDATE s_attempts SET resolved = 0 WHERE resolved = 2 AND resolve_at < ?', [now - 5 * 60000]);
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [now]);
  await db.run('DELETE FROM rate_limits WHERE start < ?', [now - G.HOUR]);
  await db.run('DELETE FROM fail_cd WHERE until < ?', [now - G.HOUR]);
  try { await compactOld(now); } catch (e) { console.error('[compact]', e); }
  send(res, 200, { ok: true });
}, { auth: false });

route('GET', '/api/healthz', async (req, res) => {
  try {
    await db.get('SELECT 1 AS x');
    send(res, 200, { ok: true, db: db.kind });
  } catch (e) {
    console.error('[healthz]', e);
    // 설정 점검용: 비밀 값은 포함하지 않고 원인 종류만 알려 줍니다.
    const url = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || ''), tok = '';
    const diag = {
      version: 3,
      urlSet: !!url, urlStart: url.slice(0, 8), urlHost: url.replace(/^[a-z]+:\/\//i, '').split('/')[0].replace(/^.*@/, '').slice(0, 80), urlHasSpace: /\s/.test(url),
      tokenSet: !!tok, tokenLen: tok.length, tokenLooksJwt: /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(tok.trim()), tokenHasSpace: /\s/.test(tok.trim()),
      cause: String((e.cause && e.cause.message) || '').slice(0, 160),
    };
    send(res, 500, { ok: false, diag, hint: e.config ? e.message : String(e.code || e.name || 'error') + ': ' + String(e.message || '').replace(/(authToken|token|postgres(ql)?:\/\/)[^ ]*/gi, '***').slice(0, 200) });
  }
}, { auth: false });

// ───────────── 진입점 ─────────────
// ── 점검 모드: 켜면 관리자 캐릭터 외 모든 헌터의 접속(가입·로그인·게임 요청)을 막습니다 ──
// 설정은 settings 표(maint_on, maint_msg)에 저장되고, 서버 인스턴스마다 3초 동안만 기억해 둡니다.
let maintCache = { at: 0, on: false, msg: '' };
async function maintState() {
  const now = Date.now();
  if (now - maintCache.at < 3000) return maintCache;
  const rows = await db.all("SELECT key, value FROM settings WHERE key IN ('maint_on', 'maint_msg')");
  const m = {};
  rows.forEach(r => { m[r.key] = r.value; });
  // 한 번도 설정한 적이 없으면(새로 배포한 직후) 점검 중으로 시작합니다. 관리자 페이지에서 '점검 끝내기'를 누르면 열립니다.
  maintCache = { at: now, on: m.maint_on === undefined ? true : m.maint_on === '1', msg: m.maint_msg || '' };
  return maintCache;
}
route('GET', '/api/maintenance', async (req, res) => {
  const m = await maintState();
  await EV.refresh();
  send(res, 200, { on: m.on, message: m.on ? m.msg : '', hlw: EV.on() });      // hlw: [THEME:HALLOWEEN] 할로윈 화면 테마를 켤지 (이벤트 진행 중일 때)
}, { auth: false });
route('GET', '/api/admin/bgm', async (req, res) => {
  bgmCache.at = 0;
  const b = await srvBgm();
  send(res, 200, { id: b.id, v: b.v, url: b.id ? 'https://youtu.be/' + b.id : '' });
}, { auth: false, admin: true });
route('POST', '/api/admin/bgm', async (req, res, ctx) => {
  const raw = String(ctx.body.url == null ? '' : ctx.body.url).trim().slice(0, 300);
  const id = ytIdOf(raw);
  if (raw && !id) return fail(res, 400, 'bad_url');
  const v = Date.now();
  await db.run("INSERT INTO settings (key, value) VALUES ('srv_bgm', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify({ id, v })]);
  bgmCache = { at: Date.now(), id, v };
  send(res, 200, { id, v, url: id ? 'https://youtu.be/' + id : '' });
}, { auth: false, admin: true });
route('GET', '/api/admin/maintenance', async (req, res) => {
  const m = await maintState();
  send(res, 200, { on: m.on, message: m.msg });
}, { auth: false, admin: true });
route('POST', '/api/admin/maintenance', async (req, res, ctx) => {
  const on = ctx.body.on === true;
  const message = String(ctx.body.message == null ? '' : ctx.body.message).trim().slice(0, 200);
  await db.batch([
    ["INSERT INTO settings (key, value) VALUES ('maint_on', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [on ? '1' : '0']],
    ["INSERT INTO settings (key, value) VALUES ('maint_msg', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [message]],
  ]);
  maintCache = { at: Date.now(), on, msg: message };
  send(res, 200, { on, message });
}, { auth: false, admin: true });

async function handle(req, res) {
  try {
    // vercel.json 의 rewrite 가 원래 주소를 __p 로 넘겨 줍니다. (예: /api/admin/overview → /api/index?__p=admin/overview)
    const u0 = new URL(req.url, 'http://x');
    if (u0.searchParams.has('__p')) {
      const orig = u0.searchParams.get('__p');
      u0.searchParams.delete('__p');
      const qs = u0.searchParams.toString();
      req.url = '/api/' + orig + (qs ? '?' + qs : '');
    }
    const pathname = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '') || '/';
    const r = routes[req.method + ' ' + pathname];
    if (!r) return fail(res, 404, 'not_found');
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin) { let ok = false; try { ok = new URL(origin).host === req.headers.host; } catch (_) {} if (!ok) return fail(res, 403, 'bad_origin'); }
    }
    const ctx = { ip: clientIp(req), body: {}, user: null };
    if (r.auth) {
      ctx.user = await authUser(req);
      if (!ctx.user) return fail(res, 401, 'unauthorized');
      const mt = await maintState();
      if (mt.on && !ctx.user.admin_char) return fail(res, 503, 'maintenance', { message: mt.msg });
    }
    if (r.admin && !(await authAdmin(req))) return fail(res, 401, 'unauthorized');
    if (req.method === 'POST') ctx.body = await readJson(req, r.limit || 20000);
    await r.fn(req, res, ctx);
  } catch (e) {
    if (e && e.status && e.error) return fail(res, e.status, e.error);
    console.error('[error]', e);
    if (!res.headersSent) fail(res, 500, 'server_error');
  }
}

module.exports = { handle, tickSpawns, resolveDue, catchUp };
