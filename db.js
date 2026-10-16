'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const file = process.env.DB_FILE || path.join(dir, 'hunter.db');
const db = new DatabaseSync(file);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

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
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  spawned_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS monsters_spawned ON monsters(spawned_at);

CREATE TABLE IF NOT EXISTS kills (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  monster_id INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  at         INTEGER NOT NULL,
  PRIMARY KEY (user_id, monster_id)
);

CREATE TABLE IF NOT EXISTS fail_cd (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  monster_id INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  until      INTEGER NOT NULL,
  PRIMARY KEY (user_id, monster_id)
);

CREATE TABLE IF NOT EXISTS s_window (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  start   INTEGER NOT NULL,
  n       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS s_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  monster_id INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  resolve_at INTEGER NOT NULL,
  resolved   INTEGER NOT NULL DEFAULT 0,
  success    INTEGER NOT NULL DEFAULT 0,
  exp_gain   INTEGER NOT NULL DEFAULT 0,
  level_up   INTEGER NOT NULL DEFAULT 0,
  notified   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS s_attempts_due ON s_attempts(resolved, resolve_at);

CREATE TABLE IF NOT EXISTS friends (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text    TEXT NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(from_id, to_id, id);

CREATE TABLE IF NOT EXISTS notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// 여러 문장을 한 트랜잭션으로 묶습니다.
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
}

module.exports = { db, tx, file };
