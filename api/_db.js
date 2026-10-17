'use strict';
// 데이터베이스 연결.
//  - TURSO_DATABASE_URL 이 있으면 Turso(libSQL) 원격 데이터베이스를 사용합니다. (Vercel 배포용)
//  - 없으면 내 컴퓨터의 파일(data/hunter.db)을 사용합니다. (개발·테스트용, Node 22.13 이상)
// 두 방식 모두 같은 SQL(SQLite)을 쓰고, 아래 get / all / run / batch 로만 접근합니다.

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
  "UPDATE monsters SET region = 'KR' WHERE rank = 'S' AND region NOT IN ('KR','JP','CN','RU','US','IT','MG','BR','EG','AU')",
  "UPDATE s_log SET region = 'KR' WHERE region NOT IN ('KR','JP','CN','RU','US','IT','MG','BR','EG','AU')",
  "ALTER TABLE users ADD COLUMN invite_code TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE users ADD COLUMN gold INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE users ADD COLUMN pinned_ach TEXT NOT NULL DEFAULT '[]'",
  'ALTER TABLE s_attempts ADD COLUMN taint_gain REAL NOT NULL DEFAULT 0',
  'ALTER TABLE shop_items ADD COLUMN price INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE s_attempts ADD COLUMN gold_gain INTEGER NOT NULL DEFAULT 0',
];

function remote() {
  const { createClient } = require('@libsql/client');
  // 서버리스에서는 웹소켓(libsql://) 대신 HTTPS 로 접속하는 편이 안정적입니다. 환경변수 값의 앞뒤 공백도 제거합니다.
  const url = String(process.env.TURSO_DATABASE_URL || '').trim().replace(/^libsql:\/\//, 'https://');
  const authToken = String(process.env.TURSO_AUTH_TOKEN || '').trim().replace(/^Bearer\s+/i, '');
  const client = createClient({ url, authToken });
  const toRows = r => r.rows.map(row => {
    const o = {};
    r.columns.forEach((c, i) => { o[c] = row[i]; });
    return o;
  });
  return {
    kind: 'turso',
    init: async () => {
      await client.batch(SCHEMA.split(';').map(x => x.trim()).filter(Boolean).map(sql => ({ sql, args: [] })), 'write');
      // 예전에 만들어진 monsters 표에는 owner_id(개인 몬스터 주인) 칸을 추가합니다.
      try { await client.execute('ALTER TABLE monsters ADD COLUMN owner_id INTEGER'); } catch (_) {}
      for (const q of MIGRATIONS) { try { await client.execute(q); } catch (_) {} }
      await client.execute('CREATE INDEX IF NOT EXISTS monsters_owner ON monsters(owner_id, spawned_at)');
    },
    async get(sql, args = []) { return toRows(await client.execute({ sql, args }))[0]; },
    async all(sql, args = []) { return toRows(await client.execute({ sql, args })); },
    async run(sql, args = []) {
      const r = await client.execute({ sql, args });
      return { changes: Number(r.rowsAffected || 0), lastId: r.lastInsertRowid == null ? 0 : Number(r.lastInsertRowid) };
    },
    // 여러 문장을 한꺼번에(전부 성공하거나 전부 취소) 실행합니다.
    async batch(list) { await client.batch(list.map(([sql, args]) => ({ sql, args: args || [] })), 'write'); },
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
  if (process.env.TURSO_DATABASE_URL) impl = remote();
  else if (process.env.VERCEL) throw Object.assign(new Error('환경변수 TURSO_DATABASE_URL 이 설정되지 않았습니다. Vercel > Settings > Environment Variables 를 확인한 뒤 재배포하세요.'), { config: true });
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
