'use strict';
// ═══════════════════════════════════════════════════════════════════════
//  개인 홈페이지 (싸이월드 느낌의 작은 홈피) — 이 파일 하나에 모여 있습니다.
//   · 한줄소개   : 캐릭터 '프로필 소개글'(users.bio)을 그대로 씁니다. 홈피에서 고치면 캐릭터란도 함께 바뀝니다.
//   · 노래       : 유튜브 영상 ID 한 개만 저장합니다 (파일은 저장하지 않음).
//   · 글         : 글자 1000자 + 사진 1장(선택). 한 헌터당 글 30개, 그중 사진 글 10개까지.
//   · 사진       : 화면이 비율을 지켜 한 변 360px 이하 JPEG(약 90KB 이하)로 줄여 올립니다. 서버가 다시 한 번 검사합니다.
//                  목록 응답에는 사진 데이터가 들어가지 않고 주소만 들어가며, 주소는 1년간 브라우저가 다시 받지 않습니다.
//   · 댓글·대댓글: 글마다 댓글 최대 200개. 대댓글은 1단계(답글에 다시 답하면 맨 위 댓글 아래에 붙고 누구에게 답했는지만 표시).
//  ■ 끄고 싶으면: api/_app.js 에서 'HOME:' 으로 검색되는 install 한 줄을 지우면 됩니다 (표는 그대로 남아도 괜찮습니다).
// ═══════════════════════════════════════════════════════════════════════

const POST_MAX = 30, IMG_POST_MAX = 10, BODY_MAX = 1000, CMT_MAX = 200, CMT_PER_POST = 200, PAGE = 8, IMG_B64_MAX = 125000, SIDE_MAX = 640;

// 표 3개(hp_home, hp_posts, hp_comments)는 _db.js 의 SCHEMA 안에 있습니다 (Postgres 에서 새 글 번호를 받으려면 거기 있어야 함).
const SQL = [
  'CREATE INDEX IF NOT EXISTS hp_posts_user ON hp_posts(user_id, id)',
  'CREATE INDEX IF NOT EXISTS hp_comments_post ON hp_comments(post_id, id)',
];

