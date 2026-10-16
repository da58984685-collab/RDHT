'use strict';
// 적월 헌터 — API 본체. Vercel 함수(api/index.js)와 로컬 개발 서버(dev.js)가 함께 사용합니다.
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const db = require('./db');
const G = require('./game');

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
        [G.REGIONS[G.rnd(0, G.REGIONS.length - 1)].id, names[G.rnd(0, names.length - 1)], rank, next]]);
      next += t.gap();
    }
    // 동시에 다른 요청이 같은 시간대를 처리하지 않도록, 다음 시각을 먼저 '차지'한 쪽만 몬스터를 만듭니다.
    const claim = await db.run('UPDATE spawn_state SET next_at = ? WHERE tier = ? AND next_at = ?', [next, t.k, from]);
    if (claim.changes === 1 && list.length) await db.batch(list);
  }
}

async function grantExp(userId, gain) {
  for (let i = 0; i < 6; i++) {
    const u = await db.get('SELECT lv, exp FROM users WHERE id = ?', [userId]);
    if (!u) return null;
    const r = G.addExp(u.lv, u.exp, gain);
    const w = await db.run('UPDATE users SET lv = ?, exp = ? WHERE id = ? AND lv = ? AND exp = ?', [r.lv, r.exp, userId, u.lv, u.exp]);
    if (w.changes === 1) return r;
  }
  throw new Error('exp_conflict');
}

async function resolveDue() {
  const now = Date.now();
  const due = await db.all('SELECT * FROM s_attempts WHERE resolved = 0 AND resolve_at <= ? ORDER BY resolve_at LIMIT 100', [now]);
  for (const a of due) {
    const claim = await db.run('UPDATE s_attempts SET resolved = 2 WHERE id = ? AND resolved = 0', [a.id]);   // 2 = 처리 중
    if (claim.changes !== 1) continue;
    const m = await db.get('SELECT * FROM monsters WHERE id = ?', [a.monster_id]);
    const u = await db.get('SELECT id, lv FROM users WHERE id = ?', [a.user_id]);
    if (!m || !u) { await db.run('UPDATE s_attempts SET resolved = 1 WHERE id = ?', [a.id]); continue; }
    const p = await db.get('SELECT COUNT(DISTINCT user_id) AS c FROM s_attempts WHERE monster_id = ?', [a.monster_id]);
    const win = G.chance01() < G.huntChance('S', u.lv, p.c);
    let gain = 0, up = 0;
    if (win) {
      const k = await db.run('INSERT OR IGNORE INTO kills (user_id, monster_id, at) VALUES (?, ?, ?)', [u.id, m.id, now]);
      if (k.changes === 1) {
        const r = await grantExp(u.id, G.KILL_EXP.S);
        gain = G.KILL_EXP.S; up = r && r.up ? 1 : 0;
      }
    }
    await db.run('UPDATE s_attempts SET resolved = 1, success = ?, exp_gain = ?, level_up = ? WHERE id = ?', [win ? 1 : 0, gain, up, a.id]);
  }
}

async function catchUp() { await tickSpawns(); await resolveDue(); }

// ───────────── 응답 구성 ─────────────
function publicUser(u) {
  return {
    code: u.code, name: u.name, gender: u.gender, age: u.age, personality: u.personality,
    traits: JSON.parse(u.traits), image: u.image, hunterName: u.hunter_name, rank: u.rank,
    stats: JSON.parse(u.stats), lv: u.lv, exp: u.exp, region: u.region,
  };
}

async function sInfo(userId, now) {
  const w = await db.get('SELECT start, n FROM s_window WHERE user_id = ?', [userId]);
  if (!w || now - w.start >= G.S_WINDOW_MS) return { remaining: G.S_MAX, resetAt: 0 };
  return { remaining: Math.max(0, G.S_MAX - w.n), resetAt: w.start + G.S_WINDOW_MS };
}

