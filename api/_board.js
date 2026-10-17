'use strict';
// 헌터 커뮤니티 글 생성기 (시민들이 올리는 글).
// 외부 AI 호출 없이, 서버 안에서 시민 인물(아이디·성격·말투)과 글감을 조합해 만듭니다.
// 글쓰기/댓글 기능은 없고, 이 파일이 만든 글을 읽기만 합니다.
const crypto = require('crypto');
const rnd = (a, b) => crypto.randomInt(a, b + 1);
const pick = arr => arr[rnd(0, arr.length - 1)];
const chance = p => crypto.randomInt(0, 1000000) < p * 1000000;

// ── 시민 인물 ──
// 말투마다 해요체(p)/평서체(f) 중 하나를 쓰고, 앞뒤에 붙는 말버릇이 다릅니다. (특정 커뮤니티식 유행어는 쓰지 않음)
const STYLES = {
  formal:  { reg: 'p', intro: ['안녕하세요. ', '', '공유드립니다. '], outro: [' 참고하시기 바랍니다.', ' 다들 안전하세요.', ' 이상입니다.'] },
  worrier: { reg: 'p', intro: ['저만 무서운 건가요 ㅠㅠ ', '', '방금 알림 보고 놀라서 씁니다. '], outro: [' 어떡하죠...', ' 다들 무사하셨으면 좋겠어요.', ' 불안해서 잠이 안 와요.'] },
  cynic:   { reg: 'f', intro: ['또 이 소리. ', '', '뭐, 늘 그렇지만. '], outro: [' 어차피 우리 몫은 아니겠지.', ' 뉴스에서나 크게 다루겠지.', ' 그러려니 한다.'] },
  elder:   { reg: 'f', intro: ['내가 젊을 때는 말이야, ', '', '요즘 세상 참. '], outro: [' 조심들 하시게.', ' 허허, 세상이 이렇다네.', ' 다들 몸조심하게나.'] },
  student: { reg: 'p', intro: ['헐 ', '', '진짜로요 '], outro: [' ㅋㅋ', ' 시험 기간인데 큰일이네요.', ' 학교 가는 길이 걱정이에요.'] },
  office:  { reg: 'p', intro: ['퇴근길에 봤는데요. ', '', '점심 먹다가 알았어요. '], outro: [' 야근보다 무섭네요.', ' 내일 출근할 수 있으려나요.', ' 오늘도 고생하셨습니다.'] },
  geek:    { reg: 'f', intro: ['정리해봄. ', '', '기록 기준으로 보면 '], outro: [' 패턴이 있어 보임.', ' 확실하진 않음.', ' 틀리면 지적 바람.'] },
  emoji:   { reg: 'p', intro: ['ㅎㅎ ', '', '안녕하세요~ '], outro: [' ^^', ' 다들 화이팅이에요 :)', ' 좋은 하루 되세요~'] },
  curt:    { reg: 'f', intro: ['', '참고. ', '방금 본 거. '], outro: ['', ' 이상.', ' 끝.'] },
  parent:  { reg: 'p', intro: ['우리 동네 얘기인데요, ', '', '아이 학교 보내고 왔는데요, '], outro: [' 모두 조심하세요.', ' 아이들 걱정이에요.', ' 헌터분들 고생이 많으시죠.'] },
};
const STYLE_KEYS = Object.keys(STYLES);

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function buildPool() {
  const r = mulberry(20261017), P = n => Math.floor(r() * n), L = 'abcdefghijklmnopqrstuvwxyz';
  const kb = ['asdf', 'qwer', 'zxcv', 'qazwsx', 'poiuy', 'lkjh', 'wasd', 'zzxx'];
  const wd = ['hunter', 'moon', 'night', 'storm', 'rain', 'blue', 'coffee', 'sky', 'fox', 'pine'];
  const nick = ['퇴근하고싶다', '밤샘알바생', '동네주민', '우산파는사람', '버스기사김씨', '편의점야간', '붕어빵장수', '새벽배달러', '옥상고양이', '수학쌤', '자취생', '지나가던사람'];
  const out = [], used = new Set();
  while (out.length < 42) {
    let id; const k = P(10);
    if (k < 3) { id = ''; for (let i = 0, n = 3 + P(4); i < n; i++) id += L[P(26)]; id += String(P(1000)); }
    else if (k < 5) id = kb[P(kb.length)] + (P(2) ? String(P(100)) : '');
    else if (k < 7) id = wd[P(wd.length)] + String(P(10000));
    else if (k < 8) { id = ''; for (let i = 0, n = 4 + P(3); i < n; i++) id += L[P(26)]; }
    else id = nick[P(nick.length)];
    if (used.has(id)) continue;
    used.add(id); out.push({ id, style: STYLE_KEYS[P(STYLE_KEYS.length)] });
  }
  return out;
}
const POOL = buildPool();
function author() {
  if (chance(0.15)) return { id: '익명', style: pick(STYLE_KEYS) };      // 익명 글은 말투도 그때그때 다름
  return pick(POOL);
}

