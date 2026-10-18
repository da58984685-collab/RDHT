'use strict';
// 예전 Turso(SQLite) 데이터를 PostgreSQL 로 옮기는 일회용 도구.
//
//   DATABASE_URL="postgresql://..." node tools/migrate-to-postgres.js 백업파일 [--force]
//
// 백업파일: Turso 에서 받은 .db 파일, 또는 `turso db shell <이름> .dump > dump.sql` 로 만든 .sql 덤프.
// 이미 헌터가 있는 Postgres 에는 덮어쓰지 않습니다 (--force 를 주면 같은 번호는 건너뛰고 없는 것만 추가).
// 필요: Node 22.13 이상, 이 폴더에서 `npm install` 로 pg 설치.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const file = process.argv[2];
const force = process.argv.includes('--force');
if (!file || !process.env.DATABASE_URL) {
  console.error('사용법: DATABASE_URL="postgresql://..." node tools/migrate-to-postgres.js <백업.db 또는 dump.sql> [--force]');
  process.exit(1);
}

(async () => {
  // 1) 원본 열기 (.sql 덤프는 임시 메모리 DB 로 복원)
  let src;
  const head = fs.readFileSync(file).subarray(0, 16).toString('latin1');
  if (head.startsWith('SQLite format 3')) src = new DatabaseSync(file, { readOnly: true });
  else {
    src = new DatabaseSync(':memory:');
    src.exec(fs.readFileSync(file, 'utf8').replace(/^\s*PRAGMA[^;]*;/gim, ''));
  }
  const srcTables = src.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'").all().map(r => r.name);

  // 2) 대상 Postgres 준비 (앱과 같은 코드로 표를 만듭니다)
  const db = require(path.join(__dirname, '..', 'api', '_db.js'));
  await db.get('SELECT 1 AS x');
  if (db.kind !== 'postgres') throw new Error('DATABASE_URL 로 Postgres 에 접속하지 못했습니다.');
  const n = (await db.get('SELECT COUNT(*) AS c FROM users')).c;
  if (n > 0 && !force) throw new Error('대상 데이터베이스에 이미 헌터 ' + n + '명이 있습니다. 비어 있는 DB 에서 실행하거나 --force 를 붙이세요.');

  // 3) 표별 복사 (양쪽에 모두 있는 칸만, 500행씩)
  const total = {};
  for (const t of srcTables) {
    const dst = await db.all("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?", [t]);
    if (!dst.length) { console.log('건너뜀(새 구조에 없는 표):', t); continue; }
    if (t === 'settings') { /* pg_schema_v 는 대상 것을 유지 */ }
    const dcols = new Set(dst.map(c => c.column_name));
    const scols = src.prepare('PRAGMA table_info(' + t + ')').all().map(c => c.name).filter(c => dcols.has(c));
    const rows = src.prepare('SELECT ' + scols.map(c => '"' + c + '"').join(', ') + ' FROM "' + t + '"').all();
    let done = 0;
    const per = Math.max(1, Math.floor(30000 / scols.length), 1);
    const step = Math.min(500, per);
    for (let i = 0; i < rows.length; i += step) {
      const chunk = rows.slice(i, i + step);
      const args = [];
      const vals = chunk.map(r => '(' + scols.map(c => { args.push(r[c] === undefined ? null : r[c]); return '?'; }).join(', ') + ')').join(', ');
      // 'INSERT OR IGNORE' 는 앱의 변환기가 ON CONFLICT DO NOTHING 으로 바꿉니다.
      const sql = 'INSERT OR IGNORE INTO ' + t + ' (' + scols.join(', ') + ') VALUES ' + vals;
      const r = await db.run(sql, args);
      done += r.changes;
    }
    total[t] = [rows.length, done];
    console.log(t.padEnd(18), '원본', String(rows.length).padStart(6), '→ 복사', String(done).padStart(6));
  }

  // 4) 자동 증가 번호를 가져온 데이터 뒤로 맞춤
  for (const t of ['users', 'monsters', 's_attempts', 'messages', 'notices', 'inquiries', 'hunt_log', 'acquire_log', 'shop_items', 'board_posts']) {
    await db.get("SELECT setval(pg_get_serial_sequence('" + t + "', 'id'), GREATEST(1, COALESCE((SELECT MAX(id) FROM " + t + "), 0) + 1), false) AS v");
  }
  // 5) 로그인 세션은 옮기지 않습니다 (모두 다시 로그인)
  await db.run('DELETE FROM sessions');
  console.log('\n완료. 헌터', (total.users || [0, 0])[1], '명 이전. 모두 다시 로그인해야 합니다.');
  process.exit(0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
