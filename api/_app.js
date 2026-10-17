'use strict';
// 적월협인 — API 본체. Vercel 함수(api/index.js)와 로컬 개발 서버(dev.js)가 함께 사용합니다.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const db = require('./_db');
const G = require('./_game');
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
    let guard = 0;
    while (next <= now && guard++ < 400) {
      const rank = t.ranks[G.rnd(0, t.ranks.length - 1)];
      const names = G.MON[rank];
      list.push(['INSERT INTO monsters (region, name, rank, spawned_at) VALUES (?, ?, ?, ?)',
        [G.COUNTRIES[G.rnd(0, G.COUNTRIES.length - 1)].id, names[G.rnd(0, names.length - 1)], rank, next]]);
      next += t.gap();
    }
    // 동시에 다른 요청이 같은 시간대를 처리하지 않도록, 다음 시각을 먼저 '차지'한 쪽만 몬스터를 만듭니다.
    const claim = await db.run('UPDATE spawn_state SET next_at = ? WHERE tier = ? AND next_at = ?', [next, t.k, from]);
    if (claim.changes === 1 && list.length) await db.batch(list);
  }
}

// F~A급 몬스터는 헌터마다 따로 출몰합니다. 그 헌터가 접속해 요청할 때 밀린 만큼 따라잡아 만듭니다.
async function tickPersonal(uid, now) {
  const me = await db.get('SELECT region FROM users WHERE id = ?', [uid]);
  const myRegions = G.REGIONS;      // F~A급은 헌터가 어디 있든 모든 나라의 모든 세부 지역에서 같은 확률로 출몰
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
    if (next > now) continue;
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
    if (claim.changes === 1 && list.length) await db.batch(list);
  }
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
    st.fame = Math.min(999999, (Number(st.fame) || 0) + n);
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
async function applyHpLoss(userId, rank, now) {
  for (let i = 0; i < 6; i++) {
    const u = await db.get('SELECT stats, dying_until FROM users WHERE id = ?', [userId]);
    if (!u) return { loss: 0, prevented: false, hp: 0, dying: false, until: 0 };
    const st = JSON.parse(u.stats), hp = Number(st.hp) || 0;
    if (G.chance01() < G.guardChance(st.agi)) return { loss: 0, prevented: true, hp, dying: u.dying_until > now, until: u.dying_until };
    const nh = Math.max(G.HP_MIN, hp - G.hpLoss(rank)), loss = Math.max(0, hp - nh);
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
    const r = await applyHpLoss(a.user_id, 'S', now);
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
    const exp = G.KILL_EXP.S;
    list.push(['INSERT OR IGNORE INTO s_rewards (user_id, monster_id, exp, gold, taint) VALUES (?, ?, ?, ?, ?)', [x.user_id, m.id, exp, G.rollGold('S'), G.rollTaint('S')]]);
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
  const due = await db.all('SELECT * FROM s_attempts WHERE resolved = 0 AND resolve_at <= ? ORDER BY resolve_at LIMIT 100', [now]);
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
const CORRUPT_MS = G.HOUR;
async function corruptCheck(userId) {
  const u = await db.get('SELECT id, hunter_name, rank, stats, corrupt_flag FROM users WHERE id = ?', [userId]);
  if (!u) return;
  const t = Number(JSON.parse(u.stats).taint) || 0;
  if (t < 100) { if (u.corrupt_flag) await db.run('UPDATE users SET corrupt_flag = 0 WHERE id = ? AND corrupt_flag = 1', [u.id]); return; }
  if (u.corrupt_flag) return;
  const now = Date.now();
  const claim = await db.run('UPDATE users SET corrupt_flag = 1, corrupt_until = ? WHERE id = ? AND corrupt_flag = 0', [now + CORRUPT_MS, u.id]);
  if (claim.changes !== 1) return;
  const region = G.REGIONS[Math.floor(Math.random() * G.REGIONS.length)].id;
  await db.run('INSERT INTO monsters (region, name, rank, spawned_at, corrupt_of) VALUES (?, ?, ?, ?, ?)', [region, u.hunter_name, u.rank, now, u.id]);
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
    SELECT id, name, region, spawned_at, 'fled', ? FROM monsters WHERE rank = 'S' AND corrupt_of IS NULL AND spawned_at < ?
    AND NOT EXISTS (SELECT 1 FROM kills k WHERE k.monster_id = monsters.id)
    AND NOT EXISTS (SELECT 1 FROM s_close c WHERE c.monster_id = monsters.id AND c.ok = 1)
    AND NOT EXISTS (SELECT 1 FROM s_attempts a WHERE a.monster_id = monsters.id AND (a.resolved != 1 OR a.notified = 0))`,
    [now, now - G.ACTIVE_MS_S]);
  await db.run(`DELETE FROM monsters WHERE corrupt_of IS NULL AND ((rank = 'S' AND spawned_at < ?) OR (rank != 'S' AND spawned_at < ?) OR (rank = 'F' AND spawned_at < ?))
    AND NOT EXISTS (SELECT 1 FROM kills k WHERE k.monster_id = monsters.id)
    AND NOT EXISTS (SELECT 1 FROM s_close c WHERE c.monster_id = monsters.id AND c.ok = 1)
    AND NOT EXISTS (SELECT 1 FROM s_attempts a WHERE a.monster_id = monsters.id AND (a.resolved != 1 OR a.notified = 0))`,
    [now - G.ACTIVE_MS_S, now - G.ACTIVE_MS, now - G.ACTIVE_MS_F]);
  await db.run('DELETE FROM monsters WHERE corrupt_of IS NOT NULL AND spawned_at < ? AND NOT EXISTS (SELECT 1 FROM kills k WHERE k.monster_id = monsters.id)', [now - CORRUPT_MS]);
  await db.run('DELETE FROM fail_cd WHERE monster_id NOT IN (SELECT id FROM monsters)');
}

// ── 헌터 커뮤니티: 5분마다 새 글이 올라옵니다 (요청이 올 때 밀린 만큼 따라잡음) ──
const BOARD_GAP = 5 * G.MIN;
async function boardCtx(now) {
  const mons = {}, regions = G.REGIONS.map(r => G.placeLong(r.id));
  ['F', 'E', 'D', 'C', 'B', 'A'].forEach(k => { mons[k] = G.MON[k]; });
  const sOn = (await db.all(`SELECT name, region FROM monsters WHERE rank = 'S' AND owner_id IS NULL AND corrupt_of IS NULL AND spawned_at > ?
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

async function catchUp() { await corruptTick(); await tickSpawns(); await resolveDue(); await purgeMonsters(); await tickBoard(); }

// ── 업적 (정의는 DB에 저장되어 모든 헌터에게 똑같이 적용됩니다) ──
async function loadAch() {
  if (!(await db.get("SELECT 1 AS x FROM settings WHERE key = 'ach_seeded'"))) {
    await db.batch(G.ACH_SEED.map((a, i) => ['INSERT OR IGNORE INTO achievements (id, name, descr, kind, val, at) VALUES (?, ?, ?, ?, ?, ?)', [a.id, a.name, a.desc, a.kind, a.val, i + 1]]));
    await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('ach_seeded', '1')");
  }
  return db.all('SELECT id, name, descr, kind, val FROM achievements ORDER BY at, id');
}
async function achStats(u) {
  const k = await db.get("SELECT COUNT(*) AS c FROM hunt_log WHERE user_id = ? AND result = 'success'", [u.id]);
  const rs = await db.all("SELECT DISTINCT rank FROM hunt_log WHERE user_id = ? AND result = 'success'", [u.id]);
  const st = await db.get('SELECT COUNT(*) AS c FROM s_attempts WHERE user_id = ?', [u.id]);
  const sw = await db.get("SELECT COUNT(*) AS c FROM hunt_log WHERE user_id = ? AND result = 'success' AND rank = 'S'", [u.id]);
  return { kills: k.c, maxRank: rs.reduce((m, r) => Math.max(m, G.RANK_IDX[r.rank] == null ? -1 : G.RANK_IDX[r.rank]), -1), sTry: st.c, sWin: sw.c, lv: u.lv };
}
const achMet = (a, s) => {
  const n = Number(a.val);
  switch (a.kind) {
    case 'always': return true;
    case 'kills': return s.kills >= n;
    case 'rank': return s.maxRank >= (G.RANK_IDX[a.val] == null ? 99 : G.RANK_IDX[a.val]);
    case 'sTry': return s.sTry >= n;
    case 'sWin': return s.sWin >= n;
    case 'lv': return s.lv >= n;
    default: return false;            // manual: 관리자 부여만
  }
};
// 유저의 업적 상태: [{...정의, met(조건 달성), granted(관리자 부여), done}]
async function achOf(u) {
  const [defs, s, gr] = await Promise.all([loadAch(), achStats(u), db.all('SELECT ach_id FROM ach_grants WHERE user_id = ?', [u.id])]);
  const gs = new Set(gr.map(g => g.ach_id));
  return defs.map(a => { const met = achMet(a, s), granted = gs.has(a.id); return Object.assign({}, a, { met, granted, done: met || granted }); });
}
// 업적을 처음 확인한 시각을 기록합니다 (친구 프로필의 '가장 최근 업적'에 쓰입니다).
// 관리자가 부여한 업적은 부여 시각, 조건으로 달성한 업적은 서버가 처음 확인한 시각이 됩니다.
const achSyncAt = new Map();
async function syncAchEarned(u, now, force) {
  if (!force && (achSyncAt.get(u.id) || 0) > now - 30000) return;
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
    hv.forEach(id => { if (!done.has(id)) ops.push(['DELETE FROM ach_earned WHERE user_id = ? AND ach_id = ?', [u.id, id]]); });
    if (ops.length) await db.batch(ops);
  } catch (_) { achSyncAt.delete(u.id); }
}
const pinIds = u => { try { const a = JSON.parse(u.pinned_ach || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch (_) { return []; } };
const pinnedList = (u, defs) => { const m = new Map(defs.map(a => [a.id, a])); return pinIds(u).filter(id => m.has(id)).slice(0, G.ACH_PIN_MAX).map(id => ({ id, name: m.get(id).name })); };

// 오늘의 추천 (관리자가 입력한 값만 보여줍니다)
async function getRec() {
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
    traits: JSON.parse(u.traits), image: u.image, hunterName: u.hunter_name, rank: u.rank,
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
async function buildState(u, now) {
  await settleDying(u.id, now);
  u = (await db.get('SELECT * FROM users WHERE id = ?', [u.id])) || u;
  await tickPersonal(u.id, now);
  await corruptCheck(u.id);
  u = (await db.get('SELECT * FROM users WHERE id = ?', [u.id])) || u;
  await syncAchEarned(u, now);
  // 보이는 몬스터: 서버 공통 S급 + 내 몬스터(F~A). 예전 공통 F~A 몬스터는 보이지 않습니다.
  const vis = "((owner_id IS NULL AND (rank = 'S' OR corrupt_of IS NOT NULL)) OR owner_id = ?)";
  const mons = await db.all(`SELECT * FROM monsters
    WHERE ${vis} AND (spawned_at > ? OR (rank = 'S' AND spawned_at > ?) OR (corrupt_of IS NOT NULL AND spawned_at > ?) OR id IN (SELECT id FROM monsters WHERE ${vis} ORDER BY id DESC LIMIT 6))
      AND id NOT IN (SELECT monster_id FROM s_close WHERE ok = 0)
      AND NOT (rank = 'F' AND corrupt_of IS NULL AND spawned_at < ${now - G.ACTIVE_MS_F} AND id NOT IN (SELECT monster_id FROM kills WHERE user_id = ?))
    ORDER BY spawned_at DESC, id DESC LIMIT 40`, [u.id, now - G.ACTIVE_MS, now - G.ACTIVE_MS_S, now - CORRUPT_MS, u.id, u.id]);
  const minId = mons.length ? Math.min.apply(null, mons.map(m => m.id)) : 0;
  const [kills, cds, parts, si, pending, results, un, um] = await Promise.all([
    db.all('SELECT monster_id FROM kills WHERE user_id = ? AND monster_id >= ?', [u.id, minId]),
    db.all('SELECT monster_id, until FROM fail_cd WHERE user_id = ? AND until > ?', [u.id, now]),
    db.all(`SELECT monster_id, COUNT(DISTINCT user_id) AS c FROM s_attempts
            WHERE monster_id IN (SELECT id FROM monsters WHERE rank = 'S' AND corrupt_of IS NULL AND id >= ?) GROUP BY monster_id`, [minId]),
    sInfo(u.id, now),
    db.all(`SELECT a.id, a.resolve_at, m.name FROM s_attempts a JOIN monsters m ON m.id = a.monster_id
            WHERE a.user_id = ? AND a.resolved = 0 ORDER BY a.resolve_at`, [u.id]),
    db.all(`SELECT a.id, a.success, a.exp_gain, a.gold_gain, a.taint_gain, a.level_up, a.hp_loss, m.name FROM s_attempts a JOIN monsters m ON m.id = a.monster_id
            WHERE a.user_id = ? AND a.resolved = 1 AND a.notified = 0 ORDER BY a.id`, [u.id]),
    db.get('SELECT COUNT(*) AS c FROM notices WHERE id > ?', [u.notice_seen]),
    db.get(`SELECT COUNT(*) AS c FROM messages m JOIN friends f ON f.user_id = m.to_id AND f.friend_id = m.from_id
            WHERE m.to_id = ? AND m.id > f.last_read`, [u.id]),
  ]);
  const frq = await db.get('SELECT COUNT(*) AS c FROM friend_requests WHERE to_id = ?', [u.id]);
  const inv = await db.all('SELECT i.item, i.qty, s.eff_stat, s.eff_amt FROM inventory i LEFT JOIN shop_items s ON s.name = i.item WHERE i.user_id = ? AND i.qty > 0 ORDER BY i.item', [u.id]);
  const closedOk = new Set((await db.all('SELECT monster_id FROM s_close WHERE ok = 1 AND monster_id >= ?', [minId])).map(r => r.monster_id));
  // S급 토벌 성공 안내(모든 헌터에게): 확인을 누르면 참여자에게만 보상이 지급됩니다
  const swin = await db.all(`SELECT c.monster_id AS id, m.name, r.exp, r.gold, r.taint, CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS part
      FROM s_close c JOIN monsters m ON m.id = c.monster_id
      LEFT JOIN s_rewards r ON r.monster_id = c.monster_id AND r.user_id = ?
      WHERE c.ok = 1 AND c.at >= ? AND NOT EXISTS (SELECT 1 FROM s_ack k WHERE k.user_id = ? AND k.monster_id = c.monster_id)
      ORDER BY c.at LIMIT 5`, [u.id, u.created_at, u.id]);
  const killed = new Set([...kills.map(r => r.monster_id), ...closedOk]);
  const cdm = new Map(cds.map(r => [r.monster_id, r.until]));
  const pm = new Map(parts.map(r => [r.monster_id, r.c]));
  return {
    now,
    user: { pinned: pinnedList(u, await loadAch()), lv: u.lv, exp: u.exp, gold: u.gold, region: u.region, country: G.countryOf(u.region), hunterName: u.hunter_name, private: !!u.is_private, stats: statsOf(u), dyingUntil: u.dying_until > now ? u.dying_until : 0, corruptUntil: u.corrupt_until > now ? u.corrupt_until : 0, tainted: (JSON.parse(u.stats).taint || 0) >= 100, fx: fxOf(JSON.parse(u.stats)) },
    monsters: mons.map(m => ({
      id: m.id, region: m.region, rname: G.placeName(m.region), mon: m.name, r: m.rank, ts: m.spawned_at,
      done: killed.has(m.id), cd: cdm.get(m.id) || 0,
      parts: m.rank === 'S' && m.corrupt_of == null ? (pm.get(m.id) || 0) : undefined,
      c: m.corrupt_of != null ? 1 : undefined,
    })),
    s: Object.assign(si, { need: G.RAID_NEED, needTries: G.RAID_ATTEMPTS, max: G.S_MAX }),
    pending: pending.map(p => ({ id: p.id, mon: p.name, at: p.resolve_at })),
    results: results.map(r => ({ id: r.id, mon: r.name, success: !!r.success, exp: r.exp_gain, gold: r.gold_gain, taint: r.taint_gain, levelUp: !!r.level_up, hpLoss: r.hp_loss })),
    unreadNotices: un.c,
    unreadMsgs: um.c,
    board: (await db.get('SELECT COALESCE(MAX(id), 0) AS m FROM board_posts')).m,
    friendReqs: frq.c,
    sWin: swin.map(x => ({ id: x.id, mon: x.name, part: !!x.part, exp: x.exp || 0, gold: x.gold || 0, taint: x.taint || 0 })),
    rec: await getRec(),
    inventory: inv.map(r => ({ item: r.item, qty: r.qty, eff: r.eff_stat ? { stat: r.eff_stat, amt: r.eff_amt } : null })),
  };
}

// ───────────── 인증 ─────────────
async function authUser(req) {
  const t = cookies(req).sid;
  if (!t) return null;
  const row = await db.get(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
    [sha256(t), Date.now()]);
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
const adminCookie = (v, sec) => `asid=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sec}` + (COOKIE_SECURE ? '; Secure' : '');
// 토벌·습득 기록 (관리자 창에서 조회)
const logHunt = (uid, m, result, gain, at) => db.run(
  'INSERT INTO hunt_log (user_id, monster_id, mon, rank, result, exp_gain, at) VALUES (?, ?, ?, ?, ?, ?, ?)', [uid, m.id, m.name, m.rank, result, gain, at]);
const logAcquire = (uid, kind, name, qty, source, at) => db.run(
  'INSERT INTO acquire_log (user_id, kind, name, qty, source, at) VALUES (?, ?, ?, ?, ?, ?)', [uid, kind, name, qty, source, at]);
const userByCode = code => db.get('SELECT * FROM users WHERE code = ?', [code]);
const isFriend = async (a, b) => !!(await db.get('SELECT 1 AS x FROM friends WHERE user_id = ? AND friend_id = ?', [a, b]));

// ───────────── 경로 ─────────────
const routes = {};
const route = (method, p, fn, opts) => { routes[method + ' ' + p] = Object.assign({ fn, auth: true }, opts || {}); };

route('POST', '/api/signup', async (req, res, ctx) => {
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

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPw(b.password, salt);
  const rank = G.rollRank();
  const stats = G.rollStats(rank);
  let code, tries = 0;
  for (;;) {
    code = G.makeCode();
    try {
      await db.run(`INSERT INTO users
        (code, name, gender, age, personality, traits, image, hunter_name, rank, stats, pw_salt, pw_hash, created_at, invite_code, board_rank, intro_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [code, name, gender, age, pers, JSON.stringify(traits), image, hn, rank, JSON.stringify(stats), salt, hash, Date.now(), inv, rank]);
      break;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e.message)) || ++tries > 10) throw e;
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
  const u = await db.get('SELECT * FROM users WHERE id = ?', [ctx.user.id]);
  send(res, 200, { user: publicUser(u), state: await buildState(u, Date.now()) });
});

route('GET', '/api/state', async (req, res, ctx) => {
  await catchUp();
  const u = await db.get('SELECT * FROM users WHERE id = ?', [ctx.user.id]);
  send(res, 200, await buildState(u, Date.now()));
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

// 세계 지도(나라와 세부 지역)
route('GET', '/api/world', async (req, res) => {
  send(res, 200, { countries: G.COUNTRIES.map(c => ({ id: c.id, name: c.name, lat: c.lat, lon: c.lon,
    regions: c.regions.map(r => ({ id: r.id, name: r.name, sub: r.sub, icon: r.icon, danger: r.danger, pos: r.pos })) })) });
});

// 나라별 현재 헌터 수와 S급 출몰 여부 (지구본에 표시)
route('GET', '/api/world/stats', async (req, res) => {
  const now = Date.now();
  const rows = await db.all('SELECT region, COUNT(*) AS c FROM users GROUP BY region');
  const hunters = {};
  rows.forEach(r => { const k = G.countryOf(r.region); hunters[k] = (hunters[k] || 0) + r.c; });
  const ss = await db.all(`SELECT id, name, region, spawned_at FROM monsters m WHERE rank = 'S' AND owner_id IS NULL AND corrupt_of IS NULL AND spawned_at > ?
    AND id NOT IN (SELECT monster_id FROM s_close)`, [now - G.ACTIVE_MS_S]);
  send(res, 200, { hunters, s: ss.map(m => ({ id: m.id, name: m.name, country: m.region, left: m.spawned_at + G.ACTIVE_MS_S - now })) });
});

route('POST', '/api/move', async (req, res, ctx) => {
  let id = ctx.body.region;
  if (typeof id === 'string' && G.COUNTRY_BY_ID[id]) id = G.COUNTRY_BY_ID[id].regions[0].id;      // 나라를 고르면 그 나라의 첫 지역으로 이동
  if (typeof id !== 'string' || !G.REGION_BY_ID[id]) return fail(res, 400, 'bad_region');
  if (ctx.user.corrupt_until > Date.now()) return fail(res, 409, 'corrupted', { until: ctx.user.corrupt_until });
  await db.run('UPDATE users SET region = ? WHERE id = ?', [id, ctx.user.id]);
  send(res, 200, { region: id, country: G.countryOf(id) });
});

route('POST', '/api/hunt', async (req, res, ctx) => {
  const u = ctx.user, now = Date.now();
  if (await limited('hunt:' + u.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  await catchUp();
  const cur = await db.get('SELECT * FROM users WHERE id = ?', [u.id]);
  const m = await db.get('SELECT * FROM monsters WHERE id = ?', [Number(ctx.body.id)]);
  if (!m) return fail(res, 410, 'expired');
  if ((m.owner_id != null && m.owner_id !== cur.id) || (m.owner_id == null && m.rank !== 'S' && m.corrupt_of == null)) return fail(res, 404, 'no_monster');
  const cm = m.corrupt_of != null;
  if (cur.corrupt_until > now) return fail(res, 409, 'corrupted', { until: cur.corrupt_until });   // 오염도 100: 1시간 활동 불가
  if ((Number(JSON.parse(cur.stats).taint) || 0) >= 100) return fail(res, 409, 'tainted');          // 오염도를 줄여야 토벌 가능
  if (await db.get('SELECT 1 AS x FROM kills WHERE user_id = ? AND monster_id = ?', [cur.id, m.id])) return fail(res, 409, 'already_done');
  if (now - m.spawned_at >= (cm ? CORRUPT_MS : G.activeMsOf(m.rank))) return fail(res, 410, 'expired');
  // S급은 나라 단위, 나머지는 세부 지역 단위로 같은 곳에 있어야 합니다.
  const here = m.rank === 'S' && !cm ? G.countryOf(cur.region) : cur.region;
  if (here !== m.region) return fail(res, 409, 'wrong_region', { region: m.region, rname: G.placeName(m.region) });

  await settleDying(cur.id, now);
  const me = await db.get('SELECT stats, dying_until FROM users WHERE id = ?', [cur.id]);
  if (me.dying_until > now) return fail(res, 409, 'dying', { until: me.dying_until });        // 빈사 상태: 5분간 토벌 불가
  const myStats = JSON.parse(me.stats);
  if (cm && m.corrupt_of === cur.id) return fail(res, 404, 'no_monster');

  if (m.rank === 'S' && !cm) {
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
  if (cm || G.chance01() < G.huntChance(m.rank, cur.lv, 0, myStats.str)) {   // 오염 몬스터는 무조건 성공
    const k = await db.run('INSERT OR IGNORE INTO kills (user_id, monster_id, at) VALUES (?, ?, ?)', [cur.id, m.id, now]);
    if (k.changes !== 1) return fail(res, 409, 'already_done');
    const gain = G.KILL_EXP[m.rank];
    const r = await grantExp(cur.id, gain);
    const gold = G.rollGold(m.rank); await grantGold(cur.id, gold);
    const taint = G.rollTaint(m.rank), taintNow = await grantTaint(cur.id, taint);
    await logHunt(cur.id, m, 'success', gain, now);
    await logAcquire(cur.id, 'exp', '경험치', gain, m.name + ' 토벌', now);
    await logAcquire(cur.id, 'gold', '골드', gold, m.name + ' 토벌', now);
    return send(res, 200, { result: 'success', gain, gold, taint, taintNow, levelUp: r.up, lv: r.lv, exp: r.exp });
  }
  await logHunt(cur.id, m, 'fail', 0, now);
  // 행운: 실패해도 시간 제한 없이 바로 재토벌할 수 있습니다 (1회). 재토벌에서 또 실패하면 보통의 대기 시간이 적용됩니다.
  const prev = await db.get('SELECT free FROM fail_cd WHERE user_id = ? AND monster_id = ?', [cur.id, m.id]);
  const free = !(prev && prev.free === 1) && G.chance01() < G.freeChance(myStats.luck);
  const until = free ? now : now + G.cdOf(m.rank);
  await db.run(`INSERT INTO fail_cd (user_id, monster_id, until, free) VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, monster_id) DO UPDATE SET until = excluded.until, free = excluded.free`, [cur.id, m.id, until, free ? 1 : 0]);
  const hp = await applyHpLoss(cur.id, m.rank, now);
  send(res, 200, { result: 'fail', until, free, hpLoss: hp.loss, prevented: hp.prevented, hpNow: hp.hp, dying: hp.dying, dyingUntil: hp.dying ? hp.until : 0 });
});

route('POST', '/api/results/ack', async (req, res, ctx) => {
  const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids.slice(0, 100).map(Number).filter(Number.isInteger) : [];
  if (ids.length) await db.batch(ids.map(id => ['UPDATE s_attempts SET notified = 1 WHERE id = ? AND user_id = ?', [id, ctx.user.id]]));
  send(res, 200, { ok: true });
});

route('GET', '/api/friends', async (req, res, ctx) => {
  const rows = await db.all(`SELECT u.code, u.hunter_name AS hn, u.rank,
      (SELECT COUNT(*) FROM messages m WHERE m.from_id = f.friend_id AND m.to_id = f.user_id AND m.id > f.last_read) AS unread
    FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.hunter_name`, [ctx.user.id]);
  const inc = await db.all(`SELECT u.code, u.hunter_name AS hn, u.rank, r.at FROM friend_requests r JOIN users u ON u.id = r.from_id
    WHERE r.to_id = ? ORDER BY r.at DESC LIMIT 100`, [ctx.user.id]);
  const out = await db.all(`SELECT u.code, u.hunter_name AS hn, u.rank, r.at FROM friend_requests r JOIN users u ON u.id = r.to_id
    WHERE r.from_id = ? ORDER BY r.at DESC LIMIT 100`, [ctx.user.id]);
  const mp = x => ({ code: x.code, hn: x.hn, rank: x.rank, at: x.at });
  send(res, 200, { friends: rows.map(f => ({ code: f.code, hn: f.hn, rank: f.rank, unread: f.unread })), incoming: inc.map(mp), outgoing: out.map(mp) });
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

// 친구 프로필: 이미지, 헌터 네임, 등급, 현재 위치, 가장 최근에 획득한 업적 1개
route('GET', '/api/friend/profile', async (req, res, ctx) => {
  const u = ctx.user;
  const f = await userByCode(normCode(new URL(req.url, 'http://x').searchParams.get('code')));
  if (!f || !(await isFriend(u.id, f.id))) return fail(res, 404, 'not_found');
  await syncAchEarned(f, Date.now(), true);
  const a = await db.get(`SELECT a.name, a.descr, e.at FROM ach_earned e JOIN achievements a ON a.id = e.ach_id
    WHERE e.user_id = ? ORDER BY e.at DESC, e.rowid DESC LIMIT 1`, [f.id]);
  send(res, 200, { profile: { code: f.code, hn: f.hunter_name, rank: f.rank, image: f.image || '',
    region: G.placeLong(f.region), ach: a ? { name: a.name, desc: a.descr, at: a.at } : null } });
});


route('GET', '/api/messages', async (req, res, ctx) => {
  const u = ctx.user, url = new URL(req.url, 'http://x');
  const f = await userByCode(normCode(url.searchParams.get('with')));
  if (!f || !(await isFriend(u.id, f.id))) return fail(res, 404, 'not_found');
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
  const M = m => ({ id: m.id, me: m.from_id === u.id, t: m.from_id === u.id ? m.text : G.garble(m.text, m.taint, m.id), ts: m.ts });   // 보낸 사람 오염도가 높으면 받는 사람에게만 글자가 깨져 보임
  // 미리보기: 최근 4개만 돌려주고 읽음 처리는 하지 않습니다.
  if (url.searchParams.get('preview')) {
    const pr = await db.all(`SELECT * FROM (SELECT id, from_id, text, ts, taint FROM messages
        WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id DESC LIMIT 4) ORDER BY id`, [u.id, f.id, f.id, u.id]);
    return send(res, 200, { messages: pr.map(M) });
  }
  const rows = after
    ? await db.all(`SELECT id, from_id, text, ts, taint FROM messages
        WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND id > ? ORDER BY id LIMIT 200`, [u.id, f.id, f.id, u.id, after])
    : await db.all(`SELECT * FROM (SELECT id, from_id, text, ts, taint FROM messages
        WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id DESC LIMIT 100) ORDER BY id`, [u.id, f.id, f.id, u.id]);
  if (rows.length) await db.run('UPDATE friends SET last_read = MAX(last_read, ?) WHERE user_id = ? AND friend_id = ?', [rows[rows.length - 1].id, u.id, f.id]);
  send(res, 200, { messages: rows.map(M) });
});

route('POST', '/api/messages', async (req, res, ctx) => {
  const u = ctx.user;
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
  const rows = await db.all('SELECT id, title, text, created_at FROM notices n WHERE NOT EXISTS (SELECT 1 FROM notice_del d WHERE d.user_id = ? AND d.notice_id = n.id) ORDER BY id DESC LIMIT 50', [ctx.user.id]);
  send(res, 200, { notices: rows.map(n => ({ id: n.id, title: n.title || '', text: n.text, ts: n.created_at })), seen: ctx.user.notice_seen });
});

// 읽은 알림만 지울 수 있습니다 (알림 목록을 한 번 열어 '읽음'으로 기록된 뒤에만)
route('POST', '/api/notices/delete', async (req, res, ctx) => {
  const id = Number(ctx.body.id);
  if (!Number.isInteger(id) || id < 1) return fail(res, 400, 'bad_id');
  if (!(await db.get('SELECT 1 AS x FROM notices WHERE id = ?', [id]))) return fail(res, 404, 'no_notice');
  const me = await db.get('SELECT notice_seen FROM users WHERE id = ?', [ctx.user.id]);
  if (!me || id > me.notice_seen) return fail(res, 409, 'unread');
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
  const r = await db.run('INSERT INTO notices (title, text, created_at) VALUES (?, ?, ?)', [title, text, Date.now()]);
  send(res, 201, { id: r.lastId });
}, { auth: false });

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
    db.get('SELECT COUNT(*) AS c FROM kills'),
    db.all('SELECT result, COUNT(*) AS c FROM hunt_log GROUP BY result'),
    db.get('SELECT COUNT(*) AS c FROM s_attempts WHERE resolved = 0'),
    db.get('SELECT COUNT(*) AS c FROM notices'),
  ]);
  send(res, 200, { users: users.c, ranks, kills: kills.c, hunts, pendingS: pend.c, notices: notices.c, now: Date.now() });
}, { auth: false, admin: true });

route('GET', '/api/admin/players', async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 40);
  const like = '%' + q.replace(/[%_]/g, '') + '%';
  const rows = await db.all(`SELECT u.code, u.invite_code AS inv, u.hunter_name AS hn, u.name, u.rank, u.lv, u.exp, u.region, u.created_at,
      (SELECT COUNT(*) FROM kills k WHERE k.user_id = u.id) AS kills,
      (SELECT MAX(at) FROM hunt_log h WHERE h.user_id = u.id) AS last_hunt,
      (SELECT m.region FROM hunt_log h JOIN monsters m ON m.id = h.monster_id WHERE h.user_id = u.id ORDER BY h.id DESC LIMIT 1) AS last_region
    FROM users u WHERE (? = '' OR u.hunter_name LIKE ? OR u.name LIKE ? OR u.code LIKE ?)
    ORDER BY (u.hunter_name = ?) DESC, u.created_at DESC LIMIT 300`, [q, like, like, like.toUpperCase(), q]);
  const rn = id => id ? G.placeLong(id) : '';
  send(res, 200, { players: rows.map(r => ({ code: r.code, hunterName: r.hn, name: r.name, rank: r.rank, lv: r.lv, exp: r.exp,
    region: rn(r.region), lastRegion: rn(r.last_region), created: r.created_at, invite: r.inv || '', kills: r.kills, lastHunt: r.last_hunt || 0 })) });
}, { auth: false, admin: true });

route('GET', '/api/admin/player', async (req, res) => {
  const code = normCode(new URL(req.url, 'http://x').searchParams.get('code'));
  const u = code && await userByCode(code);
  if (!u) return fail(res, 404, 'not_found');
  const [inv, acq, hunts, cnt, fr, pend] = await Promise.all([
    db.all('SELECT item, qty FROM inventory WHERE user_id = ? ORDER BY item', [u.id]),
    db.all('SELECT id, kind, name, qty, source, at FROM acquire_log WHERE user_id = ? ORDER BY id DESC LIMIT 200', [u.id]),
    db.all('SELECT id, mon, rank, result, exp_gain, at FROM hunt_log WHERE user_id = ? ORDER BY id DESC LIMIT 200', [u.id]),
    db.all('SELECT result, COUNT(*) AS c FROM hunt_log WHERE user_id = ? GROUP BY result', [u.id]),
    db.get('SELECT COUNT(*) AS c FROM friends WHERE user_id = ?', [u.id]),
    db.all(`SELECT m.name, a.resolve_at FROM s_attempts a JOIN monsters m ON m.id = a.monster_id WHERE a.user_id = ? AND a.resolved = 0`, [u.id]),
  ]);
  const ach = await achOf(u);
  send(res, 200, {
    achievements: ach.map(a => ({ id: a.id, name: a.name, desc: a.descr, kind: a.kind, met: a.met, granted: a.granted, done: a.done })),
    player: Object.assign(publicUser(u), { inviteReward: await inviteRewardOf(u.id), invite: u.invite_code || '', created: u.created_at, region: G.placeLong(u.region), friends: fr.c }),
    items: inv, acquired: acq, hunts, counts: cnt, pendingS: pend.map(p => ({ mon: p.name, at: p.resolve_at })),
  });
}, { auth: false, admin: true });

const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
route('POST', '/api/admin/player/update', async (req, res, ctx) => {
  const b = ctx.body;
  const u = await userByCode(normCode(b.code));
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
    if (!Number.isInteger(v) || v < 0 || v > 9999) return fail(res, 400, 'bad_stat', { field: k });
    stats[k] = v;
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
    if (!Number.isInteger(fame) || fame < 0 || fame > 999999) return fail(res, 400, 'bad_stat', { field: 'fame' });
  }
  let gold = u.gold;
  if (b.gold !== undefined) { gold = Number(b.gold); if (!Number.isInteger(gold) || gold < 0 || gold > 99999999) return fail(res, 400, 'bad_gold'); }
  if (b.rank !== undefined) { rank = b.rank; if (!RANKS.includes(rank)) return fail(res, 400, 'bad_rank'); }
  if (!fameEdited) {
    if (lv > u.lv) fame += (lv - u.lv) * G.FAME_PER_LV;
    if (G.RANK_IDX[rank] > G.RANK_IDX[u.rank]) fame += (G.RANK_IDX[rank] - G.RANK_IDX[u.rank]) * G.FAME_PER_RANK;
  }
  stats.fame = Math.min(999999, fame);
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
route('POST', '/api/admin/player/item', async (req, res, ctx) => {
  const u = await adminTarget(ctx, res); if (!u) return;
  const item = String(ctx.body.item == null ? '' : ctx.body.item).trim(), qty = Number(ctx.body.qty);
  if (!item || cp(item) > 30) return fail(res, 400, 'bad_item');
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return fail(res, 400, 'bad_qty');
  const prev = await db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [u.id, item]);
  await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET qty = excluded.qty', [u.id, item, qty]);
  const delta = qty - (prev ? prev.qty : 0);
  if (delta > 0) await logAcquire(u.id, 'item', item, delta, '운영자 지급', Date.now());
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

route('POST', '/api/admin/player/item/delete', async (req, res, ctx) => {
  const u = await adminTarget(ctx, res); if (!u) return;
  if (ctx.body.all === true) await db.run('DELETE FROM inventory WHERE user_id = ?', [u.id]);
  else await db.run('DELETE FROM inventory WHERE user_id = ? AND item = ?', [u.id, String(ctx.body.item || '')]);
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

// ───────────── 상점 ─────────────
route('GET', '/api/shop', async (req, res, ctx) => {
  const items = await db.all('SELECT id, name, descr, price, eff_stat, eff_amt FROM shop_items ORDER BY id');
  send(res, 200, { gold: ctx.user.gold, items: items.map(i => ({ id: i.id, name: i.name, desc: i.descr, price: i.price, eff: i.eff_stat ? { stat: i.eff_stat, amt: i.eff_amt } : null })) });
});

route('POST', '/api/shop/buy', async (req, res, ctx) => {
  if (await limited('buy:' + ctx.user.id, 60, G.HOUR)) return fail(res, 429, 'rate_limited');
  if (ctx.user.corrupt_until > Date.now()) return fail(res, 409, 'corrupted', { until: ctx.user.corrupt_until });
  const it = await db.get('SELECT id, name, price FROM shop_items WHERE id = ?', [Number(ctx.body.id) || 0]);
  if (!it) return fail(res, 404, 'no_item');
  const cur = await db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [ctx.user.id, it.name]);
  if (cur && cur.qty >= 9999) return fail(res, 400, 'max_qty');
  if (it.price > 0) {      // 잔액이 충분할 때만 원자적으로 차감
    const pay = await db.run('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?', [it.price, ctx.user.id, it.price]);
    if (pay.changes !== 1) return fail(res, 402, 'no_gold');
  }
  try {
    await db.run('INSERT INTO inventory (user_id, item, qty) VALUES (?, ?, 1) ON CONFLICT(user_id, item) DO UPDATE SET qty = qty + 1', [ctx.user.id, it.name]);
  } catch (e) {
    if (it.price > 0) await grantGold(ctx.user.id, it.price);
    throw e;
  }
  await logAcquire(ctx.user.id, 'item', it.name, 1, it.price > 0 ? '상점 (-' + it.price + ' G)' : '상점', Date.now());
  const me = await db.get('SELECT gold FROM users WHERE id = ?', [ctx.user.id]);
  send(res, 200, { ok: true, item: it.name, gold: me.gold });
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
    else after = Math.max(0, Math.min(9999, before + amt));
    st[stat] = after;
    const w = await db.run('UPDATE users SET stats = ?, dying_until = ? WHERE id = ? AND stats = ? AND dying_until = ?', [JSON.stringify(st), dying, userId, u.stats, u.dying_until]);
    if (w.changes === 1) return { before, after, dying: dying > now ? dying : 0 };
  }
  throw new Error('stat_conflict');
}
// 스탯 투자: 스탯포인트를 근력·민첩·행운 중 하나에 씁니다 (포인트 1당 스탯 +1)
route('POST', '/api/stats/invest', async (req, res, ctx) => {
  const stat = String(ctx.body.stat || ''), amt = ctx.body.amt === undefined ? 1 : Number(ctx.body.amt);
  if (!['str', 'agi', 'luck'].includes(stat)) return fail(res, 400, 'bad_stat');
  if (!Number.isInteger(amt) || amt < 1 || amt > 100) return fail(res, 400, 'bad_amt');
  for (let i = 0; i < 8; i++) {
    const u = await db.get('SELECT lv, stats FROM users WHERE id = ?', [ctx.user.id]);
    const st = JSON.parse(u.stats), sp = spOf(st, u.lv);
    if (sp < amt) return fail(res, 400, 'no_points', { sp });
    st.sp = sp - amt; st[stat] = (Number(st[stat]) || 0) + amt;
    const w = await db.run('UPDATE users SET stats = ? WHERE id = ? AND stats = ?', [JSON.stringify(st), ctx.user.id, u.stats]);
    if (w.changes === 1) return send(res, 200, { ok: true, stats: st, fx: fxOf(st) });
  }
  fail(res, 409, 'busy');
});

// 비공개 유저 설정 (켜면 헌터 커뮤니티에서 언급되지 않음)
route('POST', '/api/me/private', async (req, res, ctx) => {
  const on = ctx.body.on === true ? 1 : 0;
  await db.run('UPDATE users SET is_private = ? WHERE id = ?', [on, ctx.user.id]);
  send(res, 200, { ok: true, private: !!on });
});

route('POST', '/api/inventory/use', async (req, res, ctx) => {
  if (await limited('use:' + ctx.user.id, 120, 60000)) return fail(res, 429, 'rate_limited');
  const name = String(ctx.body.item == null ? '' : ctx.body.item);
  const it = await db.get('SELECT eff_stat, eff_amt FROM shop_items WHERE name = ?', [name]);
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
  send(res, 200, { items: items.map(i => ({ id: i.id, name: i.name, desc: i.descr, price: i.price, stat: i.eff_stat, amt: i.eff_amt })) });
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
  const live = await db.all("SELECT id, name, region, spawned_at FROM monsters WHERE rank = 'S' AND owner_id IS NULL AND corrupt_of IS NULL ORDER BY spawned_at DESC");
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
  const catalog = G.MON.S.map(name => {
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
  if (!G.MON.S.includes(name)) return fail(res, 400, 'bad_name');
  let region = String(ctx.body.region || '');
  if (region && !G.COUNTRY_BY_ID[region]) return fail(res, 400, 'bad_region');      // S급은 나라 단위로만 출현
  if (!region) region = G.COUNTRIES[G.rnd(0, G.COUNTRIES.length - 1)].id;
  const now = Date.now();
  const live = await db.get("SELECT COUNT(*) AS c FROM monsters WHERE rank = 'S' AND owner_id IS NULL AND corrupt_of IS NULL AND spawned_at > ?", [now - G.ACTIVE_MS_S]);
  if (live.c >= 20) return fail(res, 400, 'too_many');
  const r = await db.run("INSERT INTO monsters (region, name, rank, spawned_at) VALUES (?, ?, 'S', ?)", [region, name, now]);
  send(res, 200, { ok: true, id: r.lastId, region });
}, { auth: false, admin: true });

// 성공 팝업의 '확인' → 참여한 헌터에게만 보상 지급
route('POST', '/api/swin/claim', async (req, res, ctx) => {
  const u = ctx.user, id = Number(ctx.body.id) || 0, now = Date.now();
  const c = await db.get('SELECT m.name FROM s_close s JOIN monsters m ON m.id = s.monster_id WHERE s.monster_id = ? AND s.ok = 1', [id]);
  if (!c) return fail(res, 404, 'no_win');
  if (await db.get('SELECT 1 AS x FROM s_ack WHERE user_id = ? AND monster_id = ?', [u.id, id])) return send(res, 200, { ok: true, already: true });
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
  send(res, 200, { ok: true, reward });
});

route('POST', '/api/admin/s/decide', async (req, res, ctx) => {
  const m = await db.get("SELECT * FROM monsters WHERE id = ? AND rank = 'S' AND owner_id IS NULL AND corrupt_of IS NULL", [Number(ctx.body.id) || 0]);
  if (!m) return fail(res, 404, 'no_monster');
  if (await db.get('SELECT 1 AS x FROM s_close WHERE monster_id = ?', [m.id])) return fail(res, 409, 'already_decided');
  const ok = ctx.body.success === true ? await declareSuccess(m, 'admin') : await declareFail(m, 'admin');
  send(res, 200, { ok, success: ctx.body.success === true });
}, { auth: false, admin: true });

// 회수: 아직 아무도 처치하지 못한 S급을 서버 전체에서 거둬들입니다. 대기 중이던 도전은 취소하고 도전권을 돌려줍니다.
route('POST', '/api/admin/s/recall', async (req, res, ctx) => {
  const now = Date.now();
  let rows;
  if (ctx.body.all === true) rows = await db.all("SELECT * FROM monsters WHERE rank = 'S' AND owner_id IS NULL AND corrupt_of IS NULL AND spawned_at > ?", [now - G.ACTIVE_MS_S]);
  else if (ctx.body.id) rows = await db.all("SELECT * FROM monsters WHERE id = ? AND rank = 'S' AND owner_id IS NULL AND corrupt_of IS NULL", [Number(ctx.body.id) || 0]);
  else if (ctx.body.name) rows = await db.all("SELECT * FROM monsters WHERE name = ? AND rank = 'S' AND owner_id IS NULL AND corrupt_of IS NULL AND spawned_at > ?", [String(ctx.body.name), now - G.ACTIVE_MS_S]);
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
  const u = await db.get('SELECT * FROM users WHERE id = ?', [ctx.user.id]);
  const list = await achOf(u), pins = pinnedList(u, list).map(p => p.id);
  send(res, 200, { max: G.ACH_PIN_MAX, list: list.map(a => ({ id: a.id, name: a.name, desc: a.descr, done: a.done, pinned: pins.includes(a.id) })) });
});

route('POST', '/api/achievements/pin', async (req, res, ctx) => {
  const u = await db.get('SELECT * FROM users WHERE id = ?', [ctx.user.id]);
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
  const list = await loadAch();
  send(res, 200, { kinds: G.ACH_KINDS, list: list.map(a => ({ id: a.id, name: a.name, desc: a.descr, kind: a.kind, val: a.val })) });
}, { auth: false, admin: true });

route('POST', '/api/admin/achievements/save', async (req, res, ctx) => {
  const str = v => String(v == null ? '' : v).trim();
  const name = str(ctx.body.name), desc = str(ctx.body.desc), kind = str(ctx.body.kind);
  let val = str(ctx.body.val);
  if (!name || cp(name) > 20) return fail(res, 400, 'bad_name');
  if (cp(desc) > 60) return fail(res, 400, 'bad_desc');
  if (!G.ACH_KINDS.includes(kind)) return fail(res, 400, 'bad_kind');
  if (['kills', 'sTry', 'sWin', 'lv'].includes(kind)) {
    const n = Number(val);
    if (!Number.isInteger(n) || n < 1 || n > 99999) return fail(res, 400, 'bad_val');
    val = String(n);
  } else if (kind === 'rank') { if (G.RANK_IDX[val] == null) return fail(res, 400, 'bad_val'); }
  else val = '';
  const id = str(ctx.body.id);
  if (id) {
    const r = await db.get('SELECT id FROM achievements WHERE id = ?', [id]);
    if (!r) return fail(res, 404, 'no_ach');
    await db.run('UPDATE achievements SET name = ?, descr = ?, kind = ?, val = ? WHERE id = ?', [name, desc, kind, val, id]);
  } else {
    await loadAch();
    const c = await db.get('SELECT COUNT(*) AS c FROM achievements');
    if (c.c >= 100) return fail(res, 400, 'too_many');
    const nid = 'c' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    await db.run('INSERT INTO achievements (id, name, descr, kind, val, at) VALUES (?, ?, ?, ?, ?, ?)', [nid, name, desc, kind, val, Date.now()]);
  }
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

route('POST', '/api/admin/achievements/delete', async (req, res, ctx) => {
  const id = String(ctx.body.id || '');
  await db.batch([['DELETE FROM achievements WHERE id = ?', [id]], ['DELETE FROM ach_grants WHERE ach_id = ?', [id]]]);
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
  await db.run("INSERT INTO settings (key, value) VALUES ('daily_rec', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(rec)]);
  send(res, 200, { ok: true, rec });
}, { auth: false, admin: true });

route('POST', '/api/admin/rec/clear', async (req, res) => {
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
  if (!RANKS.includes(rank)) return fail(res, 400, 'bad_rank');
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
    ['DELETE FROM hunt_log WHERE user_id = ?', [id]],
    ['DELETE FROM acquire_log WHERE user_id = ?', [id]],
    ['DELETE FROM inventory WHERE user_id = ?', [id]],
    ['DELETE FROM invite_rewards WHERE user_id = ?', [id]],
    ['DELETE FROM notice_del WHERE user_id = ?', [id]],
    ['DELETE FROM ach_grants WHERE user_id = ?', [id]],
    ['DELETE FROM user_spawn WHERE user_id = ?', [id]],
    ['DELETE FROM monsters WHERE owner_id = ?', [id]],
    ['DELETE FROM users WHERE id = ?', [id]],
  ]);
  send(res, 200, { ok: true });
}, { auth: false, admin: true });

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
  send(res, 200, { ok: true });
}, { auth: false });

route('GET', '/api/healthz', async (req, res) => {
  try {
    await db.get('SELECT 1 AS x');
    send(res, 200, { ok: true, db: db.kind });
  } catch (e) {
    console.error('[healthz]', e);
    // 설정 점검용: 비밀 값은 포함하지 않고 원인 종류만 알려 줍니다.
    const url = String(process.env.TURSO_DATABASE_URL || ''), tok = String(process.env.TURSO_AUTH_TOKEN || '');
    const diag = {
      version: 3,
      urlSet: !!url, urlStart: url.slice(0, 8), urlHost: url.replace(/^[a-z]+:\/\//i, '').split('/')[0].slice(0, 80), urlHasSpace: /\s/.test(url),
      tokenSet: !!tok, tokenLen: tok.length, tokenLooksJwt: /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(tok.trim()), tokenHasSpace: /\s/.test(tok.trim()),
      cause: String((e.cause && e.cause.message) || '').slice(0, 160),
    };
    send(res, 500, { ok: false, diag, hint: e.config ? e.message : String(e.code || e.name || 'error') + ': ' + String(e.message || '').replace(/(authToken|token)[^ ]*/gi, '***').slice(0, 200) });
  }
}, { auth: false });

// ───────────── 진입점 ─────────────
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