async function buildState(u, now) {
  const mons = await db.all(`SELECT * FROM monsters
    WHERE spawned_at > ? OR id IN (SELECT id FROM monsters ORDER BY id DESC LIMIT 6)
    ORDER BY spawned_at DESC, id DESC`, [now - G.ACTIVE_MS]);
  const minId = mons.length ? mons[mons.length - 1].id : 0;
  const [kills, cds, parts, si, pending, results, un, um] = await Promise.all([
    db.all('SELECT monster_id FROM kills WHERE user_id = ? AND monster_id >= ?', [u.id, minId]),
    db.all('SELECT monster_id, until FROM fail_cd WHERE user_id = ? AND until > ?', [u.id, now]),
    db.all(`SELECT monster_id, COUNT(DISTINCT user_id) AS c FROM s_attempts
            WHERE monster_id IN (SELECT id FROM monsters WHERE rank = 'S' AND id >= ?) GROUP BY monster_id`, [minId]),
    sInfo(u.id, now),
    db.all(`SELECT a.id, a.resolve_at, m.name FROM s_attempts a JOIN monsters m ON m.id = a.monster_id
            WHERE a.user_id = ? AND a.resolved = 0 ORDER BY a.resolve_at`, [u.id]),
    db.all(`SELECT a.id, a.success, a.exp_gain, a.level_up, m.name FROM s_attempts a JOIN monsters m ON m.id = a.monster_id
            WHERE a.user_id = ? AND a.resolved = 1 AND a.notified = 0 ORDER BY a.id`, [u.id]),
    db.get('SELECT COUNT(*) AS c FROM notices WHERE id > ?', [u.notice_seen]),
    db.get(`SELECT COUNT(*) AS c FROM messages m JOIN friends f ON f.user_id = m.to_id AND f.friend_id = m.from_id
            WHERE m.to_id = ? AND m.id > f.last_read`, [u.id]),
  ]);
  const killed = new Set(kills.map(r => r.monster_id));
  const cdm = new Map(cds.map(r => [r.monster_id, r.until]));
  const pm = new Map(parts.map(r => [r.monster_id, r.c]));
  return {
    now,
    user: { lv: u.lv, exp: u.exp, region: u.region },
    monsters: mons.map(m => ({
      id: m.id, region: m.region, rname: G.REGION_BY_ID[m.region].name, mon: m.name, r: m.rank, ts: m.spawned_at,
      done: killed.has(m.id), cd: cdm.get(m.id) || 0,
      parts: m.rank === 'S' ? (pm.get(m.id) || 0) : undefined,
    })),
    s: Object.assign(si, { need: G.RAID_NEED, max: G.S_MAX }),
    pending: pending.map(p => ({ id: p.id, mon: p.name, at: p.resolve_at })),
    results: results.map(r => ({ id: r.id, mon: r.name, success: !!r.success, exp: r.exp_gain, levelUp: !!r.level_up })),
    unreadNotices: un.c,
    unreadMsgs: um.c,
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
        (code, name, gender, age, personality, traits, image, hunter_name, rank, stats, pw_salt, pw_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, name, gender, age, pers, JSON.stringify(traits), image, hn, rank, JSON.stringify(stats), salt, hash, Date.now()]);
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
  if (await limited('login:' + ctx.ip, 20, 10 * 60000) || await limited('login:' + code, 8, 10 * 60000)) return fail(res, 429, 'rate_limited');
  const u = await userByCode(code);
  const hash = await hashPw(pw, u ? u.pw_salt : 'x'.repeat(32));
  if (!u || !safeEq(hash, u.pw_hash)) return bad();
  const token = crypto.randomBytes(32).toString('base64url');
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha256(token), u.id, Date.now() + SESSION_MS]);
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

route('POST', '/api/move', async (req, res, ctx) => {
  const id = ctx.body.region;
  if (typeof id !== 'string' || !G.REGION_BY_ID[id]) return fail(res, 400, 'bad_region');
  await db.run('UPDATE users SET region = ? WHERE id = ?', [id, ctx.user.id]);
  send(res, 200, { region: id });
});