// JPEG 머리말에서 실제 가로·세로를 읽습니다 (화면이 보낸 숫자를 믿지 않기 위해). 읽지 못하면 null.
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xFF) { i++; continue; }
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if ((m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

function install(ctx0) {
  const { db, route, send, fail, limited, userById, isFriend, imgSig, thumbUrl, ytIdOf, safeEq, cp } = ctx0;
  const iUrl = (id, ts) => '/api/hp/img?k=' + id + '.' + imgSig('h' + id, 1) + '&v=' + Number(ts);

  // 이 사람의 홈피를 볼 수 있는가: 본인·친구는 항상, 비공개 헌터는 그 외에게 닫힘
  async function access(viewer, owner) {
    const me = owner.id === viewer.id;
    const fr = me || await isFriend(viewer.id, owner.id);
    return { me, fr, open: me || fr || !owner.is_private };
  }
  const byName = async hn => {
    const t = String(hn || '').trim();
    if (!t || cp(t) > 30) return null;
    const r = await db.all('SELECT id FROM users WHERE hunter_name = ? LIMIT 2', [t]);
    return r.length === 1 ? userById(r[0].id) : null;
  };

  // 홈피 열기: 주인 정보 + 노래 + 글 목록(8개씩). 사진 데이터는 들어 있지 않고 주소만 있음.
  route('GET', '/api/hp', async (req, res, ctx) => {
    if (await limited('hpg:' + ctx.user.id, 120, 60000)) return fail(res, 429, 'rate_limited');
    const q = new URL(req.url, 'http://x').searchParams;
    const owner = q.get('hn') ? await byName(q.get('hn')) : ctx.user;
    if (!owner) return fail(res, 404, 'not_found');
    const ac = await access(ctx.user, owner);
    const head = { hn: owner.hunter_name, rank: owner.rank, av: thumbUrl(owner.id, owner.img_ver, true), avBig: Number(owner.img_ver) > 0 ? '/api/img?k=' + owner.id + '.' + imgSig(String(owner.id), Number(owner.img_ver)) + '&v=' + Number(owner.img_ver) : '', me: ac.me, friend: ac.fr };
    if (!ac.open) return send(res, 200, Object.assign(head, { priv: true, posts: [], more: false, song: null, bio: '' }));
    const before = Number(q.get('before')) || 0;
    const h = await db.get('SELECT song, song_title FROM hp_home WHERE user_id = ?', [owner.id]);
    const rows = await db.all(`SELECT p.id, p.body, p.w, p.h, p.ts, (CASE WHEN p.img <> '' THEN 1 ELSE 0 END) AS hi,
        (SELECT COUNT(*) FROM hp_comments c WHERE c.post_id = p.id) AS cc FROM hp_posts p
      WHERE p.user_id = ?${before ? ' AND p.id < ?' : ''} ORDER BY p.id DESC LIMIT ${PAGE + 1}`, before ? [owner.id, before] : [owner.id]);
    const more = rows.length > PAGE;
    send(res, 200, Object.assign(head, {
      bio: owner.bio || '', song: h && h.song ? { id: h.song, title: h.song_title || '' } : null,
      more, count: before ? undefined : Number((await db.get('SELECT COUNT(*) AS n FROM hp_posts WHERE user_id = ?', [owner.id])).n) || 0,
      posts: rows.slice(0, PAGE).map(r => ({ id: r.id, body: r.body, img: Number(r.hi) ? iUrl(r.id, r.ts) : '', w: r.w, h: r.h, ts: Number(r.ts), cc: Number(r.cc) || 0 })),
      limits: ac.me ? { posts: POST_MAX, imgPosts: IMG_POST_MAX } : undefined,
    }));
  });

  // 사진: 주소의 서명이 맞아야만 열림. 글이 지워지면 404.
  route('GET', '/api/hp/img', async (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams, [id, sig] = String(q.get('k') || '').split('.');
    if (!/^\d+$/.test(id || '') || !safeEq(sig || '', imgSig('h' + id, 1))) return fail(res, 404, 'not_found');
    const r = await db.get('SELECT img FROM hp_posts WHERE id = ?', [Number(id)]);
    const m = r && /^data:image\/jpeg;base64,(.+)$/.exec(r.img || '');
    if (!m) return fail(res, 404, 'not_found');
    const buf = Buffer.from(m[1], 'base64');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  }, { auth: false });

  // 글 한 개의 댓글·대댓글
  route('GET', '/api/hp/comments', async (req, res, ctx) => {
    if (await limited('hpc:' + ctx.user.id, 120, 60000)) return fail(res, 429, 'rate_limited');
    const id = Number(new URL(req.url, 'http://x').searchParams.get('id')) || 0;
    const p = await db.get('SELECT id, user_id FROM hp_posts WHERE id = ?', [id]);
    const owner = p ? await userById(p.user_id) : null;
    if (!owner || !(await access(ctx.user, owner)).open) return fail(res, 404, 'not_found');
    const cs = await db.all(`SELECT c.id, c.user_id, c.parent_id, c.reply_to, c.body, c.ts, u.hunter_name AS hn, u.rank AS rk, u.img_ver AS iv, (CASE WHEN u.thumb <> '' THEN 1 ELSE 0 END) AS ht
      FROM hp_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id LIMIT ${CMT_PER_POST}`, [id]);
    const mod = !!ctx.user.admin_char || owner.id === ctx.user.id;
    send(res, 200, { comments: cs.map(c => ({
      id: c.id, parent: Number(c.parent_id) || 0, hn: c.hn || '(탈퇴한 헌터)', rank: c.rk || '', av: thumbUrl(c.user_id, c.iv, Number(c.ht) > 0),
      toHn: c.reply_to ? ((cs.find(x => x.id === Number(c.reply_to)) || {}).hn || '(삭제된 댓글)') : '',
      body: c.body, ts: Number(c.ts), mine: c.user_id === ctx.user.id, can: mod || c.user_id === ctx.user.id })) });
  });

  // 글쓰기 (사진은 선택)
  route('POST', '/api/hp/post', async (req, res, ctx) => {
    if (await limited('hpp:' + ctx.user.id, 10, 3600000)) return fail(res, 429, 'rate_limited');
    const body = String(ctx.body.text == null ? '' : ctx.body.text).replace(/\r/g, '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
    if (!body || cp(body) > BODY_MAX) return fail(res, 400, 'bad_text');
    let img = '', w = 0, h = 0;
    if (ctx.body.image) {
      const s = String(ctx.body.image), m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(s);
      if (!m || s.length > IMG_B64_MAX) return fail(res, 400, 'bad_image');
      const sz = jpegSize(Buffer.from(m[1], 'base64'));
      if (!sz || !sz.w || !sz.h || sz.w > SIDE_MAX || sz.h > SIDE_MAX) return fail(res, 400, 'bad_image');
      img = s; w = sz.w; h = sz.h;
      const n = Number((await db.get("SELECT COUNT(*) AS n FROM hp_posts WHERE user_id = ? AND img <> ''", [ctx.user.id])).n) || 0;
      if (n >= IMG_POST_MAX) return fail(res, 409, 'img_full', { max: IMG_POST_MAX });
    }
    const total = Number((await db.get('SELECT COUNT(*) AS n FROM hp_posts WHERE user_id = ?', [ctx.user.id])).n) || 0;
    if (total >= POST_MAX) return fail(res, 409, 'full', { max: POST_MAX });
    const r = await db.run('INSERT INTO hp_posts (user_id, body, img, w, h, ts) VALUES (?, ?, ?, ?, ?, ?)', [ctx.user.id, body, img, w, h, Date.now()]);
    // 게이트웨이브 '로그' 칸에 자동 알림 글을 올립니다 (직접 쓸 수 없는 칸). 도배를 막으려고 같은 사람은 30분에 한 번만 올라갑니다. 실패해도 던전로그 글은 그대로 저장됩니다.
    try {
      const now = Date.now(), last = await db.get("SELECT MAX(ts) AS t FROM gw_posts WHERE user_id = ? AND cat = '로그'", [ctx.user.id]);
      if (!last || !Number(last.t) || now - Number(last.t) > 1800000) {
        const line = '\u2018' + ctx.user.hunter_name + '\u2019 님이 던전로그를 업로드했습니다.';
        await db.run('INSERT INTO gw_posts (user_id, title, body, ts, cat) VALUES (?, ?, ?, ?, ?)', [ctx.user.id, Array.from(line).slice(0, 40).join(''), line, now, '로그']);
      }
    } catch (_) {}
    send(res, 201, { id: r.lastId });
  }, { limit: 200000 });

  // 던전로그 알림: 내 글에 달린 댓글 / 내 댓글에 달린 답글 (게이트웨이브 알림과 같은 방식)
  // notify: 마지막으로 확인한 댓글 번호(c) 이후에 새로 생긴 일을 셉니다 (번호를 안 보내면 현재 번호만 알려줌)
  route('GET', '/api/hp/notify', async (req, res, ctx) => {
    if (await limited('hpn:' + ctx.user.id, 40, 60000)) return fail(res, 429, 'rate_limited');
    const q = new URL(req.url, 'http://x').searchParams, me = ctx.user.id;
    const mx = await db.get('SELECT MAX(id) AS m FROM hp_comments');
    const out = { maxCmt: Number(mx && mx.m) || 0, comments: 0, replies: 0 };
    if (q.get('c') === null) return send(res, 200, out);
    const ac = Math.max(0, Number(q.get('c')) || 0);
    if (out.maxCmt > ac) {
      out.replies = Number((await db.get('SELECT COUNT(*) AS n FROM hp_comments c WHERE c.id > ? AND c.user_id != ? AND c.reply_to > 0 AND c.reply_to IN (SELECT id FROM hp_comments WHERE user_id = ?)', [ac, me, me])).n) || 0;
      out.comments = Number((await db.get(`SELECT COUNT(*) AS n FROM hp_comments c JOIN hp_posts p ON p.id = c.post_id WHERE c.id > ? AND c.user_id != ? AND p.user_id = ?
        AND NOT (c.reply_to > 0 AND c.reply_to IN (SELECT id FROM hp_comments WHERE user_id = ?))`, [ac, me, me, me])).n) || 0;
    }
    send(res, 200, out);
  });
  // alerts: 알림 벨 목록 (최근 최대 30건). 읽음 표시는 기기(브라우저)에 저장합니다.
  route('GET', '/api/hp/alerts', async (req, res, ctx) => {
    if (await limited('hpa:' + ctx.user.id, 40, 60000)) return fail(res, 429, 'rate_limited');
    const me = ctx.user.id, snip = t => Array.from(String(t).replace(/\s+/g, ' ')).slice(0, 40).join('');
    const [cs, rs] = await Promise.all([
      db.all(`SELECT c.id, c.ts, c.body AS tx, c.post_id AS pid, u.hunter_name AS hn, u.rank AS rk FROM hp_comments c JOIN hp_posts p ON p.id = c.post_id JOIN users u ON u.id = c.user_id
        WHERE c.user_id != ? AND p.user_id = ? AND NOT (c.reply_to > 0 AND c.reply_to IN (SELECT id FROM hp_comments WHERE user_id = ?)) ORDER BY c.id DESC LIMIT 15`, [me, me, me]),
      db.all(`SELECT c.id, c.ts, c.body AS tx, c.post_id AS pid, u.hunter_name AS hn, u.rank AS rk, ow.hunter_name AS own FROM hp_comments c JOIN users u ON u.id = c.user_id
        LEFT JOIN hp_posts p ON p.id = c.post_id LEFT JOIN users ow ON ow.id = p.user_id
        WHERE c.user_id != ? AND c.reply_to > 0 AND c.reply_to IN (SELECT id FROM hp_comments WHERE user_id = ?) ORDER BY c.id DESC LIMIT 15`, [me, me]),
    ]);
    const al = [];
    cs.forEach(r => al.push({ key: 'c' + r.id, kind: 'cmt', hn: r.hn, rank: r.rk, text: snip(r.tx), post: r.pid, own: '', ts: r.ts }));
    rs.forEach(r => al.push({ key: 'r' + r.id, kind: 'rep', hn: r.hn, rank: r.rk, text: snip(r.tx), post: r.pid, own: r.own === ctx.user.hunter_name ? '' : (r.own || ''), ts: r.ts }));
    al.sort((x, y) => y.ts - x.ts);
    send(res, 200, { alerts: al.slice(0, 30) });
  });

  route('POST', '/api/hp/post/delete', async (req, res, ctx) => {
    const id = Number(ctx.body.id) || 0;
    const p = ctx.user.admin_char ? await db.get('SELECT id FROM hp_posts WHERE id = ?', [id]) : await db.get('SELECT id FROM hp_posts WHERE id = ? AND user_id = ?', [id, ctx.user.id]);
    if (!p) return fail(res, 404, 'not_found');
    await db.batch([['DELETE FROM hp_comments WHERE post_id = ?', [id]], ['DELETE FROM hp_posts WHERE id = ?', [id]]]);
    send(res, 200, { ok: true });
  });

  // 댓글 / 대댓글 (parent 에 댓글 번호를 보내면 대댓글)
  route('POST', '/api/hp/comment', async (req, res, ctx) => {
    if (await limited('hpm:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
    const id = Number(ctx.body.id) || 0, text = String(ctx.body.text == null ? '' : ctx.body.text).replace(/\r/g, '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
    if (!text || cp(text) > CMT_MAX) return fail(res, 400, 'bad_text');
    const p = await db.get('SELECT id, user_id FROM hp_posts WHERE id = ?', [id]);
    const owner = p ? await userById(p.user_id) : null;
    if (!owner || !(await access(ctx.user, owner)).open) return fail(res, 404, 'not_found');
    if (Number((await db.get('SELECT COUNT(*) AS n FROM hp_comments WHERE post_id = ?', [id])).n) >= CMT_PER_POST) return fail(res, 409, 'full', { max: CMT_PER_POST });
    let parent = 0, replyTo = 0;
    const pid = Number(ctx.body.parent) || 0;
    if (pid) {
      const t = await db.get('SELECT id, post_id, parent_id FROM hp_comments WHERE id = ?', [pid]);
      if (!t || Number(t.post_id) !== id) return fail(res, 404, 'no_parent');
      parent = Number(t.parent_id) || t.id; replyTo = t.id;
    }
    const r = await db.run('INSERT INTO hp_comments (post_id, user_id, parent_id, reply_to, body, ts) VALUES (?, ?, ?, ?, ?, ?)', [id, ctx.user.id, parent, replyTo, text, Date.now()]);
    send(res, 201, { id: r.lastId });
  });

  route('POST', '/api/hp/comment/delete', async (req, res, ctx) => {
    const id = Number(ctx.body.id) || 0;
    const c = await db.get('SELECT c.id, c.user_id, p.user_id AS owner FROM hp_comments c JOIN hp_posts p ON p.id = c.post_id WHERE c.id = ?', [id]);
    if (!c || !(ctx.user.admin_char || c.user_id === ctx.user.id || c.owner === ctx.user.id)) return fail(res, 404, 'not_found');      // 본인 댓글 · 홈피 주인 · 관리자 캐릭터
    await db.run('DELETE FROM hp_comments WHERE id = ? OR parent_id = ?', [id, id]);
    send(res, 200, { ok: true });
  });

  // 홈피 노래 (유튜브 링크 또는 영상 ID. 비우면 삭제)
  route('POST', '/api/hp/song', async (req, res, ctx) => {
    if (await limited('hps:' + ctx.user.id, 10, 60000)) return fail(res, 429, 'rate_limited');
    const raw = String(ctx.body.url == null ? '' : ctx.body.url).trim().slice(0, 300);
    const id = ytIdOf(raw);
    if (raw && !id) return fail(res, 400, 'bad_url');
    const title = id ? String(ctx.body.title == null ? '' : ctx.body.title).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 40) : '';
    await db.run('INSERT INTO hp_home (user_id, song, song_title, upd) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET song = excluded.song, song_title = excluded.song_title, upd = excluded.upd', [ctx.user.id, id, title, Date.now()]);
    send(res, 200, { ok: true, song: id ? { id, title } : null });
  });

  // 탈퇴·삭제할 때 함께 지울 것
  return { purge: id => [
    ['DELETE FROM hp_comments WHERE user_id = ? OR post_id IN (SELECT id FROM hp_posts WHERE user_id = ?)', [id, id]],
    ['DELETE FROM hp_posts WHERE user_id = ?', [id]],
    ['DELETE FROM hp_home WHERE user_id = ?', [id]],
  ] };
}

module.exports = { install, SQL, jpegSize };
