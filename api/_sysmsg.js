// 시스템 팝업: 관리자가 모든 유저에게 보내는 전체 화면 팝업 (이름 · 사진 · 제목 · 내용)
// - 보내면 접속 중인 헌터는 다음 상태 확인(몇 초 안)에 팝업을 보고, 확인을 누르면 다시 뜨지 않습니다.
// - '전송 취소'를 누르면 아직 확인하지 않은 헌터에게는 더 이상 뜨지 않고, 지금 열려 있는 팝업도 닫힙니다.
// - 새 표 2개: sys_popups(보낸 팝업), sys_popup_ack(확인한 기록). 14일이 지난 줄은 새로 보낼 때 함께 지웁니다.
const crypto = require('node:crypto');
const DAY = 86400000;
const LIVE_MS = 3 * DAY;          // 보낸 뒤 3일이 지나면 확인하지 않은 헌터에게도 더 이상 뜨지 않음
const KEEP_MS = 14 * DAY;
const MAX_IMG = 130000;           // 사진(data URL) 최대 글자 수 — 관리자 창에서 480px 로 줄여 보냅니다
const cp = s => Array.from(String(s)).length;

const SQL = [
  "CREATE TABLE IF NOT EXISTS sys_popups (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, body TEXT NOT NULL, img TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'live', at INTEGER NOT NULL, recalled_at INTEGER NOT NULL DEFAULT 0)",
  'CREATE INDEX IF NOT EXISTS sys_popups_st ON sys_popups(status, at)',
  'CREATE TABLE IF NOT EXISTS sys_popup_ack (popup_id TEXT NOT NULL, user_id INTEGER NOT NULL, at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (popup_id, user_id))',
];

// 내가 아직 확인하지 않은, 가장 먼저 보낸 팝업 id (상태 조회 한 번에 함께 가져가도록 SQL 조각으로 제공)
const NEXT_SQL = `(SELECT p.id FROM sys_popups p WHERE p.status = 'live' AND p.at > ? AND NOT EXISTS (SELECT 1 FROM sys_popup_ack a WHERE a.popup_id = p.id AND a.user_id = ?) ORDER BY p.at, p.id LIMIT 1) AS sp`;

