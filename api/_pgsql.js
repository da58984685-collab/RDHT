'use strict';
// SQLite 문법으로 쓰인 쿼리를 PostgreSQL 문법으로 바꿔 주는 도구 (서버가 Postgres 에 접속할 때만 사용됩니다).
// 앱의 SQL 은 그대로 두고, 아래 규칙으로 실행 직전에 변환합니다.
//   ?                       → $1, $2 ...
//   INSERT OR IGNORE        → INSERT ... ON CONFLICT DO NOTHING
//   INSERT OR REPLACE       → INSERT ... ON CONFLICT (기본키) DO UPDATE SET ...
//   MAX(a,b) / MIN(a,b)     → GREATEST / LEAST (인자가 하나인 MAX/MIN 은 그대로)
//   LIKE                    → ILIKE (SQLite 는 영문 대소문자를 구분하지 않음)
//   json_extract(c,'$.k')   → ((c)::json->>'k')::double precision
//   x.rowid                 → x.ctid
//   CAST(.. AS INTEGER)     → BIGINT (Postgres INTEGER 는 32비트)

function schemaInfo(SCHEMA) {
  const pks = {}, autoId = new Set(), cols = {};
  const re = /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(SCHEMA))) {
    const t = m[1], body = m[2];
    let pk = null;
    cols[t] = body.split('\n').map(l => (l.match(/^\s*(\w+)\s+[A-Z]/) || [])[1]).filter(c => c && !/^(PRIMARY|UNIQUE|FOREIGN)$/.test(c));
    const comp = body.match(/PRIMARY KEY \(([^)]+)\)/);
    if (comp) pk = comp[1].split(',').map(s => s.trim());
    else {
      for (const line of body.split('\n')) {
        const c = line.match(/^\s*(\w+)\s+\w+[^,]*PRIMARY KEY/);
        if (c) { pk = [c[1]]; if (/AUTOINCREMENT/.test(line)) autoId.add(t); }
      }
    }
    pks[t] = pk;
  }
  // 한 줄짜리 CREATE TABLE(_db.js 의 MIGRATIONS · 각 컨텐츠 파일의 SQL)과 ALTER TABLE ... ADD COLUMN 도 읽습니다.
  // 예전에는 여러 줄 CREATE TABLE 만 읽어서, 나중에 추가된 표의 upsert 식(낚시 횟수 'n = n + 1' 등)의 맨몸 열 이름에
  // 표 이름이 붙지 않았고, Postgres 에서 'column reference "n" is ambiguous' 오류로 낚시 던지기 등이 실패했습니다.
  for (const line of SCHEMA.split('\n')) {
    const one = line.match(/^\s*CREATE TABLE IF NOT EXISTS (\w+) \((.*)\)\s*;?\s*$/);
    if (one && !cols[one[1]]) {
      const t = one[1], defs = [];
      let depth = 0, cur = '';
      for (const ch of one[2]) { if (ch === '(') depth++; else if (ch === ')') depth--; if (ch === ',' && depth === 0) { defs.push(cur.trim()); cur = ''; } else cur += ch; }
      if (cur.trim()) defs.push(cur.trim());
      cols[t] = defs.map(d => (d.match(/^(\w+)\s+[A-Z]/) || [])[1]).filter(c => c && !/^(PRIMARY|UNIQUE|FOREIGN|CHECK)$/.test(c));
      let pk = null;
      const comp = defs.find(d => /^PRIMARY KEY \(/.test(d));
      if (comp) pk = comp.replace(/^PRIMARY KEY \(|\)$/g, '').split(',').map(x => x.trim());
      else for (const d of defs) { const c = d.match(/^(\w+)\s+\w+[^,]*PRIMARY KEY/); if (c) { pk = [c[1]]; if (/AUTOINCREMENT/.test(d)) autoId.add(t); } }
      pks[t] = pk;
    }
    const al = line.match(/ALTER TABLE (\w+) ADD COLUMN (?:IF NOT EXISTS )?(\w+)/);
    if (al && cols[al[1]] && !cols[al[1]].includes(al[2])) cols[al[1]].push(al[2]);
  }
  return { pks, autoId, cols };
}

function toPgSchema(sql) {
  return sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'BIGSERIAL PRIMARY KEY').replace(/\bINTEGER\b/g, 'BIGINT').replace(/\bREAL\b/g, 'DOUBLE PRECISION');
}

// 작은따옴표 문자열 바깥 조각에만 함수를 적용
function outsideQuotes(sql, fn) {
  return sql.split(/('(?:[^']|'')*')/).map((p, i) => (i % 2 ? p : fn(p))).join('');
}