// ── 글감: [제목, 평서체 본문, 해요체 본문] ──
const T = {
  mon: [
    ['{place}에 {mon} 나왔다던데', '{place} 쪽에서 {mon}이(가) 나왔다고 한다. {rank}급이라는데 근처 사는 사람들은 일단 밖에 안 나가는 게 좋겠다.', '{place} 쪽에서 {mon}이(가) 출몰했다고 합니다. {rank}급이라고 하니 근처 분들은 외출을 자제하시는 게 좋겠어요.'],
    ['{mon} 목격담', '어제 {place}에서 {mon} 지나가는 걸 봤다는 사람이 있다. 사진은 없고 말만 도는 중이다.', '어제 {place}에서 {mon}을(를) 봤다는 분이 계세요. 사진은 없고 말만 돌고 있습니다.'],
    ['{place} 근처 통제선', '{place} 일대에 통제선이 쳐졌다. 알아보니 {mon} 때문이라고 한다. 우회해서 다니는 게 맞다.', '{place} 일대에 통제선이 설치됐어요. 알아보니 {mon} 때문이라고 합니다. 우회해서 다니세요.'],
    ['{rank}급 {mon}은(는) 어느 정도인가요', '{mon}이(가) {place}에 떴다는데 {rank}급이면 어느 정도인지 감이 안 온다. 아는 사람 있으면 알려 달라.', '{mon}이(가) {place}에 떴다는데 {rank}급이면 어느 정도인지 감이 안 와요. 아시는 분 계신가요?'],
    ['{place} 쪽으로 헌터들 이동 중', '{place} 쪽으로 헌터들이 줄지어 가는 걸 봤다. {mon} 때문인 것 같다. 별일 없길 바란다.', '{place} 쪽으로 헌터분들이 줄지어 가는 걸 봤어요. {mon} 때문인 것 같아요. 별일 없길 바랍니다.'],
    ['알림 또 울렸네', '방금 {mon} 출몰 알림이 울렸다. 장소는 {place}, 등급은 {rank}. 이제 알림음만 들어도 익숙하다.', '방금 {mon} 출몰 알림이 울렸어요. 장소는 {place}, 등급은 {rank}입니다. 이제 알림음에도 익숙해졌네요.'],
  ],
  sOn: [
    ['S급 {mon} 출몰', '{place}에 S급 {mon}이(가) 출몰했다. 이쯤 되면 나라 전체가 긴장해야 한다.', '{place}에 S급 {mon}이(가) 출몰했다고 합니다. 이 정도면 나라 전체가 긴장해야 해요.'],
    ['{place} S급 속보', '속보다. {place}에서 {mon}이(가) 확인됐다. 협회는 아직 공식 입장이 없다.', '속보예요. {place}에서 {mon}이(가) 확인됐습니다. 협회는 아직 공식 입장이 없어요.'],
    ['{mon}, 누가 잡을 수 있을까', '{mon}이(가) {place}에 나타났다. 솔직히 지금 활동하는 헌터들로 가능할지 모르겠다.', '{mon}이(가) {place}에 나타났대요. 솔직히 지금 활동하는 헌터분들로 가능할지 모르겠어요.'],
    ['S급이 떴는데 거리는 평소 같네요', 'S급 {mon}이(가) {place}에 떴다는데 우리 동네 거리는 평소와 똑같다. 이게 더 이상하다.', 'S급 {mon}이(가) {place}에 떴다는데 우리 동네 거리는 평소와 똑같아요. 그게 더 이상해요.'],
    ['{place} 대피 안내 소문', '{place}에서 {mon} 때문에 대피 안내가 나왔다는 얘기가 돈다. 확인된 건 아니다.', '{place}에서 {mon} 때문에 대피 안내가 나왔다는 얘기가 돌아요. 확인된 건 아니에요.'],
    ['{mon} 현재까지 정보 정리', '지금까지 알려진 것만 정리한다. 몬스터 {mon}, 위치 {place}, 등급 S. 토벌 여부는 아직 모른다. 확인되는 대로 추가하겠다.', '지금까지 알려진 것만 정리해 드려요. 몬스터는 {mon}, 위치는 {place}, 등급은 S입니다. 토벌 여부는 아직 몰라요. 확인되는 대로 추가할게요.'],
    ['하늘이 붉게 물들었다는데', '{place} 쪽 하늘이 붉게 물들었다고 한다. {mon} 출몰과 관련 있다는 얘기가 있다.', '{place} 쪽 하늘이 붉게 물들었다고 해요. {mon} 출몰과 관련 있다는 얘기가 있어요.'],
  ],
  sKill: [
    ['{mon} 토벌 성공 소식', '{mon} 토벌에 성공했다는 소식이다. {place} 사람들은 한숨 돌렸을 것이다.', '{mon} 토벌에 성공했다는 소식이에요. {place} 분들은 한숨 돌리셨겠어요.'],
    ['드디어 {mon} 잡았다고 합니다', '{mon}이(가) 쓰러졌다고 한다. 누가 마지막 일격을 넣었는지는 모르겠지만 일단 고맙다.', '{mon}이(가) 쓰러졌다고 해요. 누가 마지막 일격을 넣었는지는 몰라도 일단 감사합니다.'],
  ],
  sFled: [
    ['{mon} 사라졌다는데', '{place}에 있던 {mon}이(가) 사라졌다고 한다. 토벌된 건지 물러간 건지 알 수 없어서 찜찜하다.', '{place}에 있던 {mon}이(가) 사라졌다고 해요. 토벌된 건지 물러간 건지 알 수 없어서 찜찜합니다.'],
    ['{mon} 도주 소식', '{mon}이(가) 도주했다는 얘기가 있다. 다시 나타날 수 있다고 하니 방심하기엔 이르다.', '{mon}이(가) 도주했다는 얘기가 있어요. 다시 나타날 수 있다고 하니 방심하기엔 일러요.'],
  ],
  crit: [
    ['헌터 보상 체계 문제 있다', '고등급에게만 몰아주는 구조다. 현장에서 목숨 거는 저등급 헌터는 푼돈을 받는다. 구조를 바꿔야 한다.', '고등급 헌터에게만 몰아주는 구조인 것 같아요. 현장에서 목숨 거는 저등급 헌터분들은 푼돈을 받는다는데, 바뀌어야 하지 않을까요.'],
    ['복구 비용은 누가 내나', '몬스터가 지나간 자리의 복구비는 결국 주민 세금이다. 협회는 책임을 지지 않는다.', '몬스터가 지나간 자리의 복구비는 결국 주민 세금이잖아요. 협회는 책임을 안 지는 것 같아 답답합니다.'],
    ['등급 심사는 투명한가', '승급 기준이 공개되지 않는다. 누구는 금방 오르고 누구는 제자리다. 의심이 드는 건 당연하다.', '승급 기준이 공개되지 않아요. 누구는 금방 오르고 누구는 제자리라는데, 의심이 드는 게 당연하지 않나요.'],
    ['헌터가 연예인이 된 세상', '헌터가 연예인처럼 소비되는 게 이상하다. 일은 일일 뿐인데 팬덤부터 생겼다.', '헌터분들이 연예인처럼 소비되는 게 이상해요. 일은 일일 뿐인데 팬덤부터 생겼잖아요.'],
    ['피해 신고 접수해 본 후기', '피해 신고 접수에 일주일이 걸렸다. 서류만 세 종류. 헌터 사회가 시민을 어떻게 보는지 알 것 같다.', '피해 신고 접수에 일주일이 걸렸어요. 서류만 세 종류였고요. 헌터 사회가 시민을 어떻게 보는지 알 것 같았습니다.'],
    ['저등급 헌터 처우', '저등급 헌터는 위험수당도 없이 현장에 투입된다. 이런 구조에서 누가 오래 버티겠나.', '저등급 헌터분들은 위험수당도 없이 현장에 투입된다고 해요. 이런 구조에서 누가 오래 버틸 수 있을까요.'],
  ],
  praiseOne: [
    ['{hn} 헌터 대단하다', '{hn} 헌터 활약상을 들었다. {rank}급이라는 이름값이 아깝지 않다.', '{hn} 헌터님 활약상을 들었어요. {rank}급이라는 이름값이 아깝지 않네요.'],
    ['{hn} 헌터 팬이 됐다', '우연히 {hn} 헌터 이야기를 읽었는데 믿음이 간다. 이런 사람이 있어서 다행이다.', '우연히 {hn} 헌터님 이야기를 읽었는데 믿음이 가요. 이런 분이 계셔서 다행이에요.'],
    ['{hn} 헌터가 나타나면 분위기가 달라진다', '{hn} 헌터가 현장에 나타나면 분위기가 달라진다고 들었다. 그만한 사람이라는 뜻일 것이다.', '{hn} 헌터님이 현장에 나타나면 분위기가 달라진대요. 그만한 분이라는 뜻이겠죠.'],
  ],
  praiseAll: [
    ['S급 헌터분들께 감사', 'S급 헌터들 덕분에 우리가 발 뻗고 잔다. 말로만이라도 고맙다고 하고 싶다.', 'S급 헌터분들 덕분에 저희가 발 뻗고 자요. 말로만이라도 고맙다고 하고 싶어요.'],
    ['S급은 다른 세계 사람 같다', 'S급 헌터는 같은 사람이라는 생각이 안 든다. 그래서 더 의지가 된다.', 'S급 헌터분들은 같은 사람이라는 생각이 잘 안 들어요. 그래서 더 의지가 됩니다.'],
    ['S급이 있는 한 괜찮다', 'S급 헌터들이 있는 한 이 나라는 괜찮을 것이다. 근거는 없지만 그렇게 믿고 싶다.', 'S급 헌터분들이 계시는 한 괜찮을 거라고 믿어요. 근거는 없지만 그렇게 믿고 싶어요.'],
  ],
  idle: [
    ['오늘 아침 메뉴', '오늘 아침은 토스트와 우유. 별거 없지만 이렇게 평범한 날이 좋다.', '오늘 아침은 토스트와 우유예요. 별거 없지만 이렇게 평범한 날이 좋네요.'],
    ['방금 일어남', '방금 일어났다. 알림이 쌓여 있는데 일단 커피부터.', '방금 일어났어요. 알림이 쌓여 있는데 일단 커피부터 마시려고요.'],
    ['잠들기 전 한마디', '이제 잔다. 밤 사이에 아무 일도 없길.', '이제 자려고요. 밤사이에 아무 일도 없었으면 좋겠어요.'],
    ['점심 뭐 먹을지 추천 좀', '점심 메뉴를 못 정하고 있다. 국물 있는 걸 먹고 싶은데 추천 부탁한다.', '점심 메뉴를 못 정하고 있어요. 국물 있는 게 당기는데 추천 부탁드려요.'],
    ['비 오는 날', '비가 온다. 이런 날은 몬스터도 쉬었으면 좋겠다.', '비가 오네요. 이런 날은 몬스터도 쉬었으면 좋겠어요.'],
    ['퇴근했다', '퇴근했다. 오늘은 아무것도 하고 싶지 않다.', '퇴근했어요. 오늘은 아무것도 하고 싶지 않네요.'],
    ['산책하다가 고양이 봄', '산책하다가 고양이를 만났다. 한참 쳐다보더니 가버렸다. 이상하게 위로가 됐다.', '산책하다가 고양이를 만났어요. 한참 쳐다보더니 가버렸는데 이상하게 위로가 됐어요.'],
  ],
  fame: [
    ['{hn} 헌터 요즘 자주 보인다', '{hn} 헌터 이름을 요즘 어디서나 듣는다. {rank}급 헌터가 이렇게 화제가 되는 건 드문 일이다.', '{hn} 헌터님 이름을 요즘 어디서나 들어요. {rank}급 헌터가 이렇게 화제가 되는 건 드문 일이에요.'],
    ['{hn} 헌터 평판 정리', '{hn} 헌터에 대한 평판을 모아 봤다. 칭찬이 대부분이고 아쉬운 소리는 거의 없다. {rank}급이다.', '{hn} 헌터님에 대한 평판을 모아 봤어요. 칭찬이 대부분이고 아쉬운 소리는 거의 없네요. {rank}급이세요.'],
    ['{hn} 헌터 보셨나요', '{hn} 헌터를 직접 봤다는 사람이 늘고 있다. 소문이 사실이라면 이름값을 하는 사람이다.', '{hn} 헌터님을 직접 봤다는 분이 늘고 있어요. 소문이 사실이라면 이름값을 하시는 분이에요.'],
    ['{hn} 헌터가 궁금하다', '{hn} 헌터는 어떤 사람일까. 활약상은 많이 들었는데 정작 아는 건 별로 없다.', '{hn} 헌터님은 어떤 분일까요. 활약상은 많이 들었는데 정작 아는 건 별로 없어요.'],
  ],
  rank: [
    ['{hn} 헌터 {new}급 승급했다더라', '{hn} 헌터가 {old}급에서 {new}급으로 올랐다고 한다. 꾸준히 하면 되긴 되는구나 싶다.', '{hn} 헌터님이 {old}급에서 {new}급으로 오르셨대요. 꾸준히 하면 되는구나 싶어요.'],
    ['{new}급 승급 소식', '{hn} 헌터의 {new}급 승급 소식이 돌고 있다. 축하할 일이다.', '{hn} 헌터님의 {new}급 승급 소식이 돌고 있어요. 축하드립니다.'],
    ['{hn} 헌터 승급 축하', '{hn} 헌터, {old}급에서 {new}급으로 승급. 다음 목표는 뭘까 궁금하다.', '{hn} 헌터님, {old}급에서 {new}급으로 승급하셨네요. 다음 목표가 궁금해요.'],
  ],
  rankS: [
    ['새로운 S급 헌터 탄생', '{hn} 헌터가 S급에 올랐다고 한다. 이제 이 사람 이름이 뉴스에 자주 나오겠다.', '{hn} 헌터님이 S급에 오르셨다고 해요. 이제 이름을 뉴스에서 자주 보게 되겠네요.'],
    ['{hn} 헌터 S급 승급', '{hn} 헌터가 {old}급에서 S급까지 올라왔다. 솔직히 놀랍다.', '{hn} 헌터님이 {old}급에서 S급까지 올라오셨어요. 솔직히 놀랍습니다.'],
  ],
};

