'use strict';
// 서버 동작 점검: node test/smoke.js  (임시 DB를 만들어 사용하며 실제 데이터에는 영향을 주지 않습니다)
const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-'));
process.env.DB_FILE = path.join(tmp, 't.db');
process.env.DATA_DIR = tmp;
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.S_RESULT_DELAY_MS = '1500';
const { start, server, resolveDue } = require('../server');

let base, n = 0;
async function call(method, url, body, jar) {
  const headers = { 'Content-Type': 'application/json' };
  if (jar && jar.sid) headers.Cookie = 'sid=' + jar.sid;
  const r = await fetch(base + url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const sc = r.headers.get('set-cookie');
  if (jar && sc) { const m = /sid=([^;]*)/.exec(sc); jar.sid = m && m[1] ? m[1] : ''; }
  let j = {}; try { j = await r.json(); } catch (_) {}
  return { s: r.status, j };
}
const ok = (name) => console.log('  ✓ ' + name);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function signup(label, extra) {
  const r = await call('POST', '/api/signup', Object.assign({
    name: label, gender: '여성', age: 20, hunterName: label + '헌터', personality: '차분함', traits: ['검술'],
    password: 'Passw0rd!x', image: '',
  }, extra));
  return r;
}

(async () => {
  await start(0);
  base = 'http://127.0.0.1:' + server.address().port;
  console.log('서버 점검 시작', base);

  // 가입 검증
  assert.equal((await signup('a', { password: 'short' })).s, 400); ok('약한 비밀번호 거부');
  assert.equal((await signup('a', { gender: 'x' })).s, 400); ok('잘못된 성별 거부');
  assert.equal((await signup('a', { image: 'data:text/html;base64,AAAA' })).s, 400); ok('이미지가 아닌 파일 거부');
  const a = await signup('에이'); assert.equal(a.s, 201); assert.match(a.j.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/); assert.ok('FEDCBA'.includes(a.j.rank)); ok('가입 → 코드/등급 발급 ' + a.j.code + ' ' + a.j.rank);
  const b = await signup('비'); assert.equal(b.s, 201);

  // 로그인
  const ja = {}, jb = {};
  assert.equal((await call('POST', '/api/login', { code: a.j.code, password: 'wrong' }, {})).s, 401); ok('틀린 비밀번호 거부');
  assert.equal((await call('GET', '/api/me', null, {})).s, 401); ok('로그인 없이 접근 거부');
  assert.equal((await call('POST', '/api/login', { code: a.j.code.replace('-', '').toLowerCase(), password: 'Passw0rd!x' }, ja)).s, 200); ok('로그인(하이픈 없이/소문자도 허용)');
  assert.equal((await call('POST', '/api/login', { code: b.j.code, password: 'Passw0rd!x' }, jb)).s, 200);
  const me = await call('GET', '/api/me', null, ja);
  assert.equal(me.s, 200); assert.equal(me.j.user.lv, 1); assert.equal(me.j.user.code, a.j.code); assert.ok(!('pw_hash' in me.j.user)); ok('내 정보 조회 (비밀번호 정보 미포함)');

  // 몬스터 / 이동 / 토벌
  const st = (await call('GET', '/api/state', null, ja)).j;
  assert.ok(st.monsters.length >= 3); ok('서버가 몬스터를 출몰시킴 (' + st.monsters.length + '마리)');
  const easy = st.monsters.find(m => 'FED'.includes(m.r)) || st.monsters.find(m => 'CB'.includes(m.r));
  const other = G_region_other(easy.region);
  await call('POST', '/api/move', { region: other }, ja);
  assert.equal((await call('POST', '/api/hunt', { id: easy.id }, ja)).j.error, 'wrong_region'); ok('다른 지역에서는 토벌 불가');
  assert.equal((await call('POST', '/api/move', { region: 'nowhere' }, ja)).s, 400); ok('없는 지역 이동 거부');
  await call('POST', '/api/move', { region: easy.region }, ja);
  let result, guard = 0;
  while (guard++ < 40) {
    result = await call('POST', '/api/hunt', { id: easy.id }, ja);
    if (result.j.result === 'success') break;
    assert.equal(result.j.result, 'fail'); assert.ok(result.j.until > Date.now());
    const again = await call('POST', '/api/hunt', { id: easy.id }, ja);
    assert.equal(again.j.error, 'cooldown'); ok('실패 후 재토벌 대기 확인'); break;
  }
  if (result.j.result === 'success') { assert.ok(result.j.gain > 0); ok('토벌 성공 +' + result.j.gain + ' EXP'); assert.equal((await call('POST', '/api/hunt', { id: easy.id }, ja)).j.error, 'already_done'); ok('같은 몬스터 재토벌 거부'); }

  // S급: 3회 도전 제한, 결과는 나중에
  const sm = st.monsters.find(m => m.r === 'S');
  assert.ok(sm, 'S급 몬스터가 있어야 함');
  await call('POST', '/api/move', { region: sm.region }, ja);
  for (let i = 0; i < 3; i++) { const r = await call('POST', '/api/hunt', { id: sm.id }, ja); assert.equal(r.j.result, 'pending'); }
  assert.equal((await call('POST', '/api/hunt', { id: sm.id }, ja)).j.error, 's_limit'); ok('S급 3회 도전 후 제한');
  await call('POST', '/api/move', { region: sm.region }, jb);
  assert.equal((await call('POST', '/api/hunt', { id: sm.id }, jb)).j.result, 'pending');
  let s2 = (await call('GET', '/api/state', null, ja)).j;
  assert.equal(s2.pending.length, 3); assert.equal(s2.results.length, 0);
  assert.equal(s2.monsters.find(m => m.id === sm.id).parts, 2); ok('S급 결과 대기 3건 · 참여 인원 2명(서버 전체)');
  await sleep(1700); resolveDue();
  s2 = (await call('GET', '/api/state', null, ja)).j;
  assert.equal(s2.pending.length, 0); assert.equal(s2.results.length, 3); ok('시간이 지나면 S급 결과 공개 (성공 ' + s2.results.filter(r => r.success).length + '/3)');
  await call('POST', '/api/results/ack', { ids: s2.results.map(r => r.id) }, ja);
  assert.equal((await call('GET', '/api/state', null, ja)).j.results.length, 0); ok('결과 확인 처리');

  // 친구 / 메신저
  assert.equal((await call('POST', '/api/friends', { code: 'ZZZZ-9999' }, ja)).s, 404); ok('없는 코드 친구 추가 거부');
  assert.equal((await call('POST', '/api/friends', { code: a.j.code }, ja)).j.error, 'self'); ok('내 코드 추가 거부');
  const fr = await call('POST', '/api/friends', { code: b.j.code }, ja); assert.equal(fr.s, 201); assert.equal(fr.j.friend.hn, '비헌터'); ok('코드로 친구 추가');
  assert.equal((await call('POST', '/api/friends', { code: b.j.code }, ja)).j.error, 'already'); ok('중복 추가 거부');
  assert.equal((await call('GET', '/api/friends', null, jb)).j.friends.length, 1); ok('상대 목록에도 표시');
  assert.equal((await call('POST', '/api/messages', { to: b.j.code, text: '안녕' }, ja)).s, 201);
  assert.equal((await call('GET', '/api/state', null, jb)).j.unreadMsgs, 1);
  const got = await call('GET', '/api/messages?with=' + a.j.code, null, jb); assert.equal(got.j.messages.length, 1); assert.equal(got.j.messages[0].me, false); ok('메시지가 상대에게 전달됨');
  assert.equal((await call('GET', '/api/state', null, jb)).j.unreadMsgs, 0); ok('읽음 처리');
  const c = await signup('씨'); const jc = {}; await call('POST', '/api/login', { code: c.j.code, password: 'Passw0rd!x' }, jc);
  assert.equal((await call('POST', '/api/messages', { to: a.j.code, text: '친구 아님' }, jc)).s, 404); ok('친구가 아니면 메시지 거부');

  // 관리자 알림
  assert.equal((await call('POST', '/api/admin/notice', { text: 'x' }, {})).s, 401); ok('관리자 토큰 없이 알림 거부');
  const nr = await fetch(base + '/api/admin/notice', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-admin-token' }, body: JSON.stringify({ text: '점검 안내입니다.' }) });
  assert.equal(nr.status, 201);
  assert.equal((await call('GET', '/api/state', null, jc)).j.unreadNotices, 1);
  assert.equal((await call('GET', '/api/notices', null, jc)).j.notices[0].text, '점검 안내입니다.'); ok('관리자 알림이 모든 헌터에게 전달됨');
  await call('POST', '/api/notices/seen', {}, jc);
  assert.equal((await call('GET', '/api/state', null, jc)).j.unreadNotices, 0); ok('알림 읽음 처리');

  // 외부 사이트 요청 차단 / 로그아웃
  const evil = await fetch(base + '/api/move', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Cookie: 'sid=' + ja.sid }, body: '{"region":"city"}' });
  assert.equal(evil.status, 403); ok('다른 사이트에서 온 요청 차단');
  await call('POST', '/api/logout', {}, ja);
  assert.equal((await call('GET', '/api/me', null, ja)).s, 401); ok('로그아웃');
  const home = await fetch(base + '/'); assert.equal(home.status, 200); ok('게임 화면 제공');
  const trav = await fetch(base + '/..%2Fserver.js'); assert.notEqual(trav.status, 200); ok('폴더 밖 파일 접근 차단');

  console.log('모든 점검 통과');
  process.exit(0);
})().catch(e => { console.error('실패:', e); process.exit(1); });

function G_region_other(r) { return ['city', 'mine', 'river', 'temple', 'port', 'gate'].find(x => x !== r); }
