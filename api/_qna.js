// Q&A: 관리자가 문의에서 나눈 질문·답변을 정리해 올리는 게시판
// - 관리자가 질문/답변을 쓰고(줄바꿈 가능) 공개 여부를 고릅니다. 공개한 것만 헌터의 '문의 → Q&A' 탭에 보입니다.
// - 수정: 내용·공개 여부 변경 / 회수: 공개를 거두어 비공개로 되돌림(내용은 남음) / 삭제: 완전히 지움
// - 헌터는 'Q&A 질문' 창에서 질문을 보낼 수 있고(표 qna_ask), 관리자가 답하면 Q&A 로 올라갑니다(공개 여부는 관리자가 선택).
// - 새 표 2개: qna, qna_ask
const cp = s => Array.from(String(s)).length;
const Q_MAX = 300, A_MAX = 1000;

const SQL = [
  'CREATE TABLE IF NOT EXISTS qna (id INTEGER PRIMARY KEY AUTOINCREMENT, q TEXT NOT NULL, a TEXT NOT NULL, pub INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, upd INTEGER NOT NULL DEFAULT 0, pub_at INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS qna_pub ON qna(pub, pub_at)',
  'CREATE TABLE IF NOT EXISTS qna_ask (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, q TEXT NOT NULL, ts INTEGER NOT NULL, state INTEGER NOT NULL DEFAULT 0, qna_id INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS qna_ask_user ON qna_ask(user_id, id)',
];
const clean = s => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function install(d) {
  const { db, route, send, fail, limited } = d;
  const row = r => ({ id: r.id, q: r.q, a: r.a, pub: !!r.pub, at: r.at, upd: r.upd, pubAt: r.pub_at });
  const check = b => {
    const q = clean(b.q), a = clean(b.a);
    if (!q || cp(q) > Q_MAX) return { err: 'bad_q' };
    if (!a || cp(a) > A_MAX) return { err: 'bad_a' };
    return { q, a, pub: b.pub ? 1 : 0 };
  };

  // 헌터: 공개된 Q&A (최근 공개한 것부터)
  route('GET', '/api/qna', async (req, res) => {
    const rows = await db.all('SELECT id, q, a, pub, at, upd, pub_at FROM qna WHERE pub = 1 ORDER BY pub_at DESC, id DESC LIMIT 200');
    send(res, 200, { list: rows.map(r => ({ id: r.id, q: r.q, a: r.a, at: r.pub_at || r.at })) });
  });

  // ── 헌터가 보내는 Q&A 질문 ──
  // 헌터: 질문 보내기 (하루 10개까지, 대기 중인 질문은 20개까지)
  route('POST', '/api/qna/ask', async (req, res, ctx) => {
    if (limited && await limited('qask:' + ctx.user.id, 10, 86400000)) return fail(res, 429, 'rate_limited');
    const q = clean(ctx.body.text);
    if (!q || cp(q) > Q_MAX) return fail(res, 400, 'bad_text');
    const w = await db.get('SELECT COUNT(*) AS c FROM qna_ask WHERE user_id = ? AND state = 0', [ctx.user.id]);
    if (Number(w.c) >= 20) return fail(res, 429, 'too_many');
    const ts = Date.now();
    const r = await db.run('INSERT INTO qna_ask (user_id, q, ts, state, qna_id) VALUES (?, ?, ?, 0, 0)', [ctx.user.id, q, ts]);
    send(res, 201, { ok: true, item: { id: r.lastId, q, ts, st: 'wait' } });
  });

  // 헌터: 내가 보낸 질문과 진행 상태 (wait 답변 대기 · open 답변이 공개됨 · closed 처리됨(비공개/삭제))
  route('GET', '/api/qna/mine', async (req, res, ctx) => {
    const rows = await db.all(`SELECT k.id, k.q, k.ts, k.state, k.qna_id, n.a AS a, n.pub AS pub FROM qna_ask k LEFT JOIN qna n ON n.id = k.qna_id
      WHERE k.user_id = ? ORDER BY k.id DESC LIMIT 50`, [ctx.user.id]);
    send(res, 200, { list: rows.map(r => r.state === 0 ? { id: r.id, q: r.q, ts: r.ts, st: 'wait' }
      : (r.pub ? { id: r.id, q: r.q, ts: r.ts, st: 'open', a: r.a } : { id: r.id, q: r.q, ts: r.ts, st: 'closed' })) });
  });

  // 관리자: 답변 대기 중인 질문
  route('GET', '/api/admin/qna/asks', async (req, res) => {
    const rows = await db.all(`SELECT k.id, k.q, k.ts, u.hunter_name AS hn, u.code AS code FROM qna_ask k LEFT JOIN users u ON u.id = k.user_id WHERE k.state = 0 ORDER BY k.id LIMIT 200`);
    send(res, 200, { list: rows.map(r => ({ id: r.id, q: r.q, ts: r.ts, hn: r.hn || '', code: r.code || '' })) });
  }, { auth: false, admin: true });

  // 관리자: 질문에 답하기 → Q&A 로 올립니다 (질문 글은 고칠 수 있음, 공개 여부 선택)
  route('POST', '/api/admin/qna/ask/answer', async (req, res, ctx) => {
    const id = Number(ctx.body.id) || 0, v = check(ctx.body); if (v.err) return fail(res, 400, v.err);
    const k = await db.get('SELECT id FROM qna_ask WHERE id = ? AND state = 0', [id]);
    if (!k) return fail(res, 404, 'not_found');
    const now = Date.now();
    const r = await db.run('INSERT INTO qna (q, a, pub, at, upd, pub_at) VALUES (?, ?, ?, ?, 0, ?)', [v.q, v.a, v.pub, now, v.pub ? now : 0]);
    await db.run('UPDATE qna_ask SET state = 1, qna_id = ? WHERE id = ?', [r.lastId, id]);
    send(res, 201, { ok: true, id: r.lastId });
  }, { auth: false, admin: true });

  // 관리자: 질문 지우기 (답하지 않고 정리)
  route('POST', '/api/admin/qna/ask/delete', async (req, res, ctx) => {
    const r = await db.run('UPDATE qna_ask SET state = 2 WHERE id = ? AND state = 0', [Number(ctx.body.id) || 0]);
    if (!r.changes) return fail(res, 404, 'not_found');
    send(res, 200, { ok: true });
  }, { auth: false, admin: true });

  // 관리자: 전체 목록
  route('GET', '/api/admin/qna', async (req, res) => {
    const rows = await db.all('SELECT id, q, a, pub, at, upd, pub_at FROM qna ORDER BY id DESC LIMIT 300');
    send(res, 200, { list: rows.map(row), max: { q: Q_MAX, a: A_MAX } });
  }, { auth: false, admin: true });

  // 관리자: 새로 올리기 (pub=true 면 바로 공개)
  route('POST', '/api/admin/qna', async (req, res, ctx) => {
    const v = check(ctx.body); if (v.err) return fail(res, 400, v.err);
    const now = Date.now();
    const r = await db.run('INSERT INTO qna (q, a, pub, at, upd, pub_at) VALUES (?, ?, ?, ?, 0, ?)', [v.q, v.a, v.pub, now, v.pub ? now : 0]);
    send(res, 201, { ok: true, id: r.lastId });
  }, { auth: false, admin: true });

  // 관리자: 수정 (내용·공개 여부). 비공개 → 공개로 바뀌면 공개 시각을 새로 잡습니다.
  route('POST', '/api/admin/qna/update', async (req, res, ctx) => {
    const id = Number(ctx.body.id) || 0, v = check(ctx.body); if (v.err) return fail(res, 400, v.err);
    const cur = await db.get('SELECT id, pub, pub_at FROM qna WHERE id = ?', [id]);
    if (!cur) return fail(res, 404, 'not_found');
    const now = Date.now(), pubAt = v.pub ? (cur.pub ? cur.pub_at : now) : cur.pub_at;
    await db.run('UPDATE qna SET q = ?, a = ?, pub = ?, upd = ?, pub_at = ? WHERE id = ?', [v.q, v.a, v.pub, now, pubAt, id]);
    send(res, 200, { ok: true });
  }, { auth: false, admin: true });

  // 관리자: 회수 (공개 → 비공개). 내용은 남겨 두고 다시 공개할 수 있습니다.
  route('POST', '/api/admin/qna/recall', async (req, res, ctx) => {
    const r = await db.run('UPDATE qna SET pub = 0, upd = ? WHERE id = ? AND pub = 1', [Date.now(), Number(ctx.body.id) || 0]);
    if (!r.changes) return fail(res, 404, 'not_public');
    send(res, 200, { ok: true });
  }, { auth: false, admin: true });

  // 관리자: 삭제
  route('POST', '/api/admin/qna/delete', async (req, res, ctx) => {
    const r = await db.run('DELETE FROM qna WHERE id = ?', [Number(ctx.body.id) || 0]);
    if (!r.changes) return fail(res, 404, 'not_found');
    send(res, 200, { ok: true });
  }, { auth: false, admin: true });
}

module.exports = { install, SQL };