// ── 오염 사냥꾼 토벌 기록 (서버 전체) ──
// settings: hunter_kills(토벌 횟수) · hunter_last(마지막 토벌 시각) · hunter_popup('0' 이면 자동 팝업 끔, 기본 켜짐)
const getSet = async (db, k) => { const r = await db.get('SELECT value FROM settings WHERE key = ?', [k]); return r ? r.value : null; };
const putSet = async (db, k, v) => { await db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, String(v)]); await db.run('UPDATE settings SET value = ? WHERE key = ?', [String(v), k]); };
async function hunterState(db) {
  const [k, l, p] = await Promise.all([getSet(db, 'hunter_kills'), getSet(db, 'hunter_last'), getSet(db, 'hunter_popup')]);
  return { kills: Number(k) || 0, last: Number(l) || 0, popup: p !== '0' };
}
// 모든 헌터에게 시스템 팝업 보내기 (관리자 창의 '시스템 팝업'과 같은 표를 씁니다)
async function broadcast(db, name, title, body, now) {
  await db.run('DELETE FROM sys_popup_ack WHERE popup_id IN (SELECT id FROM sys_popups WHERE at < ?)', [now - KEEP_MS]).catch(() => {});
  await db.run('DELETE FROM sys_popups WHERE at < ?', [now - KEEP_MS]).catch(() => {});
  const id = crypto.randomBytes(8).toString('hex');
  await db.run('INSERT INTO sys_popups (id, name, title, body, img, status, at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, name, title, body, '', 'live', now]);
  return id;
}
// 오염 사냥꾼이 토벌될 때마다 부릅니다: 횟수 +1, 시각 기록, 켜져 있으면 자동 팝업
async function hunterKilled(db, now) {
  const st = await hunterState(db), kills = st.kills + 1;
  await putSet(db, 'hunter_kills', kills); await putSet(db, 'hunter_last', now);
  if (st.popup) await broadcast(db, 'SYSTEM', '오염 사냥꾼이 토벌되었습니다.', '오염 사냥꾼이 강화됩니다.', now).catch(() => {});
  return { kills, last: now, popup: st.popup };
}

function install(d) {
  const { db, route, send, fail } = d;
  const pickNext = async (uid, now) => {
    const r = await db.get("SELECT p.id FROM sys_popups p WHERE p.status = 'live' AND p.at > ? AND NOT EXISTS (SELECT 1 FROM sys_popup_ack a WHERE a.popup_id = p.id AND a.user_id = ?) ORDER BY p.at, p.id LIMIT 1", [now - LIVE_MS, uid]);
    return r ? r.id : null;
  };

  // 헌터: 팝업 내용 (한 번 열 때만 가져옵니다)
  route('GET', '/api/sysmsg', async (req, res, ctx) => {
    const id = String(new URL(req.url, 'http://x').searchParams.get('id') || '');
    if (!/^[0-9a-f]{16}$/.test(id)) return fail(res, 400, 'bad_id');
    const p = await db.get("SELECT id, name, title, body, img, at FROM sys_popups WHERE id = ? AND status = 'live' AND at > ?", [id, Date.now() - LIVE_MS]);
    if (!p) return fail(res, 404, 'gone');
    send(res, 200, { id: p.id, name: p.name, title: p.title, body: p.body, img: p.img, at: p.at });
  });

  // 헌터: 확인 (다음 팝업이 있으면 그 id 를 돌려줌)
  route('POST', '/api/sysmsg/ack', async (req, res, ctx) => {
    const id = String(ctx.body.id || '');
    if (!/^[0-9a-f]{16}$/.test(id)) return fail(res, 400, 'bad_id');
    const now = Date.now();
    await db.run('INSERT OR IGNORE INTO sys_popup_ack (popup_id, user_id, at) VALUES (?, ?, ?)', [id, ctx.user.id, now]);
    send(res, 200, { ok: true, next: await pickNext(ctx.user.id, now) });
  });

  // 관리자: 전체 전송
  route('POST', '/api/admin/sysmsg', async (req, res, ctx) => {
    const name = String(ctx.body.name || '').trim() || '운영자';
    const title = String(ctx.body.title || '').trim();
    const body = String(ctx.body.body || '').trim();
    const img = String(ctx.body.img || '');
    if (cp(name) > 20) return fail(res, 400, 'bad_name');
    if (!title || cp(title) > 40) return fail(res, 400, 'bad_title');
    if (!body || cp(body) > 500) return fail(res, 400, 'bad_body');
    if (img && (img.length > MAX_IMG || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img))) return fail(res, 400, 'bad_img');
    const now = Date.now();
    await db.run('DELETE FROM sys_popup_ack WHERE popup_id IN (SELECT id FROM sys_popups WHERE at < ?)', [now - KEEP_MS]).catch(() => {});
    await db.run('DELETE FROM sys_popups WHERE at < ?', [now - KEEP_MS]).catch(() => {});
    const id = crypto.randomBytes(8).toString('hex');
    await db.run('INSERT INTO sys_popups (id, name, title, body, img, status, at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, name, title, body, img, 'live', now]);
    send(res, 201, { ok: true, id });
  }, { auth: false, admin: true });

  // 관리자: 전송 취소(회수)
  route('POST', '/api/admin/sysmsg/recall', async (req, res, ctx) => {
    const id = String(ctx.body.id || '');
    if (!/^[0-9a-f]{16}$/.test(id)) return fail(res, 400, 'bad_id');
    const r = await db.run("UPDATE sys_popups SET status = 'recalled', recalled_at = ? WHERE id = ? AND status = 'live'", [Date.now(), id]);
    if (!r.changes) return fail(res, 404, 'not_live');
    send(res, 200, { ok: true });
  }, { auth: false, admin: true });

  // 관리자: 최근 전송 목록 (사진 본문은 싣지 않음)
  route('GET', '/api/admin/sysmsg', async (req, res) => {
    const rows = await db.all(`SELECT p.id, p.name, p.title, p.status, p.at, p.recalled_at, (p.img <> '') AS has_img,
      (SELECT COUNT(*) FROM sys_popup_ack a WHERE a.popup_id = p.id) AS acks FROM sys_popups p ORDER BY p.at DESC LIMIT 20`);
    const tot = await db.get('SELECT COUNT(*) AS c FROM users');
    send(res, 200, { now: Date.now(), liveMs: LIVE_MS, users: tot.c, list: rows.map(r => ({ id: r.id, name: r.name, title: r.title, status: r.status, at: r.at, recalledAt: r.recalled_at, img: !!r.has_img, acks: Number(r.acks) })) });
  }, { auth: false, admin: true });

  // 관리자: 오염 사냥꾼 현황 (토벌 횟수 · 마지막 토벌 시각 · 자동 팝업 켜기/끄기)
  route('GET', '/api/admin/hunter', async (req, res) => {
    const st = await hunterState(db);
    send(res, 200, { kills: st.kills, last: st.last, popup: st.popup, lv: Math.min(st.kills, require('./_game').HUNTER_LV_MAX), max: require('./_game').HUNTER_LV_MAX });
  }, { auth: false, admin: true });
  route('POST', '/api/admin/hunter', async (req, res, ctx) => {
    if (typeof ctx.body.popup !== 'boolean') return fail(res, 400, 'bad_popup');
    await putSet(db, 'hunter_popup', ctx.body.popup ? '1' : '0');
    send(res, 200, { ok: true, popup: ctx.body.popup });
  }, { auth: false, admin: true });

  return { pickNext };
}

module.exports = { install, SQL, NEXT_SQL, LIVE_MS, hunterState, hunterKilled, broadcast };
