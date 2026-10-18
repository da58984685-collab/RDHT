'use strict';
// 데이터베이스 연결.
//  - DATABASE_URL 이 있으면 PostgreSQL(Neon, Supabase 등)을 사용합니다. (Vercel 배포용)
//  - 없으면 내 컴퓨터의 파일(data/hunter.db)을 사용합니다. (개발·테스트용, Node 22.13 이상)
// 앱의 SQL 은 SQLite 문법으로 쓰며, Postgres 에서는 _pgsql.js 가 실행 직전에 변환합니다. 접근은 아래 get / all / run / batch 로만 합니다.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  gender      TEXT NOT NULL,
  age         INTEGER NOT NULL,
  personality TEXT NOT NULL,
  traits      TEXT NOT NULL DEFAULT '[]',
  image       TEXT NOT NULL DEFAULT '',
  hunter_name TEXT NOT NULL,
  rank        TEXT NOT NULL,
  stats       TEXT NOT NULL,
  pw_salt     TEXT NOT NULL,
  pw_hash     TEXT NOT NULL,
  lv          INTEGER NOT NULL DEFAULT 1,
  exp         INTEGER NOT NULL DEFAULT 0,
  region      TEXT NOT NULL DEFAULT 'city',
  notice_seen INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS spawn_state (
  tier    TEXT PRIMARY KEY,
  next_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS monsters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  region     TEXT NOT NULL,
  name       TEXT NOT NULL,
  rank       TEXT NOT NULL,
  spawned_at INTEGER NOT NULL,
  owner_id   INTEGER
);
CREATE INDEX IF NOT EXISTS monsters_spawned ON monsters(spawned_at);
CREATE TABLE IF NOT EXISTS user_spawn (
  user_id INTEGER NOT NULL,
  tier    TEXT NOT NULL,
  next_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, tier)
);
CREATE TABLE IF NOT EXISTS kills (
  user_id    INTEGER NOT NULL,
  monster_id INTEGER NOT NULL,
  at         INTEGER NOT NULL,
  PRIMARY KEY (user_id, monster_id)
);
CREATE TABLE IF NOT EXISTS fail_cd (
  user_id    INTEGER NOT NULL,
  monster_id INTEGER NOT NULL,
  until      INTEGER NOT NULL,
  PRIMARY KEY (user_id, monster_id)
);
CREATE TABLE IF NOT EXISTS s_window (
  user_id INTEGER PRIMARY KEY,
  start   INTEGER NOT NULL,
  n       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS s_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  monster_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  resolve_at INTEGER NOT NULL,
  resolved   INTEGER NOT NULL DEFAULT 0,
  success    INTEGER NOT NULL DEFAULT 0,
  exp_gain   INTEGER NOT NULL DEFAULT 0,
  level_up   INTEGER NOT NULL DEFAULT 0,
  notified   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS s_attempts_due ON s_attempts(resolved, resolve_at);
CREATE INDEX IF NOT EXISTS s_attempts_user ON s_attempts(user_id, resolved);
CREATE TABLE IF NOT EXISTS friends (
  user_id   INTEGER NOT NULL,
  friend_id INTEGER NOT NULL,
  last_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, friend_id)
);
CREATE TABLE IF NOT EXISTS friend_requests (
  from_id INTEGER NOT NULL,
  to_id   INTEGER NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id   INTEGER NOT NULL,
  text    TEXT NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(from_id, to_id, id);
CREATE TABLE IF NOT EXISTS notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inquiries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  from_admin INTEGER NOT NULL DEFAULT 0,
  text       TEXT NOT NULL,
  ts         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS inquiries_user ON inquiries(user_id, id);
CREATE TABLE IF NOT EXISTS gw_posts (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title   TEXT NOT NULL,
  body    TEXT NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS gw_comments (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  body    TEXT NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS gw_comments_post ON gw_comments(post_id, id);
CREATE TABLE IF NOT EXISTS gifts (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id   INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  item    TEXT NOT NULL DEFAULT '',
  qty     INTEGER NOT NULL,
  ts      INTEGER NOT NULL,
  seen    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS gifts_to ON gifts(to_id, id);
CREATE TABLE IF NOT EXISTS notice_claims (
  user_id   INTEGER NOT NULL,
  notice_id INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (user_id, notice_id)
);
CREATE TABLE IF NOT EXISTS hunt_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  monster_id INTEGER NOT NULL,
  mon        TEXT NOT NULL,
  rank       TEXT NOT NULL,
  result     TEXT NOT NULL,
  exp_gain   INTEGER NOT NULL DEFAULT 0,
  at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hunt_log_user ON hunt_log(user_id, id);
CREATE TABLE IF NOT EXISTS acquire_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  name    TEXT NOT NULL,
  qty     INTEGER NOT NULL DEFAULT 1,
  source  TEXT NOT NULL DEFAULT '',
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS acquire_user ON acquire_log(user_id, id);
CREATE TABLE IF NOT EXISTS inventory (
  user_id INTEGER NOT NULL,
  item    TEXT NOT NULL,
  qty     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, item)
);
CREATE TABLE IF NOT EXISTS shop_items (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE,
  descr TEXT NOT NULL DEFAULT '',
  at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS achievements (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  descr TEXT NOT NULL DEFAULT '',
  kind  TEXT NOT NULL,
  val   TEXT NOT NULL DEFAULT '',
  at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ach_grants (
  user_id INTEGER NOT NULL,
  ach_id  TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, ach_id)
);
CREATE TABLE IF NOT EXISTS ach_earned (
  user_id INTEGER NOT NULL,
  ach_id  TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, ach_id)
);
CREATE TABLE IF NOT EXISTS board_posts (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  who   TEXT NOT NULL,
  title TEXT NOT NULL,
  body  TEXT NOT NULL,
  tag   TEXT NOT NULL,
  at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invite_rewards (
  user_id INTEGER PRIMARY KEY,
  code    TEXT NOT NULL,
  gold    INTEGER NOT NULL DEFAULT 0,
  item    TEXT NOT NULL DEFAULT '',
  qty     INTEGER NOT NULL DEFAULT 0,
  at      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notice_del (
  user_id   INTEGER NOT NULL,
  notice_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, notice_id)
);
CREATE TABLE IF NOT EXISTS s_close (
  monster_id INTEGER PRIMARY KEY,
  ok         INTEGER NOT NULL,
  how        TEXT NOT NULL,
  at         INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS s_rewards (
  user_id    INTEGER NOT NULL,
  monster_id INTEGER NOT NULL,
  exp        INTEGER NOT NULL,
  gold       INTEGER NOT NULL,
  taint      REAL NOT NULL,
  claimed    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, monster_id)
);
CREATE TABLE IF NOT EXISTS s_ack (
  user_id    INTEGER NOT NULL,
  monster_id INTEGER NOT NULL,
  at         INTEGER NOT NULL,
  PRIMARY KEY (user_id, monster_id)
);
CREATE TABLE IF NOT EXISTS s_log (
  monster_id INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  region     TEXT NOT NULL,
  spawned_at INTEGER NOT NULL,
  status     TEXT NOT NULL,
  ended_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key   TEXT PRIMARY KEY,
  start INTEGER NOT NULL,
  n     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  active     INTEGER NOT NULL DEFAULT 1,
  max_uses   INTEGER NOT NULL DEFAULT 10,
  created_at INTEGER NOT NULL
);
`;


// 예전에 만들어진 표에 새 칸을 추가합니다 (이미 있으면 무시).
const MIGRATIONS = [
  // 마지막으로 접속(요청)한 시각 — 관리자 화면의 동시 접속자 수에 쓰입니다
  'ALTER TABLE users ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0',
  // 관리자 전용 캐릭터(문의함 열람 가능) / 문의 답변 읽음 표시
  'ALTER TABLE users ADD COLUMN admin_char INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN inq_read INTEGER NOT NULL DEFAULT 0',
  // 운영자가 막아 둔 활동 (비트: 1 토벌, 2 이동, 4 상점 구매, 8 메신저 보내기. 0이면 모두 가능)
  'ALTER TABLE users ADD COLUMN block_flags INTEGER NOT NULL DEFAULT 0',
  // 시스템 알림에 첨부하는 아이템 (알림을 연 헌터가 직접 수령)
  "ALTER TABLE notices ADD COLUMN item TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE notices ADD COLUMN qty INTEGER NOT NULL DEFAULT 0',
  // 시스템 알림 제목 (비어 있으면 '시스템 알림'으로 표시)
  "ALTER TABLE notices ADD COLUMN title TEXT NOT NULL DEFAULT ''",
  // 오염도 100: 활동 불가 종료 시각 / 발동 표시 / 오염 몬스터가 어느 헌터에서 나왔는지 / 메시지를 보낼 때의 보낸 사람 오염도
  'ALTER TABLE users ADD COLUMN corrupt_until INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN corrupt_flag INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE monsters ADD COLUMN corrupt_of INTEGER',
  'ALTER TABLE messages ADD COLUMN taint REAL NOT NULL DEFAULT 0',
  // 비공개 유저: 켜 두면 헌터 커뮤니티에서 언급되지 않습니다
  'ALTER TABLE users ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0',
  // 새로 가입한 헌터의 첫 로그인을 커뮤니티에서 한 번 언급하기 위한 상태 (0 해당 없음, 1 로그인 대기, 2 언급 대기, 3 언급 끝)
  'ALTER TABLE users ADD COLUMN intro_state INTEGER NOT NULL DEFAULT 0',
  // 초대 코드 첫 보상(한 번 정하면 수정 불가) / 아이템 사용 효과
  'ALTER TABLE invites ADD COLUMN reward_set INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE invites ADD COLUMN reward_gold INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE invites ADD COLUMN reward_item TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE invites ADD COLUMN reward_qty INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE shop_items ADD COLUMN eff_stat TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE shop_items ADD COLUMN eff_amt INTEGER NOT NULL DEFAULT 0',
  // 스탯 시스템: 체력은 100에서 시작합니다 (기존 헌터는 한 번만 100으로 맞춤). 빈사 상태·재토벌·체력 손실 기록용 칸.
  'ALTER TABLE users ADD COLUMN dying_until INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE fail_cd ADD COLUMN free INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE s_attempts ADD COLUMN hp_loss INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE s_attempts ADD COLUMN hp_done INTEGER NOT NULL DEFAULT 0',
  "UPDATE users SET stats = json_set(stats, '$.hp', 100) WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'hp100_v1')",
  "INSERT OR IGNORE INTO settings (key, value) VALUES ('hp100_v1', '1')",
  // 헌터 커뮤니티: 마지막으로 글에서 언급한 등급 (등급이 오른 헌터를 한 번만 언급하기 위해 사용)
  'ALTER TABLE users ADD COLUMN board_rank TEXT',
  'UPDATE users SET board_rank = rank WHERE board_rank IS NULL',
  // S급은 나라 단위로만 출몰합니다. 예전에 세부 지역(도심 등)에서 나온 기록은 대한민국으로 옮깁니다.
  "UPDATE monsters SET region = 'KR' WHERE rank = 'S' AND region NOT IN ('KR','JP','CN','RU','US','IT','MG','BR','EG','AU','GT')",
  "UPDATE s_log SET region = 'KR' WHERE region NOT IN ('KR','JP','CN','RU','US','IT','MG','BR','EG','AU','GT')",
  "ALTER TABLE users ADD COLUMN invite_code TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE users ADD COLUMN gold INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE users ADD COLUMN pinned_ach TEXT NOT NULL DEFAULT '[]'",
  'ALTER TABLE s_attempts ADD COLUMN taint_gain REAL NOT NULL DEFAULT 0',
  'ALTER TABLE shop_items ADD COLUMN price INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE s_attempts ADD COLUMN gold_gain INTEGER NOT NULL DEFAULT 0',
];

function postgres() {
  const { Pool, types } = require('pg');
  // BIGINT(시각 등)와 NUMERIC 은 기본적으로 문자열로 오므로 숫자로 바꿉니다.
  types.setTypeParser(20, v => Number(v));
  types.setTypeParser(1700, v => Number(v));
  const { makeTranslator, toPgSchema } = require('./_pgsql');
  const tr = makeTranslator(SCHEMA);
  // 환경변수 값의 앞뒤 공백/따옴표 제거. sslmode 는 직접 처리합니다. (Neon, Supabase 모두 SSL 필요)
  let url = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim().replace(/^['"]|['"]$/g, '');
  const noSsl = /sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)(:|\/|$)/.test(url) || /[?&]host=\//.test(url);
  url = url.replace(/([?&])(sslmode|supa)=[^&]*/g, '$1').replace(/[?&]$/, '').replace(/\?&/, '?');
  const pool = new Pool({
    connectionString: url,
    ssl: noSsl ? false : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX || 3),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', () => {});
  const q = (c, sql, args) => c.query(tr.translate(sql), args || []);
  const SCHEMA_V = require('node:crypto').createHash('md5').update(SCHEMA + MIGRATIONS.join('\n')).digest('hex').slice(0, 12);
  return {
    kind: 'postgres',
    init: async () => {
      const c = await pool.connect();
      try {
        // 여러 서버가 동시에 처음 켜져도 한 곳만 표를 만들도록 잠급니다.
        await c.query('SELECT pg_advisory_lock(727001)');
        try {
          const has = await c.query("SELECT to_regclass('public.settings') AS t");
          if (has.rows[0].t) {
            const v = await c.query("SELECT value FROM settings WHERE key = 'pg_schema_v'");
            if (v.rows[0] && v.rows[0].value === SCHEMA_V) return;
          }
          for (const st of toPgSchema(SCHEMA).split(';').map(x => x.trim()).filter(Boolean)) await c.query(st);
          for (const m of MIGRATIONS) {
            if (/json_set|hp100_v1/.test(m)) continue; // SQLite 전용 옛 데이터 보정 (새 데이터베이스에는 필요 없음)
            const sql = toPgSchema(m).replace(/ADD COLUMN (?!IF NOT EXISTS)/, 'ADD COLUMN IF NOT EXISTS ');
            try { await c.query(tr.translate(sql)); } catch (_) {}
          }
          await c.query('ALTER TABLE monsters ADD COLUMN IF NOT EXISTS owner_id BIGINT');
          await c.query('CREATE INDEX IF NOT EXISTS monsters_owner ON monsters(owner_id, spawned_at)');
          await c.query("INSERT INTO settings (key, value) VALUES ('pg_schema_v', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [SCHEMA_V]);
        } finally { try { await c.query('SELECT pg_advisory_unlock(727001)'); } catch (_) {} }
      } finally { c.release(); }
    },
    async get(sql, args) { return (await q(pool, sql, args)).rows[0]; },
    async all(sql, args) { return (await q(pool, sql, args)).rows; },
    async run(sql, args) {
      const r = await q(pool, sql, args);
      return { changes: Number(r.rowCount || 0), lastId: r.rows && r.rows[0] && r.rows[0].id != null ? Number(r.rows[0].id) : 0 };
    },
    // 여러 문장을 한꺼번에(전부 성공하거나 전부 취소) 실행합니다.
    async batch(list) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const [sql, args] of list) await q(c, sql, args);
        await c.query('COMMIT');
      } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; }
      finally { c.release(); }
    },
  };
}

function local() {
  const fs = require('node:fs');
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const dir = process.env.DATA_DIR || path.join('/tmp', 'hunter-data');
  fs.mkdirSync(dir, { recursive: true });
  const file = process.env.DB_FILE || path.join(dir, 'hunter.db');
  const d = new DatabaseSync(file);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const norm = r => (r ? Object.assign({}, r) : r);
  return {
    kind: 'file:' + file,
    init: async () => {
      d.exec(SCHEMA);
      try { d.exec('ALTER TABLE monsters ADD COLUMN owner_id INTEGER'); } catch (_) {}
      for (const q of MIGRATIONS) { try { d.exec(q); } catch (_) {} }
      d.exec('CREATE INDEX IF NOT EXISTS monsters_owner ON monsters(owner_id, spawned_at)');
    },
    async get(sql, args = []) { return norm(d.prepare(sql).get(...args)); },
    async all(sql, args = []) { return d.prepare(sql).all(...args).map(norm); },
    async run(sql, args = []) {
      const r = d.prepare(sql).run(...args);
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    async batch(list) {
      d.exec('BEGIN IMMEDIATE');
      try { for (const [sql, args] of list) d.prepare(sql).run(...(args || [])); d.exec('COMMIT'); }
      catch (e) { try { d.exec('ROLLBACK'); } catch (_) {} throw e; }
    },
  };
}

let impl = null;
function get() {
  if (impl) return impl;
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) impl = postgres();
  else if (process.env.VERCEL) throw Object.assign(new Error('환경변수 DATABASE_URL 이 설정되지 않았습니다. Vercel > Settings > Environment Variables 를 확인한 뒤 재배포하세요.'), { config: true });
  else impl = local();
  return impl;
}
let ready = null;
const ensure = () => ready || (ready = Promise.resolve().then(() => get().init()).then(() => get(), e => { ready = null; throw e; }));

module.exports = {
  get kind() { try { return get().kind; } catch (_) { return 'none'; } },
  async get(sql, args) { return (await ensure()).get(sql, args); },
  async all(sql, args) { return (await ensure()).all(sql, args); },
  async run(sql, args) { return (await ensure()).run(sql, args); },
  async batch(list) { return (await ensure()).batch(list); },
};
