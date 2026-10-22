'use strict';
// ═══════════════════════════════════════════════════════════════════════
//  [EVENT:HALLOWEEN] 할로윈 이벤트 — 이 파일 하나에 이벤트 내용이 모여 있습니다.
//
//  ■ 끄는 법 (기존 서버처럼 돌리기)
//    1) 관리자 페이지 → '할로윈 이벤트' 카드에서 [끄기] 를 누르면 즉시 꺼집니다. (코드 수정 없음)
//    2) '자동' 상태이면 아래 START ~ END 기간에만 켜지고, END 가 지나면 저절로 꺼집니다.
//    꺼지면: 백귀야행 몬스터가 더 나오지 않고(남은 잡귀는 청소), 소원 앱과 이벤트 소문이 사라지고,
//            가면 조합이 막힙니다. 이미 만든 가면은 그대로 가지고 착용할 수 있습니다.
//
//  ■ 아예 코드에서 지우고 싶다면
//    - 이 파일과, 다른 파일에서 'EVENT:HALLOWEEN' 으로 검색되는 부분(약 15곳)을 지우면 됩니다.
//    - DB 의 ev_wish 표는 비어 있어도 괜찮습니다. 이미 지급된 '도깨비 불씨'·가면·업적은 기념품으로 남습니다.
//
//  ■ 내용
//    ① 백귀야행   : 밤(20시~02시)에 헌터마다 약한 '잡귀' 몬스터가 여러 마리 나오고, 처치하면 도깨비 불씨를 줍니다.
//    ② 소원       : 하루 한 번, 귀신이 찾는 재료 3가지를 모아 건네면 보상. 5일 연속이면 업적(칭호).
//    ③ 가면 장비  : 도깨비 불씨 + 재료로 가면(얼굴 부위 장비)을 조합. 이벤트 기간에만 조합 가능.
//    ④ 혼령 소문  : 괴담 앱에 이벤트 소문이 섞여 나오고, 소문이 사실이면 믿은 사람에게 불씨를 더 줍니다.
//    ⑤ 백귀 도감  : 잡귀 32종(흔한 12 · 보기 드문 12 · 희귀 8)을 모으면 단계별로 불씨, 마지막엔 칭호.
//    ⑥ 사연       : 소원 주인이 8일 동안 날마다 바뀌고, 들어줄 때마다 처녀귀신의 사연 한 조각이 열립니다. (모두 모으면 칭호)
//    ⑦ 도깨비 장터: 도깨비 불씨로 사는 한정 품목(재료·정화 소금·가면 재료 꾸러미 등). 품목마다 구매 한도가 있습니다.
//    ⑧ 귀신의 집  : 친구와 둘이서 방 5개를 지나가며 불씨를 얻습니다. 하루 2회, 진행 상태는 ev_house 에 잠깐만 저장됩니다.
// ═══════════════════════════════════════════════════════════════════════

const HOUR = 3600000, MIN = 60000;

// ── 기간 (한국 시간) ──
const START = Date.parse('2026-10-22T00:00:00+09:00');     // '자동' 상태일 때 이 시각부터 켜짐
const END = Date.parse('2026-11-06T18:00:00+09:00');       // '자동' 상태일 때 이 시각에 꺼짐

// ── 백귀야행 ──
const EMBER = '도깨비 불씨';
// 잡귀 32종: 흔한 12종(60%) · 보기 드문 12종(32%) · 희귀한 8종(8%, 불씨를 더 줌). 도감(백귀 도감)에 모입니다.
const GH_C = ['떠돌이 잡귀', '굶주린 아귀', '도깨비불', '달걀귀신', '몽달귀신', '손각시', '야광귀', '빗자루 도깨비', '객귀', '수살귀', '문지방 귀신', '바람 귀신'];
const GH_U = ['장독대 귀신', '부지깽이 도깨비', '짚신 도깨비', '맷돌 도깨비', '서낭당 귀신', '아궁이 귀신', '뒷간 귀신', '빗소리 귀신', '연못 귀신', '허수아비 귀신', '떠돌이 장승', '방울 소리 귀신'];
const GH_R = ['어둑시니', '두억시니', '화묘', '떠돌이 상여꾼', '빈 사당 혼령', '낡은 인형 혼', '거울 속 그림자', '등롱 귀신'];
const GHOSTS = GH_C.concat(GH_U, GH_R);
const GHOST_SET = new Set(GHOSTS);
const GHOST_TIER = {}; GH_C.forEach(n => { GHOST_TIER[n] = 'c'; }); GH_U.forEach(n => { GHOST_TIER[n] = 'u'; }); GH_R.forEach(n => { GHOST_TIER[n] = 'r'; });
const GHOST_EMBER_BY = { c: [1, 2], u: [1, 2], r: [3, 4] };
const TIER_LABEL = { c: '흔한 잡귀', u: '보기 드문 잡귀', r: '희귀한 잡귀' };
const pickGhost = () => { const r = Math.random(), a = r < 0.6 ? GH_C : r < 0.92 ? GH_U : GH_R; return a[Math.floor(Math.random() * a.length)]; };
// 도감 달성 보상: [필요한 종류 수, 불씨]. 마지막 단계는 칭호도 함께 줍니다.
const DEX_STAGES = [[8, 10], [16, 20], [24, 40], [32, 70]];
const DEX_ACH = { id: 'ev_hlw_dex', name: '백귀 수집가', descr: '할로윈 밤, 백귀야행의 잡귀 32종을 모두 처치해 도감을 채웠다.' };
const NIGHT_FROM = 20, NIGHT_TO = 2;                        // 한국 시간 20시 ~ 다음날 02시
const GHOST_GAP = [6, 12];                                   // 몇 분마다 한 무리가 나오는가
const GHOST_BATCH = [2, 3];                                  // 한 무리의 마리 수
const GHOST_CAP = 10;                                        // 헌터 한 명에게 동시에 떠 있는 잡귀 수 상한

// ── 소원 ──
const WISH_EMBER = 6, WISH_STREAK = 7, WISH_STREAK_EMBER = 20;
const WISH_ACH = { id: 'ev_hlw_wish', name: '처녀귀신의 벗', descr: '할로윈 밤, 처녀귀신의 사연을 따라가며 소원을 7일 연속으로 들어주었다.' };
// 8일 동안 매일 다른 귀신이 소원을 말하고, 소원을 들어주면 그 귀신이 들려주는 '사연 한 조각'이 열립니다. 마지막 날은 완결편입니다.
const STORY = [
  { who: '우물가의 물귀신', say: '우물 속에 떨어진 물건을 다시 만들고 싶어요. 재료를 구해 주시겠어요?',
    text: '이 마을에는 혼례를 하루 앞둔 신부가 있었다고 합니다. 그날 밤 그녀는 우물가에서 신랑에게 받은 노리개를 떨어뜨렸지요. 달이 붉게 물든 밤이었습니다.' },
  { who: '부엌의 아궁이 귀신', say: '혼례 상을 차리던 불이 아직 꺼지지 않았어요. 불씨를 살릴 재료가 필요합니다.',
    text: '혼례 상을 차리던 부엌은 밤새 불이 꺼지지 않았습니다. 신부는 노리개가 없어졌다는 것을 숨긴 채, 새벽까지 웃기만 했다고 해요.' },
  { who: '댕기 가게의 객귀', say: '손님이 두고 간 댕기를 다시 엮어야 해요. 이 재료들을 구해 주시겠어요?',
    text: '혼례 전날 아침, 신부는 댕기 가게에 들러 말했습니다. "그이가 준 것을 잃어버렸으니, 이대로는 시집을 갈 수 없어요." 가게 주인은 그 말을 오래 잊지 못했다고 합니다.' },
  { who: '마을 어귀의 장승', say: '비바람에 쓰러진 몸을 다시 세우고 싶소. 재료를 좀 구해 주시오.',
    text: '신랑은 노리개와 똑같은 것을 구해 오겠다며 말을 타고 먼 길을 떠났습니다. 신부는 장승 곁에 서서 며칠이고 그를 기다렸습니다.' },
  { who: '서낭당의 귀신', say: '서낭당 앞에 올릴 것이 모자랍니다. 재료를 가져다주겠습니까?',
    text: '비바람이 몰아치던 밤에도 신랑은 돌아오지 않았습니다. 신부는 서낭당 앞에서 밤새 두 손을 모으고 있었다고 합니다.' },
  { who: '빈 사당의 혼령', say: '오래 비워 둔 사당에 향을 올리고 싶습니다. 필요한 재료를 구해 주십시오.',
    text: '마을 사람들은 신랑이 먼 곳에서 길을 잃었을 거라고 수군거렸습니다. 신부는 끝내 혼례복을 벗지 않았습니다.' },
  { who: '달밤의 나그네 혼', say: '길을 가다 신발이 닳았소. 새로 만들 재료를 구해 줄 수 있겠소?',
    text: '지나가던 나그네가 전한 말이 있습니다. 신랑은 새 노리개를 품에 안고 돌아오던 길이었지만, 강물이 불어 끝내 건너지 못했다고요.' },
  { who: '소복 입은 처녀귀신', say: '마지막 부탁이에요. 제가 길을 떠나기 전에 필요한 것들을 구해 주시겠어요?',
    text: '당신 덕분에 노리개를 찾았어요. 우물 바닥에서 반짝이던 그것은 그이가 처음 쥐여 준 것이었죠. 이제야 혼례복을 벗고, 그이가 기다리는 강가로 가려 합니다. 붉은 달이 지기 전에 — 고마워요.' },
];
const STORY_ACH = { id: 'ev_hlw_story', name: '신부의 노리개', descr: '할로윈 밤, 여덟 귀신의 사연 조각을 모두 모아 처녀귀신의 이야기를 끝까지 들었다.' };
const STORY_ALL_EMBER = 40, FINAL_DAY_EMBER = 10;
const STORY_FIRST = Date.parse('2026-10-22T00:00:00Z');       // 사연 첫째 날(한국 날짜 10월 22일)
const storyIdx = day => { const n = Math.floor((Date.parse(day + 'T00:00:00Z') - STORY_FIRST) / (24 * HOUR)); return ((n % STORY.length) + STORY.length) % STORY.length; };