// 받침에 따라 조사를 고릅니다: 이(가) 은(는) 을(를)
const JOSA = { '이(가)': ['이', '가'], '은(는)': ['은', '는'], '을(를)': ['을', '를'] };
const josa = s => s.replace(/(.)(이\(가\)|은\(는\)|을\(를\))/g, (m, c, j) => {
  const k = c.charCodeAt(0);
  return c + JOSA[j][k >= 0xAC00 && k <= 0xD7A3 && (k - 0xAC00) % 28 !== 0 ? 0 : 1];
});
const fill = (s, v) => josa(s.replace(/\{(\w+)\}/g, (_, k) => (v[k] === undefined ? '' : v[k])));
function compose(tpl, v, st) {
  const S = STYLES[st], i = S.reg === 'p' ? 2 : 1;
  return { title: fill(tpl[0], v), body: (pick(S.intro) + fill(tpl[i], v) + pick(S.outro)).trim() };
}
const RANK_W = ['F', 'F', 'E', 'E', 'D', 'D', 'C', 'B', 'A'];

// 이름이 겹치지 않도록, 몬스터 목록을 받아 글감 선택
// ctx: { mons:{F:[..],...}, regions:[long names], sOn:[{name,place}], sKill:[..], sFled:[..], sUsers:[{hn,rank,fame}], fame:[{hn,rank,fame}] }
function weightedByFame(list) {
  const w = list.map(u => Math.max(1, u.fame || 0)), sum = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}
