'use strict';
// 적월 헌터 게임 서버 — 외부 패키지 없이 Node.js 내장 모듈(http, sqlite, crypto)만 사용합니다.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, tx, file: dbFile } = require('./db');
const G = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';     // HTTPS 뒤에서 운영하면 1로 설정
const TRUST_PROXY = process.env.TRUST_PROXY === '1';         // 리버스 프록시 뒤에서 운영하면 1로 설정
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_MS = 30 * 24 * G.HOUR;

// ───────────────────────── 공통 도구 ─────────────────────────
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const cp = s => Array.from(s).length;                         // 글자 수(이모지 포함)
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');

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

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '');
    if (!ct.toLowerCase().startsWith('application/json')) return reject({ status: 415, error: 'json_required' });
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject({ status: 413, error: 'too_large' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); resolve(v && typeof v === 'object' ? v : {}); }
      catch (e) { reject({ status: 400, error: 'bad_json' }); }
    });
    req.on('error', () => reject({ status: 400, error: 'bad_request' }));
  });
}

function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function clientIp(req) {
  if (TRUST_PROXY) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket.remoteAddress || '?';
}

// 간단한 횟수 제한(메모리)
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr); return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 3600000) hits.delete(k);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}, 10 * 60000).unref();

// ───────────────────────── 질의문 ─────────────────────────
const q = {
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByCode: db.prepare('SELECT * FROM users WHERE code = ?'),
  session: db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?'),
  addSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  addUser: db.prepare(`INSERT INTO users
    (code, name, gender, age, personality, traits, image, hunter_name, rank, stats, pw_salt, pw_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  setRegion: db.prepare('UPDATE users SET region = ? WHERE id = ?'),
  setPower: db.prepare('UPDATE users SET lv = ?, exp = ? WHERE id = ?'),
  monster: db.prepare('SELECT * FROM monsters WHERE id = ?'),
  recentMonsters: db.prepare(`SELECT * FROM monsters
    WHERE spawned_at > ? OR id IN (SELECT id FROM monsters ORDER BY id DESC LIMIT 6)
    ORDER BY spawned_at DESC, id DESC`),
  addMonster: db.prepare('INSERT INTO monsters (region, name, rank, spawned_at) VALUES (?, ?, ?, ?)'),
  spawnNext: db.prepare('SELECT next_at FROM spawn_state WHERE tier = ?'),
  setSpawnNext: db.prepare('INSERT INTO spawn_state (tier, next_at) VALUES (?, ?) ON CONFLICT(tier) DO UPDATE SET next_at = excluded.next_at'),
  killed: db.prepare('SELECT 1 FROM kills WHERE user_id = ? AND monster_id = ?'),
  addKill: db.prepare('INSERT OR IGNORE INTO kills (user_id, monster_id, at) VALUES (?, ?, ?)'),
  userKills: db.prepare('SELECT monster_id FROM kills WHERE user_id = ? AND monster_id >= ?'),
  cd: db.prepare('SELECT until FROM fail_cd WHERE user_id = ? AND monster_id = ?'),
  setCd: db.prepare('INSERT INTO fail_cd (user_id, monster_id, until) VALUES (?, ?, ?) ON CONFLICT(user_id, monster_id) DO UPDATE SET until = excluded.until'),
  userCds: db.prepare('SELECT monster_id, until FROM fail_cd WHERE user_id = ? AND until > ?'),
  sWin: db.prepare('SELECT start, n FROM s_window WHERE user_id = ?'),
  setSWin: db.prepare('INSERT INTO s_window (user_id, start, n) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET start = excluded.start, n = excluded.n'),
  addAttempt: db.prepare('INSERT INTO s_attempts (user_id, monster_id, created_at, resolve_at) VALUES (?, ?, ?, ?)'),
  parts: db.prepare('SELECT monster_id, COUNT(DISTINCT user_id) AS c FROM s_attempts WHERE monster_id IN (SELECT id FROM monsters WHERE rank = \'S\' AND id >= ?) GROUP BY monster_id'),
  partsOne: db.prepare('SELECT COUNT(DISTINCT user_id) AS c FROM s_attempts WHERE monster_id = ?'),
  pending: db.prepare(`SELECT a.id, a.resolve_at, m.name FROM s_attempts a JOIN monsters m ON m.id = a.monster_id
    WHERE a.user_id = ? AND a.resolved = 0 ORDER BY a.resolve_at`),
  results: db.prepare(`SELECT a.id, a.success, a.exp_gain, a.level_up, m.name FROM s_attempts a JOIN monsters m ON m.id = a.monster_id
    WHERE a.user_id = ? AND a.resolved = 1 AND a.notified = 0 ORDER BY a.id`),
  ackResult: db.prepare('UPDATE s_attempts SET notified = 1 WHERE id = ? AND user_id = ?'),
  dueAttempts: db.prepare('SELECT * FROM s_attempts WHERE resolved = 0 AND resolve_at <= ? ORDER BY resolve_at LIMIT 200'),
  doneAttempt: db.prepare('UPDATE s_attempts SET resolved = 1, success = ?, exp_gain = ?, level_up = ? WHERE id = ?'),
  friends: db.prepare(`SELECT u.code, u.hunter_name AS hn, u.rank,
      (SELECT COUNT(*) FROM messages m WHERE m.from_id = f.friend_id AND m.to_id = f.user_id AND m.id > f.last_read) AS unread
    FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.hunter_name`),
  isFriend: db.prepare('SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?'),
  addFriend: db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)'),
  unreadMsgs: db.prepare('SELECT COUNT(*) AS c FROM messages m JOIN friends f ON f.user_id = m.to_id AND f.friend_id = m.from_id WHERE m.to_id = ? AND m.id > f.last_read'),
  msgsAfter: db.prepare(`SELECT id, from_id, text, ts FROM messages
    WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND id > ? ORDER BY id LIMIT 200`),
  msgsLast: db.prepare(`SELECT * FROM (SELECT id, from_id, text, ts FROM messages
    WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id DESC LIMIT 100) ORDER BY id`),
  addMsg: db.prepare('INSERT INTO messages (from_id, to_id, text, ts) VALUES (?, ?, ?, ?)'),
  markRead: db.prepare('UPDATE friends SET last_read = MAX(last_read, ?) WHERE user_id = ? AND friend_id = ?'),
  notices: db.prepare('SELECT id, text, created_at FROM notices ORDER BY id DESC LIMIT 50'),
  unreadNotices: db.prepare('SELECT COUNT(*) AS c FROM notices WHERE id > ?'),
  maxNotice: db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM notices'),
  setNoticeSeen: db.prepare('UPDATE users SET notice_seen = ? WHERE id = ?'),
  addNotice: db.prepare('INSERT INTO notices (text, created_at) VALUES (?, ?)'),
};

// ───────────────────────── 몬스터 출몰 / S급 결과 (서버 전체 공통) ─────────────────────────
function tickSpawns() {
  const now = Date.now();
  tx(() => {
    for (const t of G.TIERS) {
      const row = q.spawnNext.get(t.k);
      let next = row ? row.next_at : now;
      if (next < now - 24 * G.HOUR) next = now - 24 * G.HOUR;      // 서버가 오래 꺼져 있었다면 최근 24시간만 반영
      let guard = 0;
      while (next <= now && guard++ < 400) {
        const rank = t.ranks[G.rnd(0, t.ranks.length - 1)];
        const names = G.MON[rank];
        const region = G.REGIONS[G.rnd(0, G.REGIONS.length - 1)].id;
        q.addMonster.run(region, names[G.rnd(0, names.length - 1)], rank, next);
        next += t.gap();
      }
      q.setSpawnNext.run(t.k, next);
    }
  });
}

// 기한이 된 S급 도전의 성공 여부를 이 시점의 서버 참여 인원으로 결정합니다.
function resolveDue() {
  const now = Date.now();
  const due = q.dueAttempts.all(now);
  if (!due.length) return;
  tx(() => {
    for (const a of due) {
      const m = q.monster.get(a.monster_id);
      const u = q.userById.get(a.user_id);
      if (!m || !u) { q.doneAttempt.run(0, 0, 0, a.id); continue; }
      const participants = q.partsOne.get(a.monster_id).c;
      const win = G.chance01() < G.huntChance('S', u.lv, participants);
      let gain = 0, up = 0;
      if (win && !q.killed.get(u.id, m.id)) {
        q.addKill.run(u.id, m.id, now);
        const r = G.addExp(u.lv, u.exp, G.KILL_EXP.S);
        q.setPower.run(r.lv, r.exp, u.id);
        gain = G.KILL_EXP.S; up = r.up ? 1 : 0;
      }
      q.doneAttempt.run(win ? 1 : 0, gain, up, a.id);
    }
  });
}

// ───────────────────────── 응답 구성 ─────────────────────────
function publicUser(u) {
  return {
    code: u.code, name: u.name, gender: u.gender, age: u.age, personality: u.personality,
    traits: JSON.parse(u.traits), image: u.image, hunterName: u.hunter_name, rank: u.rank,
    stats: JSON.parse(u.stats), lv: u.lv, exp: u.exp, region: u.region,
  };
}

function sInfo(userId, now) {
  const w = q.sWin.get(userId);
  if (!w || now - w.start >= G.S_WINDOW_MS) return { remaining: G.S_MAX, resetAt: 0 };
  return { remaining: Math.max(0, G.S_MAX - w.n), resetAt: w.start + G.S_WINDOW_MS };
}

function buildState(u, now) {
  const mons = q.recentMonsters.all(now - G.ACTIVE_MS);
  const minId = mons.length ? mons[mons.length - 1].id : 0;
  const killed = new Set(q.userKills.all(u.id, minId).map(r => r.monster_id));
  const cds = new Map(q.userCds.all(u.id, now).map(r => [r.monster_id, r.until]));
  const parts = new Map(q.parts.all(minId).map(r => [r.monster_id, r.c]));
  const seen = u.notice_seen;
  return {
    now,
    user: { lv: u.lv, exp: u.exp, region: u.region },
    monsters: mons.map(m => ({
      id: m.id, region: m.region, rname: G.REGION_BY_ID[m.region].name, mon: m.name, r: m.rank, ts: m.spawned_at,
      done: killed.has(m.id), cd: cds.get(m.id) || 0,
      parts: m.rank === 'S' ? (parts.get(m.id) || 0) : undefined,
    })),
    s: Object.assign(sInfo(u.id, now), { need: G.RAID_NEED, max: G.S_MAX }),
    pending: q.pending.all(u.id).map(p => ({ id: p.id, mon: p.name, at: p.resolve_at })),
    results: q.results.all(u.id).map(r => ({ id: r.id, mon: r.name, success: !!r.success, exp: r.exp_gain, levelUp: !!r.level_up })),
    unreadNotices: q.unreadNotices.get(seen).c,
    unreadMsgs: q.unreadMsgs.get(u.id).c,
  };
}

// ───────────────────────── 인증 ─────────────────────────
function authUser(req) {
  const t = cookies(req).sid;
  if (!t) return null;
  const s = q.session.get(sha256(t));
  if (!s || s.expires_at < Date.now()) return null;
  return q.userById.get(s.user_id) || null;
}
function cookieHeader(value, maxAgeSec) {
  return `sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}` + (COOKIE_SECURE ? '; Secure' : '');
}

const PW_OK = v => typeof v === 'string' && v.length >= 8 && v.length <= 64 &&
  /[A-Za-z]/.test(v) && /[0-9]/.test(v) && /[^A-Za-z0-9\s]/.test(v);
const CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
function normCode(v) {
  const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : '';
}

// ───────────────────────── API ─────────────────────────
const routes = {};
const route = (method, p, fn, opts) => { routes[method + ' ' + p] = Object.assign({ fn, auth: true }, opts || {}); };

route('POST', '/api/signup', async (req, res, ctx) => {
  if (limited('signup:' + ctx.ip, 10, G.HOUR)) return fail(res, 429, 'rate_limited');
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
  if (image && !(image.length <= 800000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image))) return fail(res, 400, 'bad_image');

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPw(b.password, salt);
  const rank = G.rollRank();                       // 등급과 스탯은 서버에서만 결정됩니다
  const stats = G.rollStats(rank);
  let code, tries = 0;
  for (;;) {
    code = G.makeCode();
    try {
      q.addUser.run(code, name, gender, age, pers, JSON.stringify(traits), image, hn, rank, JSON.stringify(stats), salt, hash, Date.now());
      break;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e.message)) || ++tries > 10) throw e;
    }
  }
  send(res, 201, { code, rank, hunterName: hn });
}, { auth: false, limit: 1200000 });

route('POST', '/api/login', async (req, res, ctx) => {
  const code = normCode(ctx.body.code), pw = String(ctx.body.password || '');
  const bad = () => fail(res, 401, 'bad_credentials');
  if (!code || !pw || pw.length > 64) return bad();
  if (limited('login:' + ctx.ip, 20, 10 * 60000) || limited('login:' + code, 8, 10 * 60000)) return fail(res, 429, 'rate_limited');
  const u = q.userByCode.get(code);
  const hash = hashPw(pw, u ? u.pw_salt : 'x'.repeat(32));      // 코드가 없어도 같은 시간이 걸리게 합니다
  if (!u || !safeEq(hash, u.pw_hash)) return bad();
  const token = crypto.randomBytes(32).toString('base64url');
  q.addSession.run(sha256(token), u.id, Date.now() + SESSION_MS);
  send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(token, SESSION_MS / 1000) });
}, { auth: false });

route('POST', '/api/logout', async (req, res, ctx) => {
  const t = cookies(req).sid;
  if (t) q.delSession.run(sha256(t));
  send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
}, { auth: false });

route('GET', '/api/me', async (req, res, ctx) => {
  send(res, 200, { user: publicUser(ctx.user), state: buildState(ctx.user, Date.now()) });
});

route('GET', '/api/state', async (req, res, ctx) => {
  send(res, 200, buildState(ctx.user, Date.now()));
});

route('POST', '/api/move', async (req, res, ctx) => {
  const id = ctx.body.region;
  if (!G.REGION_BY_ID[id]) return fail(res, 400, 'bad_region');
  q.setRegion.run(id, ctx.user.id);
  send(res, 200, { region: id });
});

route('POST', '/api/hunt', async (req, res, ctx) => {
  const u = ctx.user, now = Date.now();
  if (limited('hunt:' + u.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  const out = tx(() => {
    const cur = q.userById.get(u.id);
    const m = q.monster.get(Number(ctx.body.id));
    if (!m) return { status: 404, error: 'no_monster' };
    if (q.killed.get(cur.id, m.id)) return { status: 409, error: 'already_done' };
    if (now - m.spawned_at >= G.ACTIVE_MS) return { status: 410, error: 'expired' };
    if (cur.region !== m.region) return { status: 409, error: 'wrong_region', region: m.region, rname: G.REGION_BY_ID[m.region].name };

    if (m.rank === 'S') {
      const si = sInfo(cur.id, now);
      if (si.remaining < 1) return { status: 429, error: 's_limit', resetAt: si.resetAt };
      const w = q.sWin.get(cur.id);
      if (!w || now - w.start >= G.S_WINDOW_MS) q.setSWin.run(cur.id, now, 1); else q.setSWin.run(cur.id, w.start, w.n + 1);
      const at = now + G.S_WAIT_MS;
      q.addAttempt.run(cur.id, m.id, now, at);
      return { status: 200, body: { result: 'pending', resolveAt: at, s: sInfo(cur.id, now) } };
    }

    const cd = q.cd.get(cur.id, m.id);
    if (cd && cd.until > now) return { status: 429, error: 'cooldown', until: cd.until };
    if (G.chance01() < G.huntChance(m.rank, cur.lv, 0)) {
      q.addKill.run(cur.id, m.id, now);
      const gain = G.KILL_EXP[m.rank];
      const r = G.addExp(cur.lv, cur.exp, gain);
      q.setPower.run(r.lv, r.exp, cur.id);
      return { status: 200, body: { result: 'success', gain, levelUp: r.up, lv: r.lv, exp: r.exp } };
    }
    const until = now + G.cdOf(m.rank);
    q.setCd.run(cur.id, m.id, until);
    return { status: 200, body: { result: 'fail', until } };
  });
  if (out.error) { const { status, error, ...rest } = out; return fail(res, status, error, rest); }
  send(res, out.status, out.body);
});

route('POST', '/api/results/ack', async (req, res, ctx) => {
  const ids = Array.isArray(ctx.body.ids) ? ctx.body.ids.slice(0, 100) : [];
  tx(() => ids.forEach(id => q.ackResult.run(Number(id), ctx.user.id)));
  send(res, 200, { ok: true });
});

route('GET', '/api/friends', async (req, res, ctx) => {
  send(res, 200, { friends: q.friends.all(ctx.user.id).map(f => ({ code: f.code, hn: f.hn, rank: f.rank, unread: f.unread })) });
});

route('POST', '/api/friends', async (req, res, ctx) => {
  const u = ctx.user;
  if (limited('addf:' + u.id, 15, 60000)) return fail(res, 429, 'rate_limited');
  const code = normCode(ctx.body.code);
  if (!code) return fail(res, 400, 'bad_code');
  if (code === u.code) return fail(res, 400, 'self');
  const f = q.userByCode.get(code);
  if (!f) return fail(res, 404, 'not_found');
  if (q.isFriend.get(u.id, f.id)) return fail(res, 409, 'already');
  tx(() => { q.addFriend.run(u.id, f.id); q.addFriend.run(f.id, u.id); });   // 서로의 친구 목록에 추가됩니다
  send(res, 201, { friend: { code: f.code, hn: f.hunter_name, rank: f.rank, unread: 0 } });
});

route('GET', '/api/messages', async (req, res, ctx) => {
  const u = ctx.user, url = new URL(req.url, 'http://x');
  const f = q.userByCode.get(normCode(url.searchParams.get('with')));
  if (!f || !q.isFriend.get(u.id, f.id)) return fail(res, 404, 'not_found');
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
  const rows = after ? q.msgsAfter.all(u.id, f.id, f.id, u.id, after) : q.msgsLast.all(u.id, f.id, f.id, u.id);
  if (rows.length) q.markRead.run(rows[rows.length - 1].id, u.id, f.id);
  send(res, 200, { messages: rows.map(m => ({ id: m.id, me: m.from_id === u.id, t: m.text, ts: m.ts })) });
});

route('POST', '/api/messages', async (req, res, ctx) => {
  const u = ctx.user;
  if (limited('msg:' + u.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  const f = q.userByCode.get(normCode(ctx.body.to));
  const text = String(ctx.body.text || '').trim();
  if (!f || !q.isFriend.get(u.id, f.id)) return fail(res, 404, 'not_found');
  if (!text || cp(text) > 200) return fail(res, 400, 'bad_text');
  const ts = Date.now();
  const r = q.addMsg.run(u.id, f.id, text, ts);
  send(res, 201, { message: { id: Number(r.lastInsertRowid), me: true, t: text, ts } });
});

route('GET', '/api/notices', async (req, res, ctx) => {
  send(res, 200, { notices: q.notices.all().map(n => ({ id: n.id, text: n.text, ts: n.created_at })), seen: ctx.user.notice_seen });
});

route('POST', '/api/notices/seen', async (req, res, ctx) => {
  q.setNoticeSeen.run(q.maxNotice.get().m, ctx.user.id);
  send(res, 200, { ok: true });
});

// 관리자: 서버의 모든 헌터에게 시스템 알림을 보냅니다. (ADMIN_TOKEN 환경변수를 설정해야 사용할 수 있습니다)
route('POST', '/api/admin/notice', async (req, res, ctx) => {
  if (!ADMIN_TOKEN) return fail(res, 503, 'admin_disabled');
  const h = String(req.headers.authorization || '');
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (limited('admin:' + ctx.ip, 20, 10 * 60000)) return fail(res, 429, 'rate_limited');
  if (!tok || !safeEq(sha256(tok), sha256(ADMIN_TOKEN))) return fail(res, 401, 'unauthorized');
  const text = String(ctx.body.text || '').trim();
  if (!text || cp(text) > 1000) return fail(res, 400, 'bad_text');
  const r = q.addNotice.run(text, Date.now());
  send(res, 201, { id: Number(r.lastInsertRowid) });
}, { auth: false });

route('GET', '/healthz', async (req, res) => send(res, 200, { ok: true }), { auth: false });

// ───────────────────────── 정적 파일 ─────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const SEC = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const full = path.join(PUBLIC_DIR, path.normalize(p));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403, SEC); return res.end('Forbidden'); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SEC)); return res.end('Not found'); }
    res.writeHead(200, Object.assign({
      'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }, SEC));
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

// ───────────────────────── 서버 ─────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://x').pathname;
    if (!pathname.startsWith('/api/') && pathname !== '/healthz') {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SEC); return res.end(); }
      return serveStatic(req, res);
    }
    const r = routes[req.method + ' ' + pathname];
    if (!r) return fail(res, 404, 'not_found');
    if (req.method !== 'GET') {                       // 다른 사이트에서 보낸 요청 차단
      const origin = req.headers.origin;
      if (origin) { let ok = false; try { ok = new URL(origin).host === req.headers.host; } catch (_) {} if (!ok) return fail(res, 403, 'bad_origin'); }
    }
    const ctx = { ip: clientIp(req), body: {}, user: null };
    if (r.auth) {
      ctx.user = authUser(req);
      if (!ctx.user) return fail(res, 401, 'unauthorized');
    }
    if (req.method === 'POST') ctx.body = await readJson(req, r.limit || 20000);
    await r.fn(req, res, ctx);
  } catch (e) {
    if (e && e.status && e.error) return fail(res, e.status, e.error);
    console.error('[error]', e);
    if (!res.headersSent) fail(res, 500, 'server_error');
  }
});

function start(port) {
  tickSpawns(); resolveDue();
  const t1 = setInterval(() => { try { tickSpawns(); } catch (e) { console.error('[spawn]', e); } }, 5000);
  const t2 = setInterval(() => { try { resolveDue(); } catch (e) { console.error('[resolve]', e); } }, 10000);
  t1.unref(); t2.unref();
  return new Promise(resolve => server.listen(port, HOST, () => resolve(server)));
}

if (require.main === module) {
  start(PORT).then(() => {
    console.log(`적월 헌터 서버 실행 중 → http://localhost:${PORT}  (DB: ${dbFile})`);
    if (!ADMIN_TOKEN) console.log('안내: ADMIN_TOKEN을 설정하면 관리자 알림 API를 사용할 수 있습니다.');
  });
  const stop = () => { server.close(() => { try { db.close(); } catch (_) {} process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

module.exports = { start, server, tickSpawns, resolveDue };