// ── 도깨비 장터: 도깨비 불씨로 사는 한정 품목. limit 은 한 사람이 이벤트 동안 살 수 있는 횟수 ──
const MARKET = [
  { id: 'salt', name: '정화의 소금', desc: '오염도 -15 (바로 적용)', price: 20, limit: 5, fx: { taint: -15 } },
  { id: 'gold', name: '도깨비 금화 주머니', desc: '골드 300 G', price: 20, limit: 5, fx: { gold: 300 } },
  { id: 'dew', name: '구름 이슬 2개', desc: '재료', price: 15, limit: 5, give: { '구름 이슬': 2 } },
  { id: 'key', name: '오래된 열쇠', desc: '재료', price: 30, limit: 3, give: { '오래된 열쇠': 1 } },
  { id: 'crystal', name: '수정 파편', desc: '재료', price: 30, limit: 3, give: { '수정 파편': 1 } },
  { id: 'clover', name: '네잎 클로버', desc: '재료', price: 40, limit: 3, give: { '네잎 클로버': 1 } },
  { id: 'pearl', name: '진주', desc: '재료', price: 40, limit: 3, give: { '진주': 1 } },
  { id: 'ruby', name: '적월석 가루', desc: '재료 (매우 귀함)', price: 70, limit: 2, give: { '적월석 가루': 1 } },
  { id: 'b1', name: '도깨비 가면 재료 꾸러미', desc: '나뭇가지 4 · 낡은 천조각 3', price: 15, limit: 1, give: { '나뭇가지': 4, '낡은 천조각': 3 } },
  { id: 'b2', name: '해태 가면 재료 꾸러미', desc: '소금 3 · 짐승의 뼈 3', price: 15, limit: 1, give: { '소금': 3, '짐승의 뼈': 3 } },
  { id: 'b3', name: '호랑이 가면 재료 꾸러미', desc: '짐승의 뼈 5 · 철광석 조각 4 · 붉은 석재 조각 3', price: 35, limit: 1, give: { '짐승의 뼈': 5, '철광석 조각': 4, '붉은 석재 조각': 3 } },
  { id: 'b4', name: '구미호 가면 재료 꾸러미', desc: '새의 깃털 4 · 수정 파편 2 · 네잎 클로버 1', price: 60, limit: 1, give: { '새의 깃털': 4, '수정 파편': 2, '네잎 클로버': 1 } },
];
const MARKET_ACH = { id: 'ev_hlw_market', name: '도깨비 장터 단골', descr: '할로윈 밤, 도깨비 장터에서 물건을 열 번 넘게 샀다.' };

// ── 귀신의 집: 친구와 둘이서 방 5개를 지나갑니다. 방마다 셋 중 하나를 고르고, 둘이 같은 것을 고르면 공명 보너스 ──
const HOUSE_ROOMS = [
  { title: '대문 앞', text: '빈집의 대문이 저절로 열린다. 안쪽에서 푸른 불빛이 흔들린다.', ch: [
    { n: '문밖에서 안을 살핀다', e: [0, 1], t: 0, res: '아무 일도 없었지만, 문틈으로 누군가의 눈이 마주쳤다.' },
    { n: '등불을 들고 먼저 들어선다', e: [1, 2], t: 2, res: '등불이 흔들릴 때마다 벽 그림자가 한 걸음씩 따라왔다.' },
    { n: '대문을 박차고 뛰어든다', e: [2, 4], t: 4, res: '집 전체가 숨을 들이쉬듯 떨렸다.' }] },
  { title: '안방의 거울', text: '안방 한가운데 낡은 거울이 서 있다. 거울 속 방은 이쪽보다 조금 더 어둡다.', ch: [
    { n: '거울을 천으로 덮는다', e: [0, 1], t: 0, res: '천 아래에서 무언가 천천히 손바닥을 갖다 댔다.' },
    { n: '거울 속 자신과 눈을 맞춘다', e: [1, 2], t: 2, res: '거울 속의 얼굴이 한 박자 늦게 웃었다.' },
    { n: '거울 뒤를 들춰 본다', e: [2, 4], t: 4, res: '거울 뒤에는 벽이 없었다. 다만 오래된 복도가 이어져 있었다.' }] },
  { title: '부엌의 솥', text: '식은 솥 안에서 아직도 무언가 끓는 소리가 난다.', ch: [
    { n: '솥뚜껑을 열지 않고 지나간다', e: [0, 1], t: 0, res: '등 뒤에서 뚜껑이 한 번 들썩였다.' },
    { n: '국자로 휘저어 본다', e: [1, 2], t: 2, res: '국자 끝에 걸린 것은 오래된 구리 방울 하나였다.' },
    { n: '솥 속에 손을 넣는다', e: [2, 4], t: 4, res: '손끝에 닿은 것이 가만히 손가락을 쥐었다 놓았다.' }] },
  { title: '마루 밑의 방울', text: '마루 밑에서 방울 소리가 규칙적으로 울린다.', ch: [
    { n: '소리가 멎길 기다린다', e: [0, 1], t: 0, res: '방울 소리는 한참 뒤에야 천천히 멀어졌다.' },
    { n: '방울을 따라 기어든다', e: [1, 2], t: 2, res: '어둠 속에서 방울을 쥔 작은 손이 먼저 길을 열어 주었다.' },
    { n: '마루를 뜯어낸다', e: [2, 4], t: 4, res: '뜯긴 마루 아래에서 빛바랜 신발 수십 켤레가 쏟아졌다.' }] },
  { title: '다락방', text: '다락방 문이 열려 있고, 혼례복 한 벌이 가만히 걸려 있다.', ch: [
    { n: '혼례복에 절을 올린다', e: [0, 1], t: 0, res: '혼례복의 소매가 답하듯 가볍게 흔들렸다.' },
    { n: '소매 속을 더듬어 본다', e: [1, 2], t: 2, res: '소매 속에서 마른 꽃잎처럼 바스러지는 편지가 나왔다.' },
    { n: '혼례복을 걸쳐 입는다', e: [2, 4], t: 4, res: '옷깃이 몸에 감기자, 누군가의 웃음소리가 방 안에 가득 찼다.' }] },
];
const HOUSE_MATCH_BONUS = 1, HOUSE_CLEAR_BONUS = 8, HOUSE_DAILY = 2, HOUSE_WAIT_MS = 10 * MIN, HOUSE_IDLE_MS = 30 * MIN, HOUSE_SHOW_DONE_MS = 10 * MIN;
const HOUSE_ACH = { id: 'ev_hlw_house', name: '귀신의 집 탐험가', descr: '할로윈 밤, 친구와 함께 귀신의 집을 세 번 끝까지 탐험했다.' };

// ── 가면 장비 (얼굴 부위). bonus 를 직접 적습니다. grade 는 내구도·수리비에 쓰입니다. ──
const MASKS = [
  { id: 'ev_m1', ev: 'halloween', name: '도깨비 가면', slot: 'mask', grade: 'B', desc: '뿔 달린 붉은 도깨비 탈. 쓰면 발걸음이 가벼워진다.', bonus: { stat: 'agi', val: 6 }, mats: { [EMBER]: 150, '나뭇가지': 4, '낡은 천조각': 3 } },
  { id: 'ev_m2', ev: 'halloween', name: '해태 가면', slot: 'mask', grade: 'B', desc: '액운을 쫓는 해태의 탈. 오염이 덜 스며든다.', bonus: { stat: 'taintRes', val: 14 }, mats: { [EMBER]: 150, '소금': 3, '짐승의 뼈': 3 } },
  { id: 'ev_m3', ev: 'halloween', name: '호랑이 가면', slot: 'mask', grade: 'A', desc: '산군(山君)의 기세가 서린 탈. 쓰면 힘이 솟는다.', bonus: { stat: 'str', val: 9 }, mats: { [EMBER]: 150, '짐승의 뼈': 5, '철광석 조각': 4, '붉은 석재 조각': 3 } },
  { id: 'ev_m4', ev: 'halloween', name: '구미호 가면', slot: 'mask', grade: 'A', desc: '꼬리 아홉 달린 여우의 탈. 운이 따라붙는다.', bonus: { stat: 'luck', val: 9 }, mats: { [EMBER]: 150, '새의 깃털': 4, '수정 파편': 2, '네잎 클로버': 1 } },
];
const MASK_SLOT = { ko: '가면', stat: 'luck', ko_stat: '행운', v: [0, 0, 0, 0], unit: '' };   // 부위 표(능력치는 가면마다 bonus 로 정함)

