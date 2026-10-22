// Q&A: 관리자가 문의에서 나눈 질문·답변을 정리해 올리는 게시판
// - 관리자가 질문/답변을 쓰고(줄바꿈 가능) 공개 여부를 고릅니다. 공개한 것만 헌터의 '문의 → Q&A' 탭에 보입니다.
// - 수정: 내용·공개 여부 변경 / 회수: 공개를 거두어 비공개로 되돌림(내용은 남음) / 삭제: 완전히 지움
// - 새 표 1개: qna
const cp = s => Array.from(String(s)).length;
const Q_MAX = 300, A_MAX = 1000;

const SQL = [
  'CREATE TABLE IF NOT EXISTS qna (id INTEGER PRIMARY KEY AUTOINCREMENT, q TEXT NOT NULL, a TEXT NOT NULL, pub INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, upd INTEGER NOT NULL DEFAULT 0, pub_at INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS qna_pub ON qna(pub, pub_at)',
];
const clean = s => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function install(d) {
  const { db, route, send, fail } = d;
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