function pickKind(ctx) {
  const r = Math.random();
  if (r < 0.30) return 'mon';
  if (r < 0.70) return 'sOn';
  if (r < 0.80) return 'crit';
  if (r < 0.85) return 'praise';
  if (r < 0.90) return 'idle';
  return 'fame';                                      // 나머지 10%: 명성이 높은 헌터가 화제에 오르는 글
}
function makePost(ctx) {
  const a = author();
  let kind = pickKind(ctx), v = {}, tag, tpl;
  if (kind === 'sOn') {
    const pool = [];
    ctx.sOn.forEach(x => { for (let i = 0; i < 4; i++) pool.push(['on', x]); });
    ctx.sKill.forEach(x => pool.push(['kill', x]));
    ctx.sFled.forEach(x => pool.push(['fled', x]));
    if (!pool.length) kind = 'mon';
    else {
      const [k, x] = pick(pool);
      v = { mon: x.name, place: x.place }; tag = 'S급';
      tpl = pick(k === 'on' ? T.sOn : k === 'kill' ? T.sKill : T.sFled);
    }
  }
  if (kind === 'mon') {
    const rk = pick(RANK_W);
    v = { rank: rk, mon: pick(ctx.mons[rk]), place: pick(ctx.regions) }; tag = '몬스터'; tpl = pick(T.mon);
  } else if (kind === 'crit') { tag = '사회'; tpl = pick(T.crit); }
  else if (kind === 'idle') { tag = '잡담'; tpl = pick(T.idle); }
  else if (kind === 'fame') {
    if (ctx.fame.length) { const u = weightedByFame(ctx.fame); v = { hn: u.hn, rank: u.rank }; tag = '화제'; tpl = pick(T.fame); }
    else { tag = '잡담'; tpl = pick(T.idle); }
  } else if (kind === 'praise') {
    tag = '칭찬';
    if (ctx.sUsers.length && chance(0.5)) { const u = weightedByFame(ctx.sUsers); v = { hn: u.hn, rank: u.rank }; tpl = pick(T.praiseOne); }
    else tpl = pick(T.praiseAll);
  }
  const c = compose(tpl, v, a.style);
  return { who: a.id, title: c.title, body: c.body, tag };
}
function makeRankPost(hn, oldR, newR) {
  const a = author(), v = { hn, old: oldR, new: newR };
  const c = compose(pick(newR === 'S' ? T.rankS : T.rank), v, a.style);
  return { who: a.id, title: c.title, body: c.body, tag: '승급' };
}

module.exports = { makePost, makeRankPost, POOL, STYLES };