// ── 혼령 소문 (괴담 앱에 섞여 나옴). 사실로 밝혀지면 믿은 사람에게 bonus 지급 ──
const RUMOR_TPL = [
  { ev: 1, t: '{p}의 떠도는 혼불', mon: '떠도는 혼불', rank: 'C', bonus: { item: EMBER, qty: 3 }, body: '밤마다 {p} 위로 푸른 혼불이 줄지어 떠다닌다는 소문입니다.', hoax: '반딧불이 떼를 잘못 본 것이었습니다.' },
  { ev: 1, t: '{p}의 가면 행렬', mon: '가면 행렬의 선두', rank: 'B', bonus: { item: EMBER, qty: 4 }, body: '{p}에서 새벽에 탈을 쓴 무리가 말없이 행진한다는 소문이 돕니다.', hoax: '축제 연습을 하던 탈춤 동호회였습니다.' },
  { ev: 1, t: '{p}의 우물 속 소복', mon: '우물 속 소복 여인', rank: 'B', bonus: { item: EMBER, qty: 4 }, body: '{p}의 오래된 우물 안에서 소복 입은 여인이 올려다본다고 합니다.', hoax: '우물에 비친 달그림자였습니다.' },
  { ev: 1, t: '{p}의 빈 상여 소리', mon: '빈 상여꾼', rank: 'A', bonus: { item: EMBER, qty: 6 }, body: '{p}의 골목에서 상여 나가는 소리가 들리는데, 문을 열면 아무도 없다고 합니다.', hoax: '공사장 확성기가 잘못 켜진 것이었습니다.' },
  { ev: 1, t: '{p}의 여우불', mon: '구미호의 여우불', rank: 'A', bonus: { item: EMBER, qty: 6 }, body: '{p}의 산길에서 꼬리 아홉 달린 그림자가 불을 들고 걷는다는 소문입니다.', hoax: '등산객의 헤드랜턴이 흔들려 그렇게 보인 것이었습니다.' },
  { ev: 1, t: '{p}의 도깨비 씨름판', mon: '씨름 걸어오는 도깨비', rank: 'C', bonus: { item: EMBER, qty: 3 }, body: '{p}를 지나던 사람이 "한판 하자"는 소리에 붙잡혀 밤새 씨름했다고 합니다.', hoax: '술 취한 행인과 실랑이한 것이 부풀려진 이야기였습니다.' },
];

// ── DB 표 (_db.js 의 MIGRATIONS 에 합쳐집니다) ──
const SQL = [
  'CREATE TABLE IF NOT EXISTS ev_wish (user_id INTEGER NOT NULL, day TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))',
  // 도감·장터·귀신의 집 횟수 기록 (key 예: dex:8 · mk:salt · house:2026-10-25 · house_done · story_all)
  'CREATE TABLE IF NOT EXISTS ev_claims (user_id INTEGER NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, key))',
  "CREATE TABLE IF NOT EXISTS ev_house (id TEXT PRIMARY KEY, host_id INTEGER NOT NULL, guest_id INTEGER NOT NULL, status TEXT NOT NULL, room INTEGER NOT NULL DEFAULT 0, ca INTEGER NOT NULL DEFAULT -1, cb INTEGER NOT NULL DEFAULT -1, log TEXT NOT NULL DEFAULT '[]', at INTEGER NOT NULL, upd INTEGER NOT NULL)",
  'CREATE INDEX IF NOT EXISTS ev_house_host ON ev_house(host_id, status)',
  'CREATE INDEX IF NOT EXISTS ev_house_guest ON ev_house(guest_id, status)',
  // 귀신의 집 둘만의 채팅 (집마다 최근 30줄만 남기고, 집이 정리될 때 함께 지워짐)
  'CREATE TABLE IF NOT EXISTS ev_house_chat (id TEXT PRIMARY KEY, house_id TEXT NOT NULL, from_id INTEGER NOT NULL, txt TEXT NOT NULL, at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS ev_house_chat_h ON ev_house_chat(house_id, id)',
  // 도깨비 불씨가 줄어든 내역 (늘어난 내역은 acquire_log 에 있음). delta 는 음수
  'CREATE TABLE IF NOT EXISTS ember_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta INTEGER NOT NULL, why TEXT NOT NULL, at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS ember_log_user ON ember_log(user_id, id)',
];

const RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const kstHour = now => new Date(now + 9 * HOUR).getUTCHours();
const kstDay = now => new Date(now + 9 * HOUR).toISOString().slice(0, 10);
const isNight = now => { const h = kstHour(now); return NIGHT_FROM > NIGHT_TO ? (h >= NIGHT_FROM || h < NIGHT_TO) : (h >= NIGHT_FROM && h < NIGHT_TO); };
// 다음 밤이 시작되는 시각 (밤이 아닐 때만 의미 있음)
// 지금 밤이면 밤이 끝날 때까지, 아니면 다음 밤이 시작될 때까지 남은 시간(ms)
const nightLeft = now => { if (!isNight(now)) return nextNightStart(now) - now; const d = new Date(now + 9 * HOUR); d.setUTCHours(NIGHT_TO, 0, 0, 0); let t = d.getTime() - 9 * HOUR; if (t <= now) t += 24 * HOUR; return t - now; };
const nextNightStart = now => { const d = new Date(now + 9 * HOUR); d.setUTCHours(NIGHT_FROM, 0, 0, 0); let t = d.getTime() - 9 * HOUR; if (t <= now) t += 24 * HOUR; return t; };
// 문자열 → 0..2^32 (소원 재료를 하루 동안 고정하기 위한 간단한 해시)
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seeded(seed) { let x = seed || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

// a: _app.js 에서 넘겨주는 도구 모음
function install(a) {
  const { db, G, route, send, fail, limited, userById, grantGold, logAcquire, giveItem, achReset, isFriend, userByCode, normCode, applyItemEffect } = a;
  const grantAch = async (uid, ach, now) => {        // 칭호(업적) 지급. 새로 받았으면 true
    await db.run('INSERT OR IGNORE INTO achievements (id, name, descr, kind, val, at) VALUES (?, ?, ?, ?, ?, ?)', [ach.id, ach.name, ach.descr, 'manual', '', now]);
    await db.run('UPDATE achievements SET descr = ? WHERE id = ?', [ach.descr, ach.id]);
    const r = await db.run('INSERT OR IGNORE INTO ach_grants (user_id, ach_id, at) VALUES (?, ?, ?)', [uid, ach.id, now]);
    achReset();
    return r.changes === 1;
  };
  // 횟수 기록(ev_claims): 한도 안이면 n 을 1(또는 add)만큼 올리고 true. 한도를 넘으면 false (동시에 눌러도 한도를 넘지 않음)
  const claimUp = async (uid, key, limit, now, add) => {
    add = add || 1;
    await db.run('INSERT OR IGNORE INTO ev_claims (user_id, key, n, at) VALUES (?, ?, 0, 0)', [uid, key]);
    const r = await db.run('UPDATE ev_claims SET n = n + ?, at = ? WHERE user_id = ? AND key = ? AND n + ? <= ?', [add, now, uid, key, add, limit]);
    return r.changes === 1;
  };
  const claimDown = (uid, key, add) => db.run('UPDATE ev_claims SET n = MAX(0, n - ?) WHERE user_id = ? AND key = ?', [add || 1, uid, key]);
  let cache = { at: 0, mode: 'auto', ok: false };      // ok: 설정을 DB 에서 한 번이라도 제대로 읽었는가 (못 읽은 상태에서는 '꺼짐'으로 단정하지 않음)
  let houseDaily = HOUSE_DAILY;      // 하루 귀신의 집 횟수 (관리자 창에서 바꿀 수 있음, 설정 'ev_house_daily')

  const modeNow = () => cache.mode;
  async function refresh(force) {
    const now = Date.now();
    if (!force && now - cache.at < 5000) return;
    try {
      const r = await db.get("SELECT value FROM settings WHERE key = 'ev_hlw'");
      cache.mode = r && (r.value === 'on' || r.value === 'off') ? r.value : 'auto';
      const hd = await db.get("SELECT value FROM settings WHERE key = 'ev_house_daily'");
      const hv = hd ? Number(hd.value) : NaN;
      houseDaily = Number.isInteger(hv) && hv >= 0 && hv <= 20 ? hv : HOUSE_DAILY;
      cache.at = now; cache.ok = true;
    } catch (_) { /* 설정을 못 읽으면 직전 값 유지 (다음 요청에서 바로 다시 읽음) */ }
  }
  // 지금 이벤트가 켜져 있는가 (동기. refresh() 가 5초마다 설정을 새로 읽어 옵니다)
  function on(now) {
    now = now || Date.now();
    const m = cache.mode;
    return m === 'on' ? true : m === 'off' ? false : (now >= START && now < END);
  }
  // 백귀야행(이벤트가 켜져 있는 밤 시간) 중에는 잡귀만 출몰합니다.
  const nightOnly = now => on(now) && isNight(now);
  const brief = now => on(now) ? { name: '할로윈', night: isNight(now), ends: cache.mode === 'auto' ? END : null, ember: EMBER } : null;

  // ① 백귀야행: 헌터가 접속해 요청할 때 밀린 만큼이 아니라 '지금' 한 무리를 만듭니다 (자리를 비운 사이의 잡귀는 만들지 않음)
  const nextAt = new Map();
  let gateCleaned = false;
  async function tick(u, now) {
    if (!on(now)) return;
    if (!gateCleaned) {          // 예전에 적월문 안쪽에 잘못 나온 잡귀를 한 번 치웁니다
      gateCleaned = true;
      const gids = G.REGIONS.filter(r => !G.SPAWN_REGIONS.includes(r)).map(r => r.id);
      if (gids.length) await db.run(`DELETE FROM monsters WHERE owner_id IS NOT NULL AND name IN (${GHOSTS.map(() => '?').join(',')}) AND region IN (${gids.map(() => '?').join(',')})`, GHOSTS.concat(gids)).catch(() => { gateCleaned = false; });
    }
    const c = nextAt.get(u.id);
    if (c !== undefined && now < c) return;
    if (!isNight(now)) { nextAt.set(u.id, Math.min(now + 5 * MIN, nextNightStart(now))); return; }
    const row = await db.get("SELECT next_at FROM user_spawn WHERE user_id = ? AND tier = 'evg'", [u.id]);
    if (!row) await db.run("INSERT OR IGNORE INTO user_spawn (user_id, tier, next_at) VALUES (?, 'evg', 0)", [u.id]);
    const from = row ? Number(row.next_at) : 0;
    if (from > now) { nextAt.set(u.id, from); return; }
    const next = now + rnd(GHOST_GAP[0], GHOST_GAP[1]) * MIN;
    const claim = await db.run("UPDATE user_spawn SET next_at = ? WHERE user_id = ? AND tier = 'evg' AND next_at = ?", [next, u.id, from]);
    nextAt.set(u.id, next);
    if (claim.changes !== 1) return;
    const ph = GHOSTS.map(() => '?').join(',');
    const live = await db.get(`SELECT COUNT(*) AS c FROM monsters WHERE owner_id = ? AND name IN (${ph}) AND spawned_at > ? AND id NOT IN (SELECT monster_id FROM kills WHERE user_id = ?)`,
      [u.id].concat(GHOSTS, [now - G.ACTIVE_MS, u.id]));
    const room = GHOST_CAP - Number(live.c);
    if (room <= 0) return;
    const n = Math.min(room, rnd(GHOST_BATCH[0], GHOST_BATCH[1]));
    const hi = Math.max(0, RANKS.indexOf(u.rank));
    // 잡귀는 한 지역에 몰리지 않고 세계의 여러 지역에 흩어져 나옵니다 (오염 80% 이상 헌터는 들어갈 수 없는 위험 지역을 뺌)
    let tn = 0; try { tn = Number(JSON.parse(u.stats).taint) || 0; } catch (_) { /* 스탯을 못 읽으면 제한 없음 */ }
    const banned = G.taintStage(tn) >= 3;
    const pool = G.SPAWN_REGIONS.filter(r => !(banned && G.TAINT_BAN_DANGER.has(r.danger)));
    const regs = pool.length ? pool : G.SPAWN_REGIONS;
    const topIdx = Math.min(5, hi + 1);      // 내 등급보다 한 단계 위(최대 A급)까지, F급부터 고르게
    const list = [];
    for (let i = 0; i < n; i++) {
      const rank = RANKS[rnd(0, topIdx)];
      list.push(['INSERT INTO monsters (region, name, rank, spawned_at, owner_id) VALUES (?, ?, ?, ?, ?)',
        [regs[rnd(0, regs.length - 1)].id, pickGhost(), rank, now - i, u.id]]);
    }
    await db.batch(list);
  }
  // 잡귀를 처치했을 때 불씨 지급. 지급한 수를 돌려줍니다 (0 이면 잡귀가 아님)
  async function onKill(cur, m, now) {
    if (!m || m.owner_id == null || !GHOST_SET.has(m.name)) return 0;
    const eb = GHOST_EMBER_BY[GHOST_TIER[m.name]] || [1, 2];
    const n = rnd(eb[0], eb[1]);
    await giveItem(cur.id, EMBER, n);
    await logAcquire(cur.id, 'item', EMBER, n, '백귀야행', now);
    return n;
  }
  // 불씨가 줄어들 때마다 남기는 기록 (실패해도 게임 진행에는 영향 없음)
  const lossLog = (uid, qty, why, now) => Number(qty) > 0 ? db.run('INSERT INTO ember_log (user_id, delta, why, at) VALUES (?, ?, ?, ?)', [uid, -Number(qty), String(why).slice(0, 80), now || Date.now()]).catch(() => {}) : Promise.resolve();
  // 이벤트가 꺼진 뒤 남은 잡귀 정리 (10분에 한 번)
  let lastClean = 0;
  async function cleanup(force) {
    const now = Date.now();
    if (!cache.ok) return;      // 설정을 아직 읽지 못했으면(새로 뜬 서버·DB 일시 오류) 이벤트가 꺼진 것으로 보고 정리하지 않습니다
    if (on(now) || (!force && now - lastClean < 10 * MIN)) return;
    lastClean = now;
    const ph = GHOSTS.map(() => '?').join(',');
    // 도깨비 불씨는 '관리자가 끄기를 눌렀을 때' 또는 '자동 기간(END)이 끝난 뒤'에만 사라집니다.
    // 아직 시작 전(START 이전)이거나 설정을 읽는 순간의 착오로 '꺼짐'처럼 보일 때는 지우지 않습니다.
    if (cache.mode === 'off' || (cache.mode === 'auto' && now >= END)) {
      await db.run("INSERT INTO ember_log (user_id, delta, why, at) SELECT user_id, -qty, ?, ? FROM inventory WHERE item = ? AND qty > 0", [cache.mode === 'off' ? '이벤트 끄기로 소멸' : '이벤트 기간 종료로 소멸', now, EMBER]).catch(() => {});
      await db.run('DELETE FROM inventory WHERE item = ?', [EMBER]);
    }
    const has = await db.get(`SELECT 1 AS x FROM monsters WHERE name IN (${ph}) LIMIT 1`, GHOSTS);
    if (!has) return;
    await db.batch([
      [`DELETE FROM battles WHERE monster_id IN (SELECT id FROM monsters WHERE owner_id IS NOT NULL AND name IN (${ph}))`, GHOSTS],
      [`DELETE FROM kills WHERE monster_id IN (SELECT id FROM monsters WHERE owner_id IS NOT NULL AND name IN (${ph}))`, GHOSTS],
      [`DELETE FROM fail_cd WHERE monster_id IN (SELECT id FROM monsters WHERE owner_id IS NOT NULL AND name IN (${ph}))`, GHOSTS],
      [`DELETE FROM monsters WHERE owner_id IS NOT NULL AND name IN (${ph})`, GHOSTS],
      ["DELETE FROM user_spawn WHERE tier = 'evg'", []],
    ]);
  }

  // ② 소원: 오늘의 귀신과 재료 (사용자·날짜가 같으면 항상 같은 결과)
  function wishOf(uid, day) {
    const r = seeded(hash(uid + ':' + day + ':hlw'));
    const ghost = STORY[storyIdx(day)];
    const pool = G.MATERIALS.filter(m => m.w >= 6).map(m => m.name);
    const items = [];
    while (items.length < 3) { const nm = pool[Math.floor(r() * pool.length)]; if (!items.some(x => x.item === nm)) items.push({ item: nm, qty: 1 + Math.floor(r() * 2) }); }
    return { who: ghost.who, say: ghost.say, items };
  }
  async function streakOf(uid, today) {
    const rows = await db.all('SELECT day FROM ev_wish WHERE user_id = ? AND done = 1 ORDER BY day DESC LIMIT 30', [uid]);
    const days = new Set(rows.map(r => r.day));
    const dt = s => Date.parse(s + 'T00:00:00Z'), back = s => new Date(dt(s) - 24 * HOUR).toISOString().slice(0, 10);
    let d = days.has(today) ? today : back(today), n = 0;
    while (days.has(d)) { n++; d = back(d); }
    return n;
  }
  route('GET', '/api/event', async (req, res, ctx) => {
    await refresh();
    const now = Date.now();
    if (!on(now)) return send(res, 200, { on: false });
    const u = ctx.user, day = kstDay(now), w = wishOf(u.id, day);
    const inv = new Map((await db.all('SELECT item, qty FROM inventory WHERE user_id = ? AND qty > 0', [u.id])).map(r => [r.item, Number(r.qty)]));
    const done = await db.get('SELECT done FROM ev_wish WHERE user_id = ? AND day = ?', [u.id, day]);
    const streak = await streakOf(u.id, day);
    const doneDays = await db.all('SELECT day FROM ev_wish WHERE user_id = ? AND done = 1 ORDER BY day DESC LIMIT 60', [u.id]);
    const open = new Set(doneDays.map(r => storyIdx(r.day))), today = storyIdx(day);
    send(res, 200, {
      story: { total: STORY.length, read: open.size, today, chapters: STORY.map((c, i) => ({ n: i + 1, who: open.has(i) || i === today ? c.who : null, text: open.has(i) ? c.text : null, done: open.has(i) })), allEmber: STORY_ALL_EMBER, achName: STORY_ACH.name },
      on: true, night: isNight(now), nightLeft: nightLeft(now), nightText: String(NIGHT_FROM) + '시 ~ 다음날 ' + String(NIGHT_TO).padStart(2, '0') + '시', ends: cache.mode === 'auto' ? END : null,
      ember: inv.get(EMBER) || 0, emberName: EMBER,
      masks: MASKS.map(m => ({ id: m.id, name: m.name, grade: m.grade, desc: m.desc, fx: ({ agi: '민첩', str: '근력', luck: '행운', taintRes: '오염도 증가 감소' })[m.bonus.stat] + ' +' + m.bonus.val + (m.bonus.stat === 'taintRes' ? '%' : ''),
        mats: Object.keys(m.mats).map(k => ({ item: k, qty: m.mats[k], have: inv.get(k) || 0 })) })),
      wish: { who: w.who, say: w.say, items: w.items.map(x => ({ item: x.item, qty: x.qty, have: inv.get(x.item) || 0 })), done: !!(done && done.done), streak, need: WISH_STREAK, reward: { ember: WISH_EMBER, streakEmber: WISH_STREAK_EMBER, achName: WISH_ACH.name } },
      resetIn: 24 * HOUR - ((now + 9 * HOUR) % (24 * HOUR)),
    });
  });
  route('POST', '/api/event/wish', async (req, res, ctx) => {
    if (await limited('evw:' + ctx.user.id, 20, 60000)) return fail(res, 429, 'rate_limited');
    await refresh();
    const now = Date.now();
    if (!on(now)) return fail(res, 403, 'event_off');
    const u = await userById(ctx.user.id), day = kstDay(now), w = wishOf(u.id, day);
    await db.run('INSERT OR IGNORE INTO ev_wish (user_id, day, done, at) VALUES (?, ?, 0, 0)', [u.id, day]);
    const dn = await db.get('SELECT done FROM ev_wish WHERE user_id = ? AND day = ?', [u.id, day]);
    if (dn && dn.done) return fail(res, 409, 'already_done');
    const taken = [];
    const restore = async () => { for (const t of taken) await giveItem(u.id, t[0], t[1]); };
    try {
      for (const x of w.items) {
        const d = await db.run('UPDATE inventory SET qty = qty - ? WHERE user_id = ? AND item = ? AND qty >= ?', [x.qty, u.id, x.item, x.qty]);
        if (d.changes !== 1) { await restore(); return fail(res, 400, 'no_mats', { item: x.item }); }
        taken.push([x.item, x.qty]);
      }
      const c = await db.run('UPDATE ev_wish SET done = 1, at = ? WHERE user_id = ? AND day = ? AND done = 0', [now, u.id, day]);
      if (c.changes !== 1) { await restore(); return fail(res, 409, 'already_done'); }
    } catch (err) { await restore(); throw err; }
    await db.run('DELETE FROM inventory WHERE user_id = ? AND qty <= 0', [u.id]);
    const ri = Math.max(0, RANKS.indexOf(u.rank));
    const gold = 150 + ri * 60;
    const streak = await streakOf(u.id, day);
    let ember = WISH_EMBER, ach = false;
    const ci = storyIdx(day);
    if (ci === STORY.length - 1) ember += FINAL_DAY_EMBER;       // 완결편의 날
    if (streak === WISH_STREAK) {
      ember += WISH_STREAK_EMBER;
      await db.run('INSERT OR IGNORE INTO achievements (id, name, descr, kind, val, at) VALUES (?, ?, ?, ?, ?, ?)', [WISH_ACH.id, WISH_ACH.name, WISH_ACH.descr, 'manual', '', now]);
      await db.run('UPDATE achievements SET descr = ? WHERE id = ?', [WISH_ACH.descr, WISH_ACH.id]);       // 예전 문구로 만들어진 칸이 있으면 새 조건 문구로
      await db.run('INSERT OR IGNORE INTO ach_grants (user_id, ach_id, at) VALUES (?, ?, ?)', [u.id, WISH_ACH.id, now]);
      achReset();
      ach = true;
    }
    await grantGold(u.id, gold);
    await giveItem(u.id, EMBER, ember);
    await logAcquire(u.id, 'gold', '골드', gold, '처녀귀신의 소원', now);
    await logAcquire(u.id, 'item', EMBER, ember, '처녀귀신의 소원', now);
    // 여덟 조각을 모두 모았으면 완결 보상 (한 번만)
    const doneAll = await db.all('SELECT day FROM ev_wish WHERE user_id = ? AND done = 1 ORDER BY day DESC LIMIT 60', [u.id]);
    let storyEnd = '';
    if (new Set(doneAll.map(r => storyIdx(r.day))).size >= STORY.length && await claimUp(u.id, 'story_all', 1, now)) {
      await giveItem(u.id, EMBER, STORY_ALL_EMBER);
      await logAcquire(u.id, 'item', EMBER, STORY_ALL_EMBER, '처녀귀신의 사연 완결', now);
      await grantAch(u.id, STORY_ACH, now);
      ember += STORY_ALL_EMBER; storyEnd = STORY_ACH.name;
    }
    send(res, 200, { ok: true, gold, ember, streak, ach: ach ? WISH_ACH.name : '', chapter: { n: ci + 1, who: STORY[ci].who, text: STORY[ci].text }, storyEnd });
  });

  // ③ 백귀 도감: 잡귀 32종을 모아 단계별 보상 (처치 기록은 기존 토벌 기록을 그대로 사용)
  const ghostPh = GHOSTS.map(() => '?').join(',');
  async function dexState(uid) {
    const rows = await db.all(`SELECT mon, SUM(n) AS c FROM hunt_log WHERE user_id = ? AND result = 'success' AND mon IN (${ghostPh}) GROUP BY mon`, [uid].concat(GHOSTS));
    const got = new Map(rows.map(r => [r.mon, Number(r.c) || 0]));
    const cl = await db.all("SELECT key FROM ev_claims WHERE user_id = ? AND key LIKE 'dex:%' AND n > 0", [uid]);
    const claimed = new Set(cl.map(r => r.key));
    const found = GHOSTS.filter(n => got.has(n)).length;
    return { got, found, claimed };
  }
  route('GET', '/api/event/dex', async (req, res, ctx) => {
    await refresh();
    if (!on(Date.now())) return send(res, 200, { on: false });
    const d = await dexState(ctx.user.id);
    const tiers = ['c', 'u', 'r'].map(k => ({ k, label: TIER_LABEL[k], ember: GHOST_EMBER_BY[k].join('~'),
      list: GHOSTS.filter(n => GHOST_TIER[n] === k).map(n => d.got.has(n) ? { name: n, kills: d.got.get(n) } : { name: null, kills: 0 }) }));
    send(res, 200, { on: true, total: GHOSTS.length, found: d.found, tiers, emberName: EMBER,
      stages: DEX_STAGES.map(([need, ember], i) => ({ need, ember, claimed: d.claimed.has('dex:' + need), ready: d.found >= need && !d.claimed.has('dex:' + need), ach: i === DEX_STAGES.length - 1 ? DEX_ACH.name : '' })) });
  });
  route('POST', '/api/event/dex/claim', async (req, res, ctx) => {
    if (await limited('evd:' + ctx.user.id, 20, 60000)) return fail(res, 429, 'rate_limited');
    await refresh();
    const now = Date.now();
    if (!on(now)) return fail(res, 403, 'event_off');
    const need = Number(ctx.body.stage), st = DEX_STAGES.find(x => x[0] === need);
    if (!st) return fail(res, 400, 'bad_stage');
    const d = await dexState(ctx.user.id);
    if (d.found < need) return fail(res, 409, 'not_ready');
    if (!(await claimUp(ctx.user.id, 'dex:' + need, 1, now))) return fail(res, 409, 'already_claimed');
    await giveItem(ctx.user.id, EMBER, st[1]);
    await logAcquire(ctx.user.id, 'item', EMBER, st[1], '백귀 도감', now);
    let ach = '';
    if (need === GHOSTS.length && await grantAch(ctx.user.id, DEX_ACH, now)) ach = DEX_ACH.name;
    send(res, 200, { ok: true, ember: st[1], ach });
  });

  // ④ 도깨비 장터: 도깨비 불씨로 사는 한정 품목
  route('GET', '/api/event/market', async (req, res, ctx) => {
    await refresh();
    if (!on(Date.now())) return send(res, 200, { on: false });
    const uid = ctx.user.id;
    const [em, cl] = await Promise.all([
      db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [uid, EMBER]),
      db.all("SELECT key, n FROM ev_claims WHERE user_id = ? AND key LIKE 'mk:%'", [uid]),
    ]);
    const bought = new Map(cl.map(r => [r.key, Number(r.n) || 0]));
    const total = cl.reduce((t, r) => t + (Number(r.n) || 0), 0);
    send(res, 200, { on: true, ember: em ? Number(em.qty) : 0, emberName: EMBER, total, achNeed: 10, achName: MARKET_ACH.name,
      items: MARKET.map(m => ({ id: m.id, name: m.name, desc: m.desc, price: m.price, limit: m.limit, bought: bought.get('mk:' + m.id) || 0 })) });
  });
  route('POST', '/api/event/market/buy', async (req, res, ctx) => {
    if (await limited('evm:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
    await refresh();
    const now = Date.now();
    if (!on(now)) return fail(res, 403, 'event_off');
    const it = MARKET.find(m => m.id === String(ctx.body.id));
    if (!it) return fail(res, 404, 'no_item');
    const uid = ctx.user.id, key = 'mk:' + it.id;
    if (!(await claimUp(uid, key, it.limit, now))) return fail(res, 409, 'limit');                // 구매 한도를 먼저 확보
    const pay = await db.run('UPDATE inventory SET qty = qty - ? WHERE user_id = ? AND item = ? AND qty >= ?', [it.price, uid, EMBER, it.price]);
    if (pay.changes !== 1) { await claimDown(uid, key); return fail(res, 402, 'no_ember'); }
    await db.run('DELETE FROM inventory WHERE user_id = ? AND qty <= 0', [uid]);
    try {
      if (it.give) for (const [nm, q] of Object.entries(it.give)) { await giveItem(uid, nm, q); await logAcquire(uid, 'item', nm, q, '도깨비 장터 (-' + it.price + ' 불씨)', now); }
      if (it.fx && it.fx.gold) { await grantGold(uid, it.fx.gold); await logAcquire(uid, 'gold', '골드', it.fx.gold, '도깨비 장터 (-' + it.price + ' 불씨)', now); }
      if (it.fx && it.fx.taint) await applyItemEffect(uid, 'taint', it.fx.taint, now);
    } catch (err) {                                                                              // 지급에 실패하면 불씨와 한도를 되돌립니다
      await giveItem(uid, EMBER, it.price); await claimDown(uid, key); throw err;
    }
    await lossLog(uid, it.price, '도깨비 장터 구매 (' + it.name + ')', now);
    const t = await db.get("SELECT COALESCE(SUM(n), 0) AS c FROM ev_claims WHERE user_id = ? AND key LIKE 'mk:%'", [uid]);
    let ach = '';
    if (Number(t.c) >= 10 && await grantAch(uid, MARKET_ACH, now)) ach = MARKET_ACH.name;
    send(res, 200, { ok: true, name: it.name, price: it.price, ach });
  });

  // ⑤ 귀신의 집: 친구와 둘이서 방 5개를 지나갑니다 (진행 상태는 ev_house 한 줄. 끝난 줄은 하루 뒤 정리)
  // 둘만의 대화 자동 검열: 지금 방의 선택지를 직접 말하면(선택지 이름 · 번호 · 위험도 등) 메신저 검열과 같은 ▒▓░ 문자로 가립니다.
  // 둘이 같은 것을 골라야 공명 보너스를 받는 규칙이라, 대화로 답을 맞추지 못하게 하기 위함입니다.
  const CENS_GLYPH = ['▒', '░░', '▒', '▓▓', '▓'];
  const CENS_WEAK = new Set(['들어', '나가', '지나', '바라', '그냥', '조용', '천천', '다시', '먼저', '아무']);
  const CENS_GENERIC = [/[1-3１-３]\s*번(째)?/g, /(첫|두|세)\s*번째/g, /(첫|둘|셋)째/g, /선택지/g,
    /(오염\s*)?위험(도)?\s*(이|가|은|는)?\s*(낮|높|보통|제일|가장)\S*/g, /(낮은|높은|보통)\s*위험/g];
  const censMask = w => Array.from(w).map((_, i) => CENS_GLYPH[(i * 3 + w.length) % CENS_GLYPH.length]).join('');
  const censStems = HOUSE_ROOMS.map(rm => {
    const ctx = rm.title + ' ' + rm.text;
    const toks = rm.ch.map(c => c.n.split(/\s+/).map(t => t.replace(/[^가-힣]/g, '')).filter(t => t.length >= 3));
    const stems = new Set();
    toks.forEach((list, i) => list.forEach(t => {
      const st = t.slice(0, 2);
      if (CENS_WEAK.has(st) || ctx.includes(st)) return;
      if (toks.some((o, j) => j !== i && o.some(x => x.slice(0, 2) === st))) return;      // 다른 선택지에도 나오는 흔한 말은 제외
      stems.add(st);
    }));
    return Array.from(stems).map(st => new RegExp('[가-힣]*' + st + '[가-힣]*', 'g'));
  });
  const houseCensor = (txt, room) => {
    let hit = false;
    const fix = re => { txt = txt.replace(re, m => { hit = true; return censMask(m); }); };
    (censStems[room] || []).forEach(fix);
    CENS_GENERIC.forEach(fix);
    return { t: txt, cens: hit };
  };
  const houseCh = (r, c) => HOUSE_ROOMS[r].ch[c];
  const dayKeyH = now => 'house:' + kstDay(now);
  const houseView = (h, uid, now) => {
    const host = h.host_id === uid, log = JSON.parse(h.log || '[]');
    const me = host ? 'a' : 'b', they = host ? 'b' : 'a';
    const partner = host ? { hn: h.ghn, rank: h.grk } : { hn: h.hhn, rank: h.hrk };
    const out = { id: h.id, status: h.status, role: host ? 'host' : 'guest', partner, room: Number(h.room), total: HOUSE_ROOMS.length,
      log: log.map(x => { const rm = HOUSE_ROOMS[x.r]; return { title: rm.title, mine: houseCh(x.r, x[me]).n, theirs: houseCh(x.r, x[they]).n, res: houseCh(x.r, x[me]).res, e: x['e' + me], t: x['t' + me], match: !!x.m }; }) };
    if (h.status === 'run') {
      const rm = HOUSE_ROOMS[Number(h.room)];
      out.scene = { title: rm.title, text: rm.text, choices: rm.ch.map(c => ({ n: c.n, risk: c.t })) };
      const mine = host ? Number(h.ca) : Number(h.cb), theirs = host ? Number(h.cb) : Number(h.ca);
      out.chosen = mine; out.partnerChose = theirs >= 0;
    }
    if (h.status === 'done') {
      const sum = k => log.reduce((t, x) => t + (Number(x[k + me]) || 0), 0);
      out.result = { ember: sum('e') + HOUSE_CLEAR_BONUS, taint: sum('t'), clearBonus: HOUSE_CLEAR_BONUS, matches: log.filter(x => x.m).length };
    }
    return out;
  };
  const HOUSE_SEL = `SELECT h.id, h.host_id, h.guest_id, h.status, h.room, h.ca, h.cb, h.log, h.at, h.upd, a.hunter_name AS hhn, a.rank AS hrk, b.hunter_name AS ghn, b.rank AS grk
    FROM ev_house h JOIN users a ON a.id = h.host_id JOIN users b ON b.id = h.guest_id`;
  // 이 헌터가 지금 하고 있는(또는 방금 끝난) 집. 오래 멈춘 것은 없는 것으로 칩니다.
  async function houseOf(uid, now) {
    return db.get(HOUSE_SEL + ` WHERE (h.host_id = ? OR h.guest_id = ?) AND ((h.status = 'wait' AND h.upd > ?) OR (h.status = 'run' AND h.upd > ?) OR (h.status = 'done' AND h.upd > ?)) ORDER BY h.upd DESC LIMIT 1`,
      [uid, uid, now - HOUSE_WAIT_MS, now - HOUSE_IDLE_MS, now - HOUSE_SHOW_DONE_MS]);
  }
  const houseById = id => db.get(HOUSE_SEL + ' WHERE h.id = ?', [id]);
  let lastHousePrune = 0;
  async function housePrune(now) {
    if (now - lastHousePrune < 3600000) return;
    lastHousePrune = now;
    await db.run('DELETE FROM ev_house_chat WHERE house_id IN (SELECT id FROM ev_house WHERE upd < ?)', [now - 24 * HOUR]).catch(() => {});
    await db.run('DELETE FROM ev_house WHERE upd < ?', [now - 24 * HOUR]).catch(() => {});
  }
  const houseLeft = async (uid, now) => { const r = await db.get('SELECT n FROM ev_claims WHERE user_id = ? AND key = ?', [uid, dayKeyH(now)]); return Math.max(0, houseDaily - (r ? Number(r.n) : 0)); };

  route('GET', '/api/event/house', async (req, res, ctx) => {
    await refresh();
    const now = Date.now();
    if (!on(now)) return send(res, 200, { on: false });
    const uid = ctx.user.id;
    housePrune(now);
    const h = await houseOf(uid, now);
    const out = { on: true, left: await houseLeft(uid, now), max: houseDaily, rooms: HOUSE_ROOMS.length, emberName: EMBER, house: null, invite: null };
    if (h) {
      if (h.status === 'wait' && h.guest_id === uid) out.invite = { id: h.id, from: { hn: h.hhn, rank: h.hrk } };
      else {
        out.house = houseView(h, uid, now);
        // 둘만의 채팅: 진행 중(또는 막 끝난) 집에서만. after 이후의 새 글만 보냅니다 (DB 읽기를 줄이기 위해)
        if (h.status === 'run' || h.status === 'done') {
          const after = String(new URL(req.url, 'http://x').searchParams.get('after') || '').replace(/[^0-9a-z]/g, '').slice(0, 20);
          const rows = await db.all('SELECT id, from_id, txt, at FROM ev_house_chat WHERE house_id = ? AND id > ? ORDER BY id ASC LIMIT 30', [h.id, after]);
          out.chat = rows.map(r => ({ k: r.id, me: r.from_id === uid, t: r.txt, at: Number(r.at) }));
        }
      }
    }
    send(res, 200, out);
  });
  // 채팅 보내기: 이 집의 두 사람만, 진행 중일 때만
  route('POST', '/api/event/house/chat', async (req, res, ctx) => {
    await refresh();
    const now = Date.now();
    if (!on(now)) return fail(res, 403, 'event_off');
    const uid = ctx.user.id;
    if (ctx.user.block_flags & 8) return fail(res, 403, 'blocked', { what: 'msg' });      // 운영자가 메시지를 막아 둔 헌터
    if (await limited('hchat:' + uid, 20, 30000)) return fail(res, 429, 'rate_limited');
    const txt = String(ctx.body.text == null ? '' : ctx.body.text).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!txt || Array.from(txt).length > 100) return fail(res, 400, 'bad_text');
    const h = await houseById(String(ctx.body.id || ''));
    if (!h || h.status !== 'run' || (h.host_id !== uid && h.guest_id !== uid) || h.upd <= now - HOUSE_IDLE_MS) return fail(res, 404, 'no_house');
    const cz = houseCensor(txt, Number(h.room));      // 선택지를 직접 말한 부분은 가려서 저장 (보낸 사람 화면에도 가려진 모습으로 보임)
    const id = String(now).padStart(13, '0') + require('node:crypto').randomBytes(3).toString('hex');
    await db.run('INSERT INTO ev_house_chat (id, house_id, from_id, txt, at) VALUES (?, ?, ?, ?, ?)', [id, h.id, uid, cz.t, now]);
    await db.run('UPDATE ev_house SET upd = ? WHERE id = ? AND status = ?', [now, h.id, 'run']);      // 대화 중이면 자리를 비운 것으로 보지 않음
    await db.run('DELETE FROM ev_house_chat WHERE house_id = ? AND id < (SELECT MIN(id) FROM (SELECT id FROM ev_house_chat WHERE house_id = ? ORDER BY id DESC LIMIT 30) q)', [h.id, h.id]).catch(() => {});
    send(res, 200, { ok: true, k: id, cens: cz.cens });
  });
  route('POST', '/api/event/house/invite', async (req, res, ctx) => {
    if (await limited('evh:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
    await refresh();
    const now = Date.now();
    if (!on(now)) return fail(res, 403, 'event_off');
    const uid = ctx.user.id, f = await userByCode(normCode(ctx.body.code));
    if (!f || f.id === uid || !(await isFriend(uid, f.id))) return fail(res, 404, 'not_friend');
    if ((await houseLeft(uid, now)) < 1) return fail(res, 409, 'limit_me');
    if ((await houseLeft(f.id, now)) < 1) return fail(res, 409, 'limit_friend');
    const mine = await houseOf(uid, now);
    if (mine && mine.status !== 'done') return fail(res, 409, 'busy');
    const theirs = await houseOf(f.id, now);
    if (theirs && theirs.status !== 'done') return fail(res, 409, 'friend_busy');
    const id = require('node:crypto').randomBytes(8).toString('hex');
    await db.run("INSERT INTO ev_house (id, host_id, guest_id, status, room, ca, cb, log, at, upd) VALUES (?, ?, ?, 'wait', 0, -1, -1, '[]', ?, ?)", [id, uid, f.id, now, now]);
    send(res, 200, { ok: true, id });
  });
  route('POST', '/api/event/house/join', async (req, res, ctx) => {
    if (await limited('evh:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
    await refresh();
    const now = Date.now();
    if (!on(now)) return fail(res, 403, 'event_off');
    const uid = ctx.user.id, h = await houseById(String(ctx.body.id || ''));
    if (!h || h.guest_id !== uid || h.status !== 'wait' || h.upd <= now - HOUSE_WAIT_MS) return fail(res, 404, 'no_invite');
    // 두 사람 모두 오늘 남은 횟수가 있어야 시작합니다 (시작할 때 한 번씩 차감)
    if (!(await claimUp(h.host_id, dayKeyH(now), houseDaily, now))) return fail(res, 409, 'limit_friend');
    if (!(await claimUp(uid, dayKeyH(now), houseDaily, now))) { await claimDown(h.host_id, dayKeyH(now)); return fail(res, 409, 'limit_me'); }
    const c = await db.run("UPDATE ev_house SET status = 'run', room = 0, ca = -1, cb = -1, upd = ? WHERE id = ? AND status = 'wait' AND guest_id = ?", [now, h.id, uid]);
    if (c.changes !== 1) { await claimDown(h.host_id, dayKeyH(now)); await claimDown(uid, dayKeyH(now)); return fail(res, 409, 'no_invite'); }
    send(res, 200, { ok: true });
  });
  route('POST', '/api/event/house/leave', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now();
    const c = await db.run("UPDATE ev_house SET status = 'cancel', upd = ? WHERE id = ? AND (host_id = ? OR guest_id = ?) AND status IN ('wait', 'run')", [now, String(ctx.body.id || ''), uid, uid]);
    send(res, 200, { ok: true, left: c.changes === 1 });
  });
  // 방 하나가 끝났을 때의 결과 계산 (같은 입력이면 항상 같은 결과)
  function houseRoom(h, r, ca, cb) {
    const rnd2 = seeded(hash(h.id + ':' + r + ':' + ca + ':' + cb));
    const pick = ch => ch.e[0] + Math.floor(rnd2() * (ch.e[1] - ch.e[0] + 1));
    const A = houseCh(r, ca), B = houseCh(r, cb), match = ca === cb;
    let ea = pick(A), eb = pick(B), ta = A.t, tb = B.t;
    if (match) { ea += HOUSE_MATCH_BONUS; eb += HOUSE_MATCH_BONUS; }
    else if (ca > cb) ta = Math.max(0, ta - 2);                // 더 위험한 쪽은 상대가 곁에서 지켜 줘서 오염을 덜 받음
    else tb = Math.max(0, tb - 2);
    return { r, a: ca, b: cb, ea, eb, ta, tb, m: match ? 1 : 0 };
  }
  async function houseFinish(h, log, now) {
    const sum = (k) => log.reduce((t, x) => t + (Number(x[k]) || 0), 0);
    for (const [uid, ek, tk] of [[h.host_id, 'ea', 'ta'], [h.guest_id, 'eb', 'tb']]) {
      const ember = sum(ek) + HOUSE_CLEAR_BONUS;
      await giveItem(uid, EMBER, ember);
      await logAcquire(uid, 'item', EMBER, ember, '귀신의 집', now);
      const st = await db.get('SELECT stats FROM users WHERE id = ?', [uid]);
      const cur = st ? Number(JSON.parse(st.stats).taint) || 0 : 0;
      const dt = Math.max(0, Math.min(sum(tk), 99 - cur));          // 오염도 폭주(100)까지는 올리지 않습니다
      if (dt > 0) await applyItemEffect(uid, 'taint', dt, now);
      await claimUp(uid, 'house_done', 9999, now);
      const n = await db.get("SELECT n FROM ev_claims WHERE user_id = ? AND key = 'house_done'", [uid]);
      if (n && Number(n.n) >= 3) await grantAch(uid, HOUSE_ACH, now);
    }
  }
  route('POST', '/api/event/house/choose', async (req, res, ctx) => {
    if (await limited('evh:' + ctx.user.id, 60, 60000)) return fail(res, 429, 'rate_limited');
    await refresh();
    const now = Date.now();
    if (!on(now)) return fail(res, 403, 'event_off');
    const uid = ctx.user.id, c = Number(ctx.body.c);
    if (![0, 1, 2].includes(c)) return fail(res, 400, 'bad_choice');
    let h = await houseById(String(ctx.body.id || ''));
    if (!h || h.status !== 'run' || (h.host_id !== uid && h.guest_id !== uid) || h.upd <= now - HOUSE_IDLE_MS) return fail(res, 404, 'no_house');
    const col = h.host_id === uid ? 'ca' : 'cb';
    const w = await db.run(`UPDATE ev_house SET ${col} = ?, upd = ? WHERE id = ? AND status = 'run' AND ${col} = -1 AND room = ?`, [c, now, h.id, h.room]);
    if (w.changes === 1) {
      h = await houseById(h.id);
      if (Number(h.ca) >= 0 && Number(h.cb) >= 0) {                        // 둘 다 골랐으면 이 방을 풀이합니다 (먼저 처리한 쪽만 성공)
        const log = JSON.parse(h.log || '[]');
        log.push(houseRoom(h, Number(h.room), Number(h.ca), Number(h.cb)));
        const last = Number(h.room) + 1 >= HOUSE_ROOMS.length;
        const adv = await db.run(`UPDATE ev_house SET status = ?, room = ?, ca = -1, cb = -1, log = ?, upd = ? WHERE id = ? AND status = 'run' AND room = ? AND ca = ? AND cb = ?`,
          [last ? 'done' : 'run', Number(h.room) + 1, JSON.stringify(log), now, h.id, h.room, h.ca, h.cb]);
        if (adv.changes === 1 && last) await houseFinish(h, log, now);
        h = await houseById(h.id);
      }
    } else h = await houseById(h.id);
    send(res, 200, { ok: true, house: houseView(h, uid, now) });
  });

  // 관리자: 이벤트 켜기/끄기
  route('GET', '/api/admin/event', async (req, res) => {
    await refresh(true);
    const now = Date.now();
    send(res, 200, { mode: cache.mode, on: on(now), start: START, end: END, ghosts: GHOSTS.length, masks: MASKS.map(m => m.name) });
  }, { auth: false, admin: true });
  route('POST', '/api/admin/event', async (req, res, ctx) => {
    const mode = ['on', 'off', 'auto'].includes(ctx.body.mode) ? ctx.body.mode : null;
    if (!mode) return fail(res, 400, 'bad_mode');
    if (mode === 'auto') await db.run("DELETE FROM settings WHERE key = 'ev_hlw'");
    else await db.run("INSERT INTO settings (key, value) VALUES ('ev_hlw', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [mode]);
    cache = { at: Date.now(), mode, ok: true };
    nextAt.clear();
    if (!on(Date.now())) await cleanup(true);
    send(res, 200, { mode, on: on(Date.now()) });
  }, { auth: false, admin: true });


  // 한 헌터의 불씨 획득(acquire_log)·소실(ember_log) 내역을 최근 순으로 합칩니다
  async function emberHistory(uid, limit) {
    const [inv, gains, losses] = await Promise.all([
      db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [uid, EMBER]),
      db.all("SELECT qty, source, at FROM acquire_log WHERE user_id = ? AND kind = 'item' AND name = ? ORDER BY id DESC LIMIT ?", [uid, EMBER, limit]),
      db.all('SELECT delta, why, at FROM ember_log WHERE user_id = ? ORDER BY id DESC LIMIT ?', [uid, limit]),
    ]);
    const list = gains.map(g => ({ d: Number(g.qty), why: g.source, at: Number(g.at) })).concat(losses.map(l => ({ d: Number(l.delta), why: l.why, at: Number(l.at) }))).sort((a, b) => b.at - a.at).slice(0, limit);
    const sum = f => list.reduce((t, x) => t + (f(x) ? x.d : 0), 0);
    return { have: inv ? Number(inv.qty) : 0, gain: sum(x => x.d > 0), loss: -sum(x => x.d < 0), list };
  }
  // 헌터: 내 불씨 획득·소실 내역
  route('GET', '/api/event/ember', async (req, res, ctx) => {
    await refresh();
    if (!on(Date.now())) return send(res, 200, { on: false });
    send(res, 200, Object.assign({ on: true, name: EMBER }, await emberHistory(ctx.user.id, 100)));
  });
  // 관리자: 한 헌터의 도깨비 불씨 획득·소실 내역 (?code=헌터코드)
  route('GET', '/api/admin/event/ember', async (req, res) => {
    const code = normCode(new URL(req.url, 'http://x').searchParams.get('code') || '');
    const u = code ? await userByCode(code) : null;
    if (!u) return fail(res, 404, 'no_user');
    send(res, 200, Object.assign({ hn: u.hunter_name, code: u.code }, await emberHistory(u.id, 300)));
  }, { auth: false, admin: true });

  // 관리자: 귀신의 집 하루 횟수 조작
  //  GET  ?code=      → 그 헌터의 오늘 남은 횟수 / 하루 기본 횟수
  //  POST {code, left} → 그 헌터의 오늘 남은 횟수를 정함 (0~20)
  //  POST {max}        → 모든 헌터의 하루 기본 횟수를 정함 (0~20, 기본 2)
  //  POST {resetAll:true} → 오늘 모든 헌터의 사용 횟수를 지워 기본 횟수로 되돌림
  route('GET', '/api/admin/event/house', async (req, res) => {
    await refresh(true);
    const code = normCode(new URL(req.url, 'http://x').searchParams.get('code') || '');
    const out = { max: houseDaily, def: HOUSE_DAILY };
    if (code) {
      const u = await userByCode(code);
      if (!u) return fail(res, 404, 'no_user');
      out.hn = u.hunter_name; out.code = u.code; out.left = await houseLeft(u.id, Date.now());
    }
    send(res, 200, out);
  }, { auth: false, admin: true });
  route('POST', '/api/admin/event/house', async (req, res, ctx) => {
    const now = Date.now(), b = ctx.body;
    if (b.resetAll === true) {
      await db.run('DELETE FROM ev_claims WHERE key = ?', [dayKeyH(now)]);
      return send(res, 200, { ok: true, max: houseDaily });
    }
    if (b.max !== undefined) {
      const m = Number(b.max);
      if (!Number.isInteger(m) || m < 0 || m > 20) return fail(res, 400, 'bad_max');
      await db.run("INSERT INTO settings (key, value) VALUES ('ev_house_daily', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(m)]);
      houseDaily = m;
      return send(res, 200, { ok: true, max: m });
    }
    const left = Number(b.left);
    if (!Number.isInteger(left) || left < 0 || left > 20) return fail(res, 400, 'bad_left');
    const u = await userByCode(normCode(String(b.code || '')));
    if (!u) return fail(res, 404, 'no_user');
    await refresh(true);
    const used = houseDaily - left;      // 기본 횟수보다 많이 주려면 사용 횟수를 음수로 둡니다
    await db.run('INSERT OR IGNORE INTO ev_claims (user_id, key, n, at) VALUES (?, ?, 0, 0)', [u.id, dayKeyH(now)]);
    await db.run('UPDATE ev_claims SET n = ?, at = ? WHERE user_id = ? AND key = ?', [used, now, u.id, dayKeyH(now)]);
    send(res, 200, { ok: true, hn: u.hunter_name, left: await houseLeft(u.id, now), max: houseDaily });
  }, { auth: false, admin: true });

  // 잡귀가 절대 나오면 안 되는 곳: 적월문(게이트) 안쪽 지역 전부
  const GATE_IDS = G.REGIONS.filter(r => !G.SPAWN_REGIONS.includes(r)).map(r => r.id);
  const GATE_SET = new Set(GATE_IDS);
  const isGhostInGate = m => !!m && GHOST_SET.has(m.name) && GATE_SET.has(m.region);
  // SQL 조각: 적월문 안의 잡귀를 목록에서 뺍니다 (몬스터 표를 읽는 쪽에서 덧붙여 사용)
  const GATE_GHOST_SQL = GATE_IDS.length ? ` AND NOT (name IN (${GHOSTS.map(() => '?').join(',')}) AND region IN (${GATE_IDS.map(() => '?').join(',')}))` : '';
  const GATE_GHOST_ARGS = GATE_IDS.length ? GHOSTS.concat(GATE_IDS) : [];
  // 백귀야행 중에는 내 몬스터 중 잡귀가 아닌 것을 목록에서 뺍니다 (공통 S·SS·폭주·괴담 몬스터는 그대로)
  const nightListSql = now => nightOnly(now) ? { sql: ` AND NOT (owner_id IS NOT NULL AND name NOT IN (${GHOSTS.map(() => '?').join(',')}))`, args: GHOSTS } : { sql: '', args: [] };
  return { on, refresh, brief, tick, onKill, cleanup, lossLog, mode: modeNow, nightOnly, nightListSql, EMBER, GHOST_SET, isGhostInGate, GATE_GHOST_SQL, GATE_GHOST_ARGS };
}

module.exports = { install, MASKS, MASK_SLOT, RUMOR_TPL, SQL, EMBER, GHOSTS, START, END };