route('POST', '/api/hunt', async (req, res, ctx) => {
  const u = ctx.user, now = Date.now();
  if (await limited('hunt:' + u.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  await catchUp();
  const cur = await db.get('SELECT * FROM users WHERE id = ?', [u.id]);
  const m = await db.get('SELECT * FROM monsters WHERE id = ?', [Number(ctx.body.id)]);
  if (!m) return fail(res, 404, 'no_monster');
  if (await db.get('SELECT 1 AS x FROM kills WHERE user_id = ? AND monster_id = ?', [cur.id, m.id])) return fail(res, 409, 'already_done');
  if (now - m.spawned_at >= G.ACTIVE_MS) return fail(res, 410, 'expired');
  if (cur.region !== m.region) return fail(res, 409, 'wrong_region', { region: m.region, rname: G.REGION_BY_ID[m.region].name });

  if (m.rank === 'S') {
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
    return send(res, 200, { result: 'pending', resolveAt: at, s: await sInfo(cur.id, now) });
  }

  const cd = await db.get('SELECT until FROM fail_cd WHERE user_id = ? AND monster_id = ?', [cur.id, m.id]);
  if (cd && cd.until > now) return fail(res, 429, 'cooldown', { until: cd.until });
  if (G.chance01() < G.huntChance(m.rank, cur.lv, 0)) {
    const k = await db.run('INSERT OR IGNORE INTO kills (user_id, monster_id, at) VALUES (?, ?, ?)', [cur.id, m.id, now]);
    if (k.changes !== 1) return fail(res, 409, 'already_done');
    const gain = G.KILL_EXP[m.rank];
    const r = await grantExp(cur.id, gain);
    return send(res, 200, { result: 'success', gain, levelUp: r.up, lv: r.lv, exp: r.exp });
  }
  const until = now + G.cdOf(m.rank);
  await db.run(`INSERT INTO fail_cd (user_id, monster_id, until) VALUES (?, ?, ?)
                ON CONFLICT(user_id, monster_id) DO UPDATE SET until = excluded.until`, [cur.id, m.id, until]);
  send(res, 200, { result: 'fail', until });
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
  send(res, 200, { friends: rows.map(f => ({ code: f.code, hn: f.hn, rank: f.rank, unread: f.unread })) });
});

route('POST', '/api/friends', async (req, res, ctx) => {
  const u = ctx.user;
  if (await limited('addf:' + u.id, 15, 60000)) return fail(res, 429, 'rate_limited');
  const code = normCode(ctx.body.code);
  if (!code) return fail(res, 400, 'bad_code');
  if (code === u.code) return fail(res, 400, 'self');
  const f = await userByCode(code);
  if (!f) return fail(res, 404, 'not_found');
  if (await isFriend(u.id, f.id)) return fail(res, 409, 'already');
  await db.batch([
    ['INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)', [u.id, f.id]],
    ['INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)', [f.id, u.id]],
  ]);
  send(res, 201, { friend: { code: f.code, hn: f.hunter_name, rank: f.rank, unread: 0 } });
});

route('GET', '/api/messages', async (req, res, ctx) => {
  const u = ctx.user, url = new URL(req.url, 'http://x');
  const f = await userByCode(normCode(url.searchParams.get('with')));
  if (!f || !(await isFriend(u.id, f.id))) return fail(res, 404, 'not_found');
  const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
  const rows = after
    ? await db.all(`SELECT id, from_id, text, ts FROM messages
        WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND id > ? ORDER BY id LIMIT 200`, [u.id, f.id, f.id, u.id, after])
    : await db.all(`SELECT * FROM (SELECT id, from_id, text, ts FROM messages
        WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id DESC LIMIT 100) ORDER BY id`, [u.id, f.id, f.id, u.id]);
  if (rows.length) await db.run('UPDATE friends SET last_read = MAX(last_read, ?) WHERE user_id = ? AND friend_id = ?', [rows[rows.length - 1].id, u.id, f.id]);
  send(res, 200, { messages: rows.map(m => ({ id: m.id, me: m.from_id === u.id, t: m.text, ts: m.ts })) });
});

route('POST', '/api/messages', async (req, res, ctx) => {
  const u = ctx.user;
  if (await limited('msg:' + u.id, 30, 60000)) return fail(res, 429, 'rate_limited');
  const f = await userByCode(normCode(ctx.body.to));
  const text = String(ctx.body.text || '').trim();
  if (!f || !(await isFriend(u.id, f.id))) return fail(res, 404, 'not_found');
  if (!text || cp(text) > 200) return fail(res, 400, 'bad_text');
  const ts = Date.now();
  const r = await db.run('INSERT INTO messages (from_id, to_id, text, ts) VALUES (?, ?, ?, ?)', [u.id, f.id, text, ts]);
  send(res, 201, { message: { id: r.lastId, me: true, t: text, ts } });
});

route('GET', '/api/notices', async (req, res, ctx) => {
  const rows = await db.all('SELECT id, text, created_at FROM notices ORDER BY id DESC LIMIT 50');
  send(res, 200, { notices: rows.map(n => ({ id: n.id, text: n.text, ts: n.created_at })), seen: ctx.user.notice_seen });
});

route('POST', '/api/notices/seen', async (req, res, ctx) => {
  await db.run('UPDATE users SET notice_seen = (SELECT COALESCE(MAX(id), 0) FROM notices) WHERE id = ?', [ctx.user.id]);
  send(res, 200, { ok: true });
});

// 관리자: 모든 헌터에게 시스템 알림 (ADMIN_TOKEN 환경변수를 설정해야 사용 가능)
route('POST', '/api/admin/notice', async (req, res, ctx) => {
  if (!ADMIN_TOKEN) return fail(res, 503, 'admin_disabled');
  const h = String(req.headers.authorization || '');
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (await limited('admin:' + ctx.ip, 20, 10 * 60000)) return fail(res, 429, 'rate_limited');
  if (!tok || !safeEq(sha256(tok), sha256(ADMIN_TOKEN))) return fail(res, 401, 'unauthorized');
  const text = String(ctx.body.text || '').trim();
  if (!text || cp(text) > 1000) return fail(res, 400, 'bad_text');
  const r = await db.run('INSERT INTO notices (text, created_at) VALUES (?, ?)', [text, Date.now()]);
  send(res, 201, { id: r.lastId });
}, { auth: false });

// Cron 이 호출: 출몰·S급 결과 따라잡기 + 오래된 데이터 정리. Vercel 은 CRON_SECRET 을 Bearer 로 보냅니다.
route('GET', '/api/cron', async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  const h = String(req.headers.authorization || '');
  if (!secret || !safeEq(sha256(h), sha256('Bearer ' + secret))) return fail(res, 401, 'unauthorized');
  const now = Date.now();
  await catchUp();
  await db.run('UPDATE s_attempts SET resolved = 0 WHERE resolved = 2 AND resolve_at < ?', [now - 5 * 60000]);
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [now]);
  await db.run('DELETE FROM rate_limits WHERE start < ?', [now - G.HOUR]);
  await db.run('DELETE FROM fail_cd WHERE until < ?', [now - G.HOUR]);
  send(res, 200, { ok: true });
}, { auth: false });

route('GET', '/api/healthz', async (req, res) => {
  await db.get('SELECT 1 AS x');
  send(res, 200, { ok: true, db: db.kind });
}, { auth: false });

// ───────────── 진입점 ─────────────
async function handle(req, res) {
  try {
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
    if (req.method === 'POST') ctx.body = await readJson(req, r.limit || 20000);
    await r.fn(req, res, ctx);
  } catch (e) {
    if (e && e.status && e.error) return fail(res, e.status, e.error);
    console.error('[error]', e);
    if (!res.headersSent) fail(res, 500, 'server_error');
  }
}

module.exports = { handle, tickSpawns, resolveDue, catchUp };