// MAX(a, b) 처럼 쉼표가 있는 호출만 GREATEST / LEAST 로 바꿈
function scalarMinMax(sql) {
  let out = '', i = 0;
  const re = /\b(MAX|MIN)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    let depth = 1, j = re.lastIndex, comma = false, q = false;
    for (; j < sql.length && depth > 0; j++) {
      const ch = sql[j];
      if (q) { if (ch === "'") q = false; continue; }
      if (ch === "'") q = true;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 1) comma = true;
    }
    if (comma) {
      out += sql.slice(i, m.index) + (m[1].toUpperCase() === 'MAX' ? 'GREATEST' : 'LEAST') + '(';
      i = re.lastIndex;
    }
  }
  return out + sql.slice(i);
}

// ON CONFLICT ... DO UPDATE SET a = <식>: 식 안의 맨몸 열 이름은 excluded 와 겹쳐 모호하므로 표 이름을 붙여 줍니다. (왼쪽 a 는 그대로)
function qualifyUpsert(sql, table, colList) {
  const i = sql.search(/DO UPDATE SET/i);
  if (i < 0 || !colList || !colList.length) return sql;
  const head = sql.slice(0, i + 'DO UPDATE SET'.length), rest = sql.slice(i + 'DO UPDATE SET'.length);
  const colRe = new RegExp('(?<![.\\w$])(' + colList.join('|') + ')(?![\\w(])', 'g');
  const parts = []; let depth = 0, cur = '', q = false;
  for (const ch of rest) {
    if (q) { cur += ch; if (ch === "'") q = false; continue; }
    if (ch === "'") { q = true; cur += ch; continue; }
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const out = parts.map(p => {
    const k = p.indexOf('=');
    if (k < 0) return p;
    return p.slice(0, k + 1) + outsideQuotes(p.slice(k + 1), x => x.replace(colRe, table + '.$1'));
  });
  return head + out.join(',');
}

function makeTranslator(SCHEMA) {
  const { pks, autoId, cols } = schemaInfo(SCHEMA);
  const cache = new Map();
  function translate(sql0) {
    if (cache.has(sql0)) return cache.get(sql0);
    let sql = String(sql0).trim().replace(/;\s*$/, '');
    let tail = '';
    const ig = /^INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql), rp = /^INSERT\s+OR\s+REPLACE\s+INTO/i.test(sql);
    if (ig || rp) {
      sql = sql.replace(/^INSERT\s+OR\s+(IGNORE|REPLACE)\s+INTO/i, 'INSERT INTO');
      if (ig) tail = ' ON CONFLICT DO NOTHING';
      else {
        const m = sql.match(/^INSERT INTO (\w+)\s*\(([^)]*)\)/i);
        const pk = m && pks[m[1]];
        if (!m || !pk) throw new Error('unsupported INSERT OR REPLACE: ' + sql0.slice(0, 60));
        const cols = m[2].split(',').map(s => s.trim()).filter(c => !pk.includes(c));
        tail = ' ON CONFLICT (' + pk.join(', ') + ') DO ' + (cols.length ? 'UPDATE SET ' + cols.map(c => c + ' = EXCLUDED.' + c).join(', ') : 'NOTHING');
      }
    }
    sql = sql.replace(/json_extract\(\s*([\w.]+)\s*,\s*'\$\.(\w+)'\s*\)/gi, "(($1)::json->>'$2')::double precision");
    sql = scalarMinMax(sql);
    let n = 0;
    sql = outsideQuotes(sql, p => p.replace(/\bLIKE\b/g, 'ILIKE').replace(/\b(\w+)\.rowid\b/gi, '$1.ctid').replace(/\bAS\s+INTEGER\b/gi, 'AS BIGINT').replace(/\?/g, () => '$' + (++n)));
    sql += tail;
    const up = sql.match(/^INSERT INTO (\w+)/i);
    if (up) sql = qualifyUpsert(sql, up[1], cols[up[1]]);
    // 새로 만든 행의 번호(lastId) 가 필요한 INSERT 는 RETURNING id 를 붙입니다.
    const ins = sql.match(/^INSERT INTO (\w+)/i);
    if (ins && autoId.has(ins[1]) && !/\bRETURNING\b/i.test(sql)) sql += ' RETURNING id';
    cache.set(sql0, sql);
    return sql;
  }
  return { translate, pks, autoId };
}

module.exports = { makeTranslator, toPgSchema, schemaInfo };
