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
// 잡귀 출몰 주기 (분). 평소 몬스터(G.TIERS)와 같되 C·B와 A만 이벤트용으로 짧게 조정
const GHOST_GAP_MIN = { f: 1, low: 5, mid: 10, high: 30 };
const GHOST_CAP = 20;                                        // 헌터 한 명에게 동시에 떠 있는 잡귀 수 상한

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
const STORY_FIRST = Date.parse('2026-10-20T00:00:00Z');       // 사연 1번이 열리는 날(한국 날짜 10월 20일) → 10월 23일에 4번, 10월 27일에 마지막 8번
const storyDayN = day => Math.floor((Date.parse(day + 'T00:00:00Z') - STORY_FIRST) / (24 * HOUR));
const storyIdx = day => Math.max(0, Math.min(STORY.length - 1, storyDayN(day)));      // 하루에 한 편씩, 8번이 마지막 (그 뒤로는 8번 귀신이 계속 소원을 말하고 사연은 더 열리지 않음)

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
// 귀신의 집 방 모음(83곳). 방마다 선택지는 셋(안전 → 보통 → 위험 순)이고, 선택 효과는 모든 방이 같습니다.
//   안전: 불씨 0~1 · 오염 0 / 보통: 불씨 1~2 · 오염 2 / 위험: 불씨 2~4 · 오염 4
// 집에 들어갈 때마다 이 중 5곳이 무작위로 뽑힙니다 (같은 집의 두 사람은 같은 방 순서).
const HR = (title, text, a, b, c) => ({ title, text, ch: [
  { n: a[0], e: [0, 1], t: 0, res: a[1] }, { n: b[0], e: [1, 2], t: 2, res: b[1] }, { n: c[0], e: [2, 4], t: 4, res: c[1] }] });
const HOUSE_ROOMS = [
  HR('대문 앞', '빈집의 대문이 저절로 열린다. 안쪽에서 푸른 불빛이 흔들린다.',
    ['문밖에서 안을 살핀다', '아무 일도 없었지만, 문틈으로 누군가의 눈이 마주쳤다.'], ['등불을 들고 먼저 들어선다', '등불이 흔들릴 때마다 벽 그림자가 한 걸음씩 따라왔다.'], ['대문을 박차고 뛰어든다', '집 전체가 숨을 들이쉬듯 떨렸다.']),
  HR('안방의 거울', '안방 한가운데 낡은 거울이 서 있다. 거울 속 방은 이쪽보다 조금 더 어둡다.',
    ['거울을 천으로 덮는다', '천 아래에서 무언가 천천히 손바닥을 갖다 댔다.'], ['거울 속 자신과 눈을 맞춘다', '거울 속의 얼굴이 한 박자 늦게 웃었다.'], ['거울 뒤를 들춰 본다', '거울 뒤에는 벽이 없었다. 다만 오래된 복도가 이어져 있었다.']),
  HR('부엌의 솥', '식은 솥 안에서 아직도 무언가 끓는 소리가 난다.',
    ['솥뚜껑을 열지 않고 지나간다', '등 뒤에서 뚜껑이 한 번 들썩였다.'], ['국자로 휘저어 본다', '국자 끝에 걸린 것은 오래된 구리 방울 하나였다.'], ['솥 속에 손을 넣는다', '손끝에 닿은 것이 가만히 손가락을 쥐었다 놓았다.']),
  HR('마루 밑의 방울', '마루 밑에서 방울 소리가 규칙적으로 울린다.',
    ['소리가 멎길 기다린다', '방울 소리는 한참 뒤에야 천천히 멀어졌다.'], ['방울을 따라 기어든다', '어둠 속에서 방울을 쥔 작은 손이 먼저 길을 열어 주었다.'], ['마루를 뜯어낸다', '뜯긴 마루 아래에서 빛바랜 신발 수십 켤레가 쏟아졌다.']),
  HR('다락방', '다락방 문이 열려 있고, 혼례복 한 벌이 가만히 걸려 있다.',
    ['혼례복에 절을 올린다', '혼례복의 소매가 답하듯 가볍게 흔들렸다.'], ['소매 속을 더듬어 본다', '소매 속에서 마른 꽃잎처럼 바스러지는 편지가 나왔다.'], ['혼례복을 걸쳐 입는다', '옷깃이 몸에 감기자, 누군가의 웃음소리가 방 안에 가득 찼다.']),
  HR('우물가', '집 뒤뜰의 우물에서 물 긷는 소리가 난다. 두레박이 혼자 오르내린다.',
    ['멀찍이 서서 지켜본다', '두레박은 한참을 오르내리다 제자리에 멈췄다.'], ['두레박줄을 잡아당긴다', '줄 끝에서 누군가 같은 힘으로 맞잡아 당겼다.'], ['우물 안으로 몸을 숙인다', '수면에 비친 얼굴이 이쪽보다 먼저 고개를 들었다.']),
  HR('장독대', '장독대의 항아리 뚜껑들이 하나씩 달그락거린다.',
    ['뚜껑 위에 돌을 올려 둔다', '돌을 올리자 달그락거림이 잦아들었다.'], ['가장 큰 항아리를 두드려 본다', '두드린 만큼 안에서 똑같은 횟수로 답이 돌아왔다.'], ['항아리 속을 들여다본다', '어둠 속에서 눈동자 여러 쌍이 한꺼번에 깜빡였다.']),
  HR('곳간', '곳간 문 틈새로 쌀알 쏟아지는 소리가 흘러나온다.',
    ['문을 닫아 걸고 돌아선다', '빗장 너머에서 쌀알 소리가 조용히 멎었다.'], ['쌀독 뚜껑을 살짝 연다', '쌀독 바닥에 누군가의 손바닥 자국이 선명했다.'], ['쌀 속에 팔을 깊이 넣는다', '쌀 속에서 차가운 손이 팔목을 한 번 쥐었다 놓았다.']),
  HR('뒷간', '뒷간 문이 반쯤 열려 있고, 안에서 헛기침 소리가 난다.',
    ['헛기침으로 답하고 지나친다', '답하는 소리에 안쪽의 기척이 만족한 듯 잦아들었다.'], ['문을 두드려 본다', '두드린 만큼 안에서도 똑같이 두드려 왔다.'], ['문을 활짝 열어젖힌다', '텅 빈 칸 안에 방금까지 누군가 앉아 있던 온기가 남아 있었다.']),
  HR('사당', '사당의 위패들이 모두 벽 쪽으로 돌려져 있다.',
    ['향을 하나 피우고 물러난다', '향 연기가 위패 쪽으로 곧게 빨려 들어갔다.'], ['위패 하나를 바로 세운다', '바로 세운 위패 뒤에서 낮은 한숨이 새어 나왔다.'], ['위패를 전부 돌려놓는다', '마지막 위패를 돌리는 순간 사당의 모든 문이 닫혔다.']),
  HR('행랑채', '행랑채 방마다 불이 켜져 있지만 사람 그림자는 하나뿐이다.',
    ['불이 꺼진 방으로 들어간다', '어둠 속 방은 의외로 따뜻했고 아무도 없었다.'], ['그림자가 비친 창호지를 두드린다', '창호지 너머의 그림자가 천천히 이쪽으로 돌아앉았다.'], ['그림자가 있는 방문을 연다', '방 안에는 그림자만 앉아 있고 주인은 없었다.']),
  HR('그네', '안마당의 그네가 바람도 없이 크게 흔들린다.',
    ['그네 곁을 돌아 지나간다', '그네는 뒤에서 한 번 더 크게 흔들리다 멈췄다.'], ['그네 줄을 잡아 멈춘다', '멈춘 그네 위에 눌린 자국이 막 생겨나고 있었다.'], ['그네에 올라 발을 구른다', '그네가 높이 오를수록 담장 너머에서 박수 소리가 일었다.']),
  HR('대청마루', '대청마루에 제사상이 차려져 있다. 수저는 세 벌이다.',
    ['수저 한 벌을 치워 둔다', '치운 자리에 어느새 수저가 다시 놓여 있었다.'], ['상 위의 술을 한 잔 따른다', '따라 놓은 술잔이 조금씩 줄어들었다.'], ['빈자리에 앉아 수저를 든다', '맞은편에서 수저 부딪는 소리가 정확히 박자를 맞췄다.']),
  HR('문갑', '문갑 서랍 하나가 안쪽에서 밀리듯 천천히 열리고 있다.',
    ['서랍을 도로 밀어 닫는다', '닫힌 서랍 안에서 작게 두 번 두드리는 소리가 났다.'], ['열린 틈으로 등불을 비춘다', '빛이 닿자 서랍 속 낡은 가락지가 반짝였다.'], ['서랍을 끝까지 빼 본다', '서랍이 빠진 자리에 또 다른 서랍 칸이 끝없이 이어졌다.']),
  HR('족자', '벽에 걸린 족자 속 여인이 어제와 다른 쪽을 보고 있다.',
    ['족자를 말아 올린다', '말려 올라가는 그림 끝에서 시선이 끝까지 따라왔다.'], ['그림 속 시선을 따라가 본다', '시선이 닿은 구석에서 빛바랜 비녀 하나가 나왔다.'], ['족자 뒤를 뜯어 본다', '뜯긴 종이 뒤에서 또 다른 그림이 눈을 뜨고 있었다.']),
  HR('토굴', '마당 구석 바닥의 판자 아래로 토굴이 입을 벌리고 있다.',
    ['판자를 도로 덮는다', '덮은 판자 아래에서 숨을 내쉬는 소리가 났다.'], ['사다리를 두어 칸 내려간다', '두어 칸 아래에서 오래된 항아리 하나가 발에 닿았다.'], ['끝까지 내려가 불을 밝힌다', '횃불이 닿는 벽마다 손톱 자국이 빽빽했다.']),
  HR('기와지붕', '지붕 위에서 누군가 기와를 밟고 걷는 소리가 난다.',
    ['마당 한가운데서 올려다본다', '소리는 지붕 끝에서 멈추더니 조용히 사라졌다.'], ['지붕 쪽으로 돌을 던진다', '돌이 닿은 기와가 같은 소리로 되던져졌다.'], ['사다리로 지붕에 오른다', '지붕 위에는 발자국만 선명하고 사람은 없었다.']),
  HR('별채', '별채에서 가야금 가락이 끊어질 듯 이어진다.',
    ['문밖에서 끝까지 듣는다', '마지막 음이 끝나자 박수 대신 작은 한숨이 들렸다.'], ['가야금 소리에 맞춰 장단을 친다', '장단이 맞자 현이 한 번 크게 울렸다.'], ['연주자를 향해 문을 연다', '방 안에는 현만 홀로 떨리는 가야금 한 대뿐이었다.']),
  HR('아궁이', '식은 아궁이 속에서 장작 타는 소리가 난다.',
    ['재를 덮고 물러난다', '덮은 재 밑에서 붉은 기운이 천천히 가라앉았다.'], ['부지깽이로 재를 헤친다', '재 속에서 아직 따뜻한 구슬 하나가 굴러 나왔다.'], ['아궁이 안으로 손을 넣는다', '불씨 하나가 손바닥 위로 기어올랐다 사라졌다.']),
  HR('장롱', '닫힌 장롱 안에서 옷자락 스치는 소리가 난다.',
    ['장롱 문에 자물쇠를 건다', '자물쇠를 거는 동안 문이 안쪽에서 한 번 밀렸다.'], ['문틈으로 안을 엿본다', '문틈 사이로 흰 소맷자락이 슬며시 들어갔다.'], ['장롱 문을 활짝 연다', '옷들 사이에서 누군가 한 걸음 물러나는 기척이 났다.']),
  HR('연못', '마당의 연못 수면에 달이 두 개 떠 있다.',
    ['연못가에서 한 걸음 물러선다', '물러서자 두 번째 달이 천천히 가라앉았다.'], ['수면을 손끝으로 건드린다', '파문이 번지자 아래에서 누군가의 손이 마주 닿았다.'], ['연못에 발을 담근다', '발목을 감싼 물이 놀랍도록 따뜻하고 끈적였다.']),
  HR('담장 밑', '담장 밑에 짚으로 엮은 인형들이 줄지어 앉아 있다.',
    ['인형들을 바로 눕혀 준다', '눕혀 놓은 인형이 곧 다시 일어나 앉았다.'], ['인형 하나를 집어 든다', '인형의 가슴께에서 작은 맥박이 느껴졌다.'], ['인형들 사이에 나란히 앉는다', '옆의 인형이 천천히 고개를 어깨에 기대 왔다.']),
  HR('방앗간', '방앗간 절구가 아무도 없이 쿵, 쿵 찧는다.',
    ['박자가 끝나길 기다린다', '박자가 느려지더니 절구가 제자리에 멈췄다.'], ['절구 속을 들여다본다', '절구 속 하얀 가루에서 은은한 빛이 올라왔다.'], ['절굿공이를 직접 잡는다', '공이를 쥔 손 위로 또 다른 손이 포개졌다.']),
  HR('댓돌', '댓돌 위에 신발이 한 켤레씩 늘어나고 있다.',
    ['신발을 가지런히 정리한다', '정리한 신발들이 한 방향으로 앞코를 돌렸다.'], ['낯선 신발에 발을 대 본다', '신발은 발에 꼭 맞았고 바닥이 따뜻했다.'], ['신발을 모두 안고 방으로 간다', '안은 신발들이 한꺼번에 무겁게 숨을 들이쉬었다.']),
  HR('창호지', '창호지에 달빛이 비쳐 손 모양 그림자가 길게 늘어난다.',
    ['창에서 비켜 걷는다', '비켜 걸을 때마다 그림자가 창틀 끝까지만 따라왔다.'], ['그림자에 손을 겹쳐 본다', '겹친 손바닥이 서늘한 감촉과 맞닿았다.'], ['창호지를 손가락으로 뚫는다', '뚫린 구멍 너머에서 눈동자 하나가 이쪽을 보고 있었다.']),
  HR('괘종시계', '복도의 낡은 괘종시계가 열세 번째 종을 친다.',
    ['종소리가 끝나길 기다린다', '열세 번째 종이 잦아들자 복도가 한결 환해졌다.'], ['시계추를 손으로 잡는다', '추가 멈추자 집 안의 모든 소리가 잠시 사라졌다.'], ['시계 문을 열고 안을 본다', '시계 안 톱니마다 작은 손톱이 끼어 있었다.']),
  HR('촛불 복도', '긴 복도에 촛불이 하나씩 차례로 꺼지며 다가온다.',
    ['꺼진 촛불을 다시 켜 준다', '다시 켠 불이 오래도록 꺼지지 않았다.'], ['촛불 하나를 들고 마주 걸어간다', '마주 걷자 꺼지던 불이 이쪽 촛불에서 되살아났다.'], ['남은 촛불을 모두 불어 끈다', '불이 모두 꺼진 뒤 어둠이 천천히 숨을 내쉬었다.']),
  HR('서재', '서재의 고서 한 권이 혼자 책장을 넘기고 있다.',
    ['책을 덮어 제자리에 꽂는다', '꽂힌 책이 책장 안에서 한 번 더 뒤척였다.'], ['펼쳐진 쪽을 읽어 본다', '쪽마다 읽는 순간 글자가 먹물처럼 번져 사라졌다.'], ['마지막 쪽까지 넘겨 본다', '마지막 쪽에는 방금의 내 이름이 막 적히고 있었다.']),
  HR('다듬잇돌', '마루 한쪽에서 다듬이질 소리가 밤새 이어진다.',
    ['소리가 멎을 때까지 기다린다', '새벽닭 대신 다듬이 방망이가 먼저 멈췄다.'], ['다듬잇돌 위에 손을 얹는다', '돌이 맥박처럼 일정하게 울리고 있었다.'], ['방망이를 들어 내리친다', '내리친 자리에서 한 박자 늦은 메아리가 나직이 울렸다.']),
  HR('베틀방', '베틀방의 북이 저 혼자 오가며 흰 천을 짜고 있다.',
    ['짜이는 천을 지켜만 본다', '천은 다 짜이자 얌전히 접혀 선반 위에 올랐다.'], ['짜인 천 끝을 만져 본다', '천 끝이 손끝에서 수의처럼 서늘했다.'], ['북을 붙잡아 멈춘다', '멈춘 북에 감긴 실이 한 올 한 올 손목을 감아 왔다.']),
  HR('부적 문', '문마다 붙은 부적이 한꺼번에 안쪽으로 팔랑인다.',
    ['부적 앞에서 목례한다', '목례하자 부적들이 바깥쪽으로 가라앉았다.'], ['부적 한 장을 떼어 본다', '뗀 자리 뒤의 벽에서 빛바랜 손자국이 드러났다.'], ['부적을 전부 뜯어낸다', '뜯긴 문 너머에서 오래 갇혀 있던 바람이 쏟아졌다.']),
  HR('곳집', '곳집 안에 상여가 놓여 있다. 상여 앞 방울이 가만히 흔들린다.',
    ['방울 소리에 맞춰 고개를 숙인다', '고개를 든 뒤에야 방울이 흔들림을 멈췄다.'], ['상여의 휘장을 걷어 본다', '휘장 안쪽에 아직 마르지 않은 먹글이 붙어 있었다.'], ['상여를 어깨에 멘다', '상여가 어깨 위로 올라타듯 천천히 무거워졌다.']),
  HR('놋그릇', '상 위의 놋그릇에 맑은 물이 가득 담겨 있다. 물에는 아무것도 비치지 않는다.',
    ['그릇을 건드리지 않고 지나간다', '지나간 뒤에서 물이 조용히 한 번 일렁였다.'], ['물 위에 손을 대 본다', '손바닥 아래로 물이 거꾸로 끌어당기듯 움직였다.'], ['그릇의 물을 한 모금 마신다', '마신 물이 목을 타고 오래된 노래 한 소절을 남겼다.']),
  HR('구들장', '방바닥이 유난히 따뜻하다. 구들장 아래에서 무언가 몸을 뒤척인다.',
    ['방 한쪽 구석에 앉아 쉰다', '따뜻한 바닥이 어깨까지 풀어 주듯 데워졌다.'], ['바닥에 귀를 대 본다', '귀 아래에서 느린 숨소리가 천천히 오르내렸다.'], ['구들장 한 장을 들춰 본다', '들춘 틈 아래에서 오래된 신발 한 짝이 올려다보고 있었다.']),
  HR('문풍지', '문풍지가 바람도 없이 바르르 떨린다. 문틈으로 손가락 끝이 보인다.',
    ['문틈을 헝겊으로 막는다', '헝겊 너머에서 손가락이 아쉬운 듯 한참 맴돌았다.'], ['손가락 끝에 손가락을 맞대 본다', '맞댄 끝이 얼음처럼 차갑다가 점점 따뜻해졌다.'], ['문을 확 열어젖힌다', '열린 문 앞에는 아무도 없고 발자국만 안쪽으로 이어졌다.']),
  HR('제기', '제기들이 선반에서 하나씩 내려와 가지런히 줄을 선다.',
    ['제기를 선반 위로 올려 둔다', '올려 둔 제기가 다시 줄 맨 끝으로 내려앉았다.'], ['제기 하나에 물을 부어 본다', '붓는 물이 닿기도 전에 그릇이 먼저 가득 찼다.'], ['줄 선 제기들 사이를 걸어간다', '걸을 때마다 제기들이 한 칸씩 길을 터 주었다.']),
  HR('종이등', '마당 처마에 종이등이 걸려 있다. 등마다 얼굴 모양 무늬가 비친다.',
    ['등불 아래를 서둘러 지난다', '지나친 뒤 모든 등이 일제히 한 번 깜빡였다.'], ['등 하나를 내려 불빛을 비춰 본다', '불빛 속 얼굴이 어딘가 낯익은 표정을 지었다.'], ['등을 모두 한곳에 모아 놓는다', '모인 등이 한꺼번에 환해지며 얼굴들이 입을 모았다.']),
  HR('쌀독 뒤', '쌀독 뒤편의 좁은 틈에서 속삭이는 소리가 난다.',
    ['못 들은 척 지나간다', '지나친 등 뒤에서 속삭임이 한결 가까워졌다.'], ['틈에 귀를 대 본다', '속삭임이 내 이름을 한 글자씩 불러 주었다.'], ['틈 안으로 손을 뻗는다', '손끝에 닿은 것이 조심스럽게 손을 마주 쥐었다.']),
  HR('바느질함', '바느질함에서 바늘귀에 실이 저절로 꿰인다.',
    ['바느질함 뚜껑을 닫는다', '닫은 뚜껑 아래에서 바늘 소리가 잠시 계속됐다.'], ['꿰어진 바늘을 집어 든다', '바늘 끝에 붉은 실이 소매 끝까지 이어져 있었다.'], ['실이 이끄는 대로 따라간다', '실은 복도 끝 닫힌 방문 아래로 스며들고 있었다.']),
  HR('족보', '두루마리 족보에 낯선 이름이 한 줄씩 새로 적히고 있다.',
    ['두루마리를 말아 둔다', '말아 둔 두루마리가 손안에서 한 번 더 꿈틀댔다.'], ['새 이름을 소리 내어 읽는다', '이름을 읽자 방 어딘가에서 대답이 들렸다.'], ['빈 칸에 내 이름을 적어 본다', '적은 이름 곁에 아주 오래된 날짜가 따라 붙었다.']),
  HR('뒷문', '집 뒤편 뒷문이 닫혔다 열렸다 하며 길을 안내하듯 삐걱댄다.',
    ['뒷문을 단단히 걸어 잠근다', '빗장을 지르자 문이 아쉬운 듯 한 번 더 삐걱였다.'], ['문턱까지만 나가 본다', '문턱 너머 달빛 아래 흰 발자국이 이어져 있었다.'], ['뒷문을 나서 발자국을 따라간다', '발자국은 집 한 바퀴를 돌아 제자리로 되돌아왔다.']),
  HR('달빛 마당', '마당 한가운데 달빛이 고여 연못처럼 둥글게 일렁인다.',
    ['달빛 가장자리를 돌아 걷는다', '돌아 걷는 동안 달빛이 발끝을 따라 움직였다.'], ['달빛 한가운데 서 본다', '서 있는 동안 그림자가 둘로 갈라졌다 다시 합쳐졌다.'], ['달빛 위에 누워 눈을 감는다', '눈을 감자 누군가 이마를 쓸어 주는 손길이 느껴졌다.']),
  HR('안방 이불', '안방에 이불이 펴져 있고, 이불 속이 사람 모양으로 불룩하다.',
    ['이불 곁을 살금살금 지나간다', '살금살금 지나는 동안 이불이 한 번 길게 숨을 쉬었다.'], ['이불 끝을 살짝 들춰 본다', '이불 안은 따뜻했고 베개 자리에 머리카락 한 올이 있었다.'], ['이불 속에 들어가 누워 본다', '누운 곁에서 누군가 조용히 자리를 비켜 주었다.']),
  HR('마지막 문', '복도 끝의 문 앞에 서자 문 안쪽에서 똑같이 걸어오는 발소리가 난다.',
    ['문 앞에서 발소리를 세어 본다', '발소리를 세는 사이 안쪽의 걸음도 같은 수에서 멈췄다.'], ['문고리에 손을 얹고 기다린다', '문고리가 반대편에서 같은 온도로 따뜻해졌다.'], ['문을 열고 마주 들어선다', '문 너머에는 조금 전의 복도가 거울처럼 이어져 있었다.']),
  HR('마당 평상', '마당 평상 위에 찻잔 세 개가 놓여 있고, 하나는 아직 김이 오른다.',
    ['찻잔을 건드리지 않고 앉는다', '앉아 있는 동안 김이 천천히 사그라들었다.'], ['김 나는 잔을 들어 향을 맡는다', '향 끝에서 오래전 어느 여름의 냄새가 났다.'], ['남은 찻물을 단숨에 마신다', '마신 순간 맞은편 자리에 누군가 앉았다 일어난 흔적이 남았다.']),
  HR('마구간', '빈 마구간 구유에서 말이 여물 씹는 소리가 난다.',
    ['칸막이 밖에서 귀만 기울인다', '씹는 소리가 문득 멈추고 콧김만 길게 들렸다.'], ['구유 위에 손을 얹어 본다', '구유 나무에 아직 가시지 않은 따뜻함이 배어 있었다.'], ['마구간 문을 열고 들어간다', '빈 칸마다 말발굽 자국이 새로 찍히고 있었다.']),
  HR('대장간', '대장간 모루 위에서 식은 쇠가 혼자 붉게 달아오른다.',
    ['망치를 건드리지 않고 물러난다', '물러서는 동안 쇠의 붉은 기운이 가라앉았다.'], ['풀무를 한 번 밟아 본다', '풀무 바람에 불꽃이 사람 얼굴처럼 일렁였다.'], ['달아오른 쇠를 집게로 집는다', '집게 끝에서 쇠가 낮게 신음하듯 울렸다.']),
  HR('우물 곁 빨래터', '빨랫방망이 소리가 규칙적으로 들리지만 빨래터는 비어 있다.',
    ['소리의 박자를 세며 서 있는다', '박자를 세는 동안 소리가 점점 느려졌다.'], ['널려 있는 흰 천을 만져 본다', '젖은 천 끝에서 물이 거꾸로 올라가고 있었다.'], ['방망이를 집어 천을 내리친다', '내리친 천 아래에서 비명 같은 물소리가 터졌다.']),
  HR('서낭나무 앞', '마을 어귀에 낡은 금줄과 돌무더기가 놓여 있다.',
    ['돌 하나를 더 얹고 목례한다', '얹은 돌이 무더기에 스르르 스며들었다.'], ['금줄을 한 올 풀어 본다', '풀린 금줄 끝이 스스로 다시 꼬여 묶였다.'], ['돌무더기를 걷어차 허문다', '무너진 돌 사이에서 낮은 웃음소리가 올라왔다.']),
  HR('훈장님 서당', '서당에서 아이 목소리들이 천자문을 외우는데 책상은 모두 비었다.',
    ['뒷자리에 조용히 앉는다', '외는 소리가 한 줄 끝나자 칠판 대신 벽이 울렸다.'], ['함께 한 구절을 따라 읽는다', '따라 읽은 구절 끝에서 누군가 정답이라는 듯 손뼉을 쳤다.'], ['훈장 자리에 올라가 앉는다', '앉자마자 모든 소리가 일시에 멎고 시선이 쏠렸다.']),
  HR('초가 아궁이방', '초가 한 채의 방에서 호롱불이 파르르 떨고 있다.',
    ['호롱불을 손으로 가려 준다', '가려 준 불꽃이 안심한 듯 곧게 섰다.'], ['호롱 심지를 돋운다', '돋운 불빛 속에서 벽의 낙서가 한 줄씩 읽혔다.'], ['호롱불을 입으로 불어 끈다', '꺼진 방 안에서 누군가 한숨처럼 고맙다고 속삭였다.']),
  HR('나룻배', '마당 뒤 개울에 나룻배 한 척이 매여 있다. 노는 젖어 있다.',
    ['뱃전에 앉아 물소리만 듣는다', '물소리 사이로 노 젓는 소리가 곁들여졌다.'], ['밧줄을 풀어 본다', '밧줄을 풀자 배가 알아서 개울 가운데로 미끄러졌다.'], ['배에 올라 노를 젓는다', '건너편 둑에서 마주 노를 젓는 그림자가 보였다.']),
  HR('골방', '좁은 골방에 낡은 장난감 몇 점이 가지런히 놓여 있다.',
    ['장난감 줄을 흩트리지 않고 지난다', '지나치자 방 안의 줄이 아주 조금 더 바르게 정돈되었다.'], ['딱지 하나를 집어 본다', '뒷면에 서툴게 쓴 이름 석 자가 번져 있었다.'], ['팽이를 돌려 본다', '팽이가 도는 동안 방 전체가 같은 방향으로 천천히 돌았다.']),
  HR('솟을대문 위', '솟을대문 지붕 아래 편액의 글자가 하나씩 바뀌고 있다.',
    ['글자가 바뀌는 순서를 외워 둔다', '외운 순서대로 글자가 한 바퀴 돌아 처음으로 돌아왔다.'], ['편액을 소리 내어 읽어 본다', '읽는 목소리에 맞춰 글자들이 차례로 밝아졌다.'], ['편액을 떼어 내려 한다', '떼려는 순간 대문 전체가 두 번 깊게 울렸다.']),
  HR('행주 걸린 부엌', '부엌 시렁에 걸린 행주가 아무도 없는데 짜지고 있다.',
    ['행주가 마를 때까지 기다린다', '마른 행주에서 희미하게 비누 냄새가 났다.'], ['행주 끝을 슬쩍 잡아 본다', '잡은 끝이 반대쪽에서 같은 힘으로 비틀렸다.'], ['행주를 대신 짜 준다', '짜낸 물이 바닥에 글씨 모양으로 번졌다.']),
  HR('물레방아', '집 곁 물레방아가 물도 없이 천천히 돌아간다.',
    ['한 바퀴 돌 때까지 지켜본다', '한 바퀴를 돌자 방아가 제풀에 멈췄다.'], ['물레 바퀴살에 손을 얹는다', '바퀴살 사이에서 물소리가 거꾸로 흘렀다.'], ['물레방아를 거꾸로 돌려 본다', '거꾸로 돌자 집 안의 시간이 한 박자 되감겼다.']),
  HR('관 짜는 방', '톱밥 냄새가 짙은 방에 짜다 만 널이 세워져 있다.',
    ['널을 건드리지 않고 지나친다', '지나는 뒤로 대패질 소리가 조용히 이어졌다.'], ['널 위에 손을 얹어 본다', '널이 손바닥 크기만큼 따뜻하게 데워졌다.'], ['널 위에 직접 누워 본다', '누운 위로 보이지 않는 뚜껑이 천천히 내려앉았다.']),
  HR('들창', '높은 들창 틈으로 누군가 방 안을 내려다보고 있다.',
    ['들창에서 보이지 않는 구석에 선다', '구석에 서자 시선이 갈 곳을 잃고 흔들렸다.'], ['들창을 향해 손을 흔들어 본다', '창밖의 손도 같은 박자로 마주 흔들렸다.'], ['의자에 올라 들창을 열어 본다', '열린 창밖에는 같은 방이 거꾸로 매달려 있었다.']),
  HR('약방', '약방 서랍마다 이름 모를 약재가 가득하고 한 칸만 비어 있다.',
    ['약방 문을 도로 닫는다', '닫힌 문 안쪽에서 서랍 닫히는 소리가 이어졌다.'], ['약재 냄새만 맡아 본다', '냄새가 코끝에서 어릴 적 기억을 한 장 넘겼다.'], ['빈 서랍을 열어 안을 만져 본다', '서랍 바닥에 누군가의 손금이 새겨져 있었다.']),
  HR('뜨락 석등', '뜨락의 석등에 불이 저절로 들어왔다 나갔다 한다.',
    ['불이 꺼진 틈에 지나간다', '꺼진 사이에 뒤에서 가볍게 박수 소리가 났다.'], ['석등 앞에 두 손을 모은다', '두 손 사이로 따뜻한 빛이 잠깐 머물렀다.'], ['석등 속을 들여다본다', '불 대신 작은 눈동자 하나가 깜빡이고 있었다.']),
  HR('광목 휘장', '긴 복도에 흰 광목 휘장이 겹겹이 드리워져 있다.',
    ['휘장을 한 겹씩 밀며 나아간다', '밀수록 휘장 뒤의 인영이 한 걸음씩 물러났다.'], ['휘장 하나를 걷어 올려 본다', '올린 휘장 뒤에 같은 복도가 한 번 더 이어졌다.'], ['휘장을 한꺼번에 끌어내린다', '끌어내린 천 아래에서 사람 형상이 서서히 일어났다.']),
  HR('퇴침 베개', '마루 끝에 목침 하나가 놓여 있고 베인 자국이 선명하다.',
    ['목침을 바로 세워 둔다', '세워 둔 목침이 슬며시 다시 누워 버렸다.'], ['목침에 이마를 대 본다', '이마에 닿은 나무에서 느린 숨결이 전해졌다.'], ['목침을 베고 누워 본다', '잠깐 사이 꿈속에서 처음 보는 집의 마당을 걷고 있었다.']),
  HR('숯가마', '마당 구석 숯가마에서 연기 없이 붉은 열기만 올라온다.',
    ['가마 곁에서 손을 쬐어 본다', '따뜻한 열기가 손끝의 한기를 천천히 밀어냈다.'], ['가마 입구의 덮개를 살짝 연다', '덮개 틈으로 붉은 눈빛이 한 번 지나갔다.'], ['가마 안으로 팔을 넣어 본다', '팔에 닿은 열기가 이상하게도 포근히 감쌌다.']),
  HR('죽방울', '대청 구석에서 죽방울 소리가 일정하게 울린다.',
    ['소리에 박자를 맞춰 걷는다', '박자를 맞추는 동안 소리가 한결 부드러워졌다.'], ['죽방울 하나를 들어 본다', '들어 올린 죽방울 속에서 잔잔한 방울이 굴렀다.'], ['죽방울을 힘껏 던져 본다', '던진 방울이 벽에 닿기 전에 누군가의 손바닥에 잡혔다.']),
  HR('울타리 밖', '울타리 밖에서 누군가 이쪽 이름을 부드럽게 반복해 부른다.',
    ['울타리에서 한 걸음 멀어진다', '멀어질수록 목소리가 점점 아쉬운 듯 낮아졌다.'], ['이름을 부르는 쪽으로 대답한다', '대답이 닿자 울타리 틈에서 따뜻한 바람이 불었다.'], ['울타리 문을 열고 나서 본다', '문밖에는 아무도 없고 이쪽 이름만 땅에 쓰여 있었다.']),
  HR('편경 종', '대청 천장에 매달린 작은 종이 바람도 없이 한 번 울린다.',
    ['종소리가 가라앉길 기다린다', '가라앉은 종 곁에서 먼지가 천천히 내려앉았다.'], ['종 끝을 손가락으로 건드린다', '건드린 순간 집 전체가 한 음으로 가볍게 울렸다.'], ['종을 힘껏 쳐 울린다', '울림이 사라진 뒤에도 방 안 어딘가에서 계속 메아리쳤다.']),
  HR('두레 밥상', '두레상 위에 따뜻한 밥 두 그릇이 막 차려져 있다.',
    ['밥그릇에 뚜껑을 덮어 둔다', '덮은 뚜껑 밑에서 김이 작게 들썩였다.'], ['숟가락을 들어 한술 뜬다', '한술 뜬 밥에서 낯선 집의 간이 났다.'], ['두 그릇을 모두 비운다', '빈 그릇 바닥에 감사하다는 글씨가 말라붙어 있었다.']),
  HR('옷고름', '마루 끝에 옷고름 하나가 풀린 채 바람을 타고 흔들린다.',
    ['옷고름을 눈으로만 좇는다', '좇는 사이 고름이 어느새 마루 아래로 숨었다.'], ['옷고름을 집어 매듭을 지어 본다', '매듭이 지어지자 어디선가 작은 한숨이 풀렸다.'], ['고름 끝을 따라 마루 밑으로 기어든다', '마루 밑 어둠 끝에 옷고름의 다른 한쪽이 걸려 있었다.']),
  HR('뒤주', '낡은 뒤주 안에서 누군가 조용히 두드리는 소리가 난다.',
    ['뒤주 뚜껑에 귀를 대 본다', '두드림이 이쪽 박자에 맞춰 천천히 잦아들었다.'], ['두드린 횟수만큼 마주 두드린다', '마주 두드리자 안에서 같은 횟수의 대답이 돌아왔다.'], ['뒤주 뚜껑을 열어젖힌다', '뒤주 안은 비어 있었으나 바닥이 방금 눌린 듯 따뜻했다.']),
  HR('솟대', '마당 한쪽 솟대 위의 나무 새가 천천히 고개를 돌린다.',
    ['솟대 곁을 조심히 지나친다', '지나친 뒤 나무 새가 돌렸던 고개를 되돌렸다.'], ['솟대 밑에 쌀알을 놓아 둔다', '놓아 둔 쌀알이 순식간에 한 톨도 남지 않았다.'], ['솟대를 흔들어 새를 떨어뜨린다', '떨어진 나무 새가 날개를 펴고 어둠 속으로 사라졌다.']),
  HR('흙벽 낙서', '흙벽에 손톱으로 새긴 날짜가 빼곡하고 맨 끝은 오늘이다.',
    ['낙서를 읽지 않고 돌아선다', '돌아선 뒤 벽에서 손톱으로 긁는 소리가 이어졌다.'], ['맨 끝 날짜 곁에 선을 하나 긋는다', '그은 선 옆으로 내일 날짜가 천천히 새겨졌다.'], ['오늘 날짜를 문질러 지운다', '지운 자리에서 날짜가 다시 한 글자씩 솟아났다.']),
  HR('석상', '마당 입구의 돌사자 한 쌍 중 하나가 어느새 자리를 바꿨다.',
    ['돌사자를 제자리로 돌려놓는다', '돌려놓자 돌사자가 안도한 듯 모래를 한 줌 떨궜다.'], ['돌사자의 입안을 들여다본다', '입안에서 작은 구슬이 달그락 굴렀다.'], ['돌사자 등에 올라타 본다', '올라타자 돌사자가 으르렁 대신 낮게 웃었다.']),
  HR('기와 조각', '마당 한쪽에 깨진 기와 조각들이 사람 형상으로 모여 있다.',
    ['조각들을 밟지 않게 피해 간다', '피해 가는 동안 형상이 고개를 따라 돌렸다.'], ['조각 하나를 맞춰 끼워 본다', '끼운 조각이 딱 맞자 형상이 한쪽 팔을 올렸다.'], ['조각들을 모두 발로 흩뜨린다', '흩어진 조각이 우수수 소리 내며 제자리로 되돌아왔다.']),
  HR('달항아리', '대청 한가운데 하얀 달항아리가 놓였는데 그림자가 어긋나 있다.',
    ['항아리 곁을 천천히 한 바퀴 돈다', '한 바퀴를 돌자 그림자가 겨우 항아리와 맞았다.'], ['항아리를 두 손으로 안아 본다', '안은 품 안에서 항아리가 심장처럼 두근거렸다.'], ['항아리를 들어 올려 바닥을 본다', '바닥에 이쪽 얼굴이 작게 새겨진 도장이 찍혀 있었다.']),
  HR('종가 사랑채', '사랑채 윗목에 앉은 노인의 그림자가 맞절을 청하듯 기울어 있다.',
    ['노인의 그림자에 목례한다', '목례하자 그림자가 천천히 바로 섰다.'], ['그림자 앞에 맞절을 올린다', '절을 올리자 방 안의 모든 병풍이 한꺼번에 접혔다.'], ['그림자 곁의 빈 방석에 앉는다', '앉은 방석 위에 오래된 체온이 곧바로 스며들었다.']),
  HR('물동이', '부엌 앞에 물동이가 놓여 있고, 동이 안의 물이 저 혼자 소용돌이친다.',
    ['물이 가라앉을 때까지 기다린다', '가라앉은 물 위에 달 모양 파문이 남았다.'], ['물 한 바가지를 떠 본다', '뜬 물에서 방금 지나간 이의 얼굴이 흐릿했다.'], ['물동이를 통째로 들어 비워 낸다', '쏟아진 물이 바닥에서 길게 복도를 이루었다.']),
  HR('가마터', '마당 끝 가마터에서 흰 도자기 조각이 달빛에 반짝인다.',
    ['조각을 밟지 않고 둘러본다', '둘러보는 동안 조각이 하나씩 더 반짝였다.'], ['가장 큰 조각을 주워 본다', '주운 조각의 뒷면에 어린 손바닥 자국이 있었다.'], ['조각을 맞춰 접시를 만들어 본다', '맞춘 접시 위에 막 담긴 듯 따뜻한 물이 고였다.']),
  HR('지게', '헛간 벽에 기대 놓은 지게가 스스로 짐을 진 것처럼 기울어 있다.',
    ['지게를 바로 세워 놓는다', '세워 놓은 지게가 한 번 더 천천히 기울었다.'], ['지게 위의 짐을 풀어 본다', '짐 보따리 속에서 낡은 신발과 쪽지가 나왔다.'], ['지게를 직접 짊어져 본다', '짊어지자 어깨 위로 누군가 올라탄 듯 무거워졌다.']),
  HR('수묵 병풍', '열 폭 병풍의 그림이 한 폭씩 앞으로 이어져 이야기가 이어진다.',
    ['한 폭씩 지켜보기만 한다', '마지막 폭에 이르자 그림 속 인물이 눈을 감았다.'], ['병풍 끝 폭을 슬쩍 접어 본다', '접힌 폭 뒤에서 낡은 부채 하나가 떨어졌다.'], ['병풍 속 길을 따라 걸어 들어간다', '그림 속 먹빛 길이 발밑에서 서서히 뭉개졌다.']),
  HR('솥뚜껑 소리', '어디선가 솥뚜껑 두드리는 소리가 두 번, 세 번 번갈아 난다.',
    ['귀를 막고 지나간다', '귀를 막아도 소리가 손바닥 사이로 스며들었다.'], ['소리에 맞춰 발을 구른다', '발소리가 겹치자 소리가 한결 부드럽게 이어졌다.'], ['소리가 나는 곳을 찾아 헤맨다', '찾아든 곳엔 솥뚜껑 하나만 가만히 흔들리고 있었다.']),
  HR('회랑', '긴 회랑 기둥마다 오래된 주련이 붙어 있고 한 글자씩 비어 있다.',
    ['주련을 눈으로만 훑고 지난다', '훑고 지난 자리마다 빈 글자가 조금씩 채워졌다.'], ['빈 글자 자리에 손가락으로 획을 그어 본다', '그은 획이 먹빛으로 천천히 번져 글자가 되었다.'], ['주련 한 장을 뜯어 읽어 본다', '뜯긴 주련 뒷면에 이름 한 줄이 빨갛게 번졌다.']),
  HR('마당 우물 뚜껑', '우물 위에 무거운 돌뚜껑이 덮여 있고 틈에서 서늘한 바람이 샌다.',
    ['틈에서 떨어져 선다', '떨어져 서 있는 사이 바람이 한 번 길게 한숨 쉬었다.'], ['돌뚜껑 위에 귀를 대 본다', '아래에서 물 대신 노랫가락이 은은히 올라왔다.'], ['돌뚜껑을 밀어 틈을 넓힌다', '틈이 벌어질 때마다 아래에서 누군가 손가락 하나를 내밀었다.']),
  HR('마지막 방', '끝방 문턱에서 지금까지 지나온 방들의 소리가 한꺼번에 들려온다.',
    ['문턱에 걸터앉아 소리를 정리한다', '정리하는 사이 겹친 소리가 한 줄의 노래로 모였다.'], ['소리 하나를 골라 따라가 본다', '따라간 소리 끝에서 낯익은 웃음이 마중 나왔다.'], ['소리를 모두 가로질러 방으로 든다', '방 안에는 지나온 길의 그림자가 줄지어 배웅하고 있었다.']),
];
const HOUSE_LEN = 5;                                 // 한 번의 탐험에서 지나는 방 수
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
    if (!isNight(now)) { nextAt.set(u.id, Math.min(now + 5 * MIN, nextNightStart(now))); return; }
    const c = nextAt.get(u.id);
    if (c !== undefined && now < c) return;
    // 등급별 출몰 주기: F 1분 · E·D 5분 · C·B 10분 · A 30분 (S·SS는 잡귀로 나오지 않음)
    const hi = Math.max(0, RANKS.indexOf(u.rank));
    const topIdx = Math.min(5, hi + 1);      // 내 등급보다 한 단계 위(최대 A급)까지
    // 잡귀는 한 지역에 몰리지 않고 세계의 여러 지역에 흩어져 나옵니다 (오염 80% 이상 헌터는 들어갈 수 없는 위험 지역을 뺌)
    let tn = 0; try { tn = Number(JSON.parse(u.stats).taint) || 0; } catch (_) { /* 스탯을 못 읽으면 제한 없음 */ }
    const banned = G.taintStage(tn) >= 3;
    const pool = G.SPAWN_REGIONS.filter(r => !(banned && G.TAINT_BAN_DANGER.has(r.danger)));
    const regs = pool.length ? pool : G.SPAWN_REGIONS;
    const rows = await db.all("SELECT tier, next_at FROM user_spawn WHERE user_id = ? AND tier LIKE 'evg%'", [u.id]);
    const have = new Map(rows.map(r => [r.tier, Number(r.next_at)]));
    const ph = GHOSTS.map(() => '?').join(',');
    const live = await db.get(`SELECT COUNT(*) AS c FROM monsters WHERE owner_id = ? AND name IN (${ph}) AND spawned_at > ?
      AND NOT (rank = 'F' AND spawned_at < ?) AND id NOT IN (SELECT monster_id FROM kills WHERE user_id = ?)`,
      [u.id].concat(GHOSTS, [now - G.ACTIVE_MS, now - G.ACTIVE_MS_F, u.id]));
    let room = GHOST_CAP - Number(live.c);
    const list = [];
    let soon = Infinity;
    for (const t of G.TIERS) {
      const ranks = t.ranks.filter(r => r !== 'S' && r !== 'SS' && RANKS.indexOf(r) <= topIdx);
      if (!ranks.length) continue;
      const key = 'evg_' + t.k;
      if (!have.has(key)) await db.run('INSERT OR IGNORE INTO user_spawn (user_id, tier, next_at) VALUES (?, ?, 0)', [u.id, key]);
      const from = have.has(key) ? have.get(key) : 0;
      if (from > now) { soon = Math.min(soon, from); continue; }
      const next = now + (GHOST_GAP_MIN[t.k] || 5) * MIN;
      const claim = await db.run('UPDATE user_spawn SET next_at = ? WHERE user_id = ? AND tier = ? AND next_at = ?', [next, u.id, key, from]);
      soon = Math.min(soon, next);
      if (claim.changes !== 1 || room <= 0) continue;
      room--;
      list.push(['INSERT INTO monsters (region, name, rank, spawned_at, owner_id) VALUES (?, ?, ?, ?, ?)',
        [regs[rnd(0, regs.length - 1)].id, pickGhost(), ranks[rnd(0, ranks.length - 1)], now - list.length, u.id]]);
    }
    nextAt.set(u.id, soon === Infinity ? now + MIN : soon);
    if (list.length) await db.batch(list);
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
      ["DELETE FROM user_spawn WHERE tier LIKE 'evg%'", []],
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
    if (ci === STORY.length - 1 && storyDayN(day) === STORY.length - 1) ember += FINAL_DAY_EMBER;       // 완결편이 처음 열리는 날에만
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
  // 너무 흔해서 가리면 대화가 어려워지는 말만 예외로 둡니다 (그 밖의 선택지 속 단어는 방 설명에 나온 말이어도 가립니다)
  const CENS_WEAK = new Set(['들어', '나가', '지나', '바라', '그냥', '조용', '천천', '다시', '먼저', '아무', '하나', '한번', '가만', '함께', '같이', '모두', '조금', '살짝', '바로', '그대', '이쪽', '저쪽', '안으', '밖으', '위로', '아래', '앞으', '뒤로', '그리', '이렇', '그렇', '어떻', '때까', '않고', '않는', '있는', '없는', '한다', '해서', '하고', '하며']);
  const CENS_PARTICLE = '을를은는이가에로과와도만의';
  const CENS_SEP = '[\\s.\\-_·*~]{0,2}';          // 글자 사이에 공백·점 등을 끼워 넣어도 걸리게 함
  const censSpaced = w => new RegExp(Array.from(w).join(CENS_SEP) + '[가-힣]*', 'g');
  const CENS_GENERIC = [
    ...['선택지', '선택', '옵션', '번호', '안전', '위험', '무난', '과감', '첫번째', '두번째', '세번째'].map(censSpaced),      // 글자 사이를 띄우거나 점을 찍어도 가림
    /[①②③❶❷❸⓵⓶⓷]/g,
    /(?<![0-9.:,])[1-3１-３](?![0-9.:,]|\s*(시|분|명|개|살|층|회|초|일|달|월|배|마리))\S*/g,         // 낱개 숫자 1~3 (시간·개수 말은 제외)
    /(일|이|삼)\s*번\s*(째|으로|꺼|거|것|선택|고르|골|찍)\S*/g, /(두|세)\s*번\s*(째|으로|을|이|가|꺼|거|것|선택|고르|골|찍)\S*/g,
    /(첫|두|세|둘|셋)\s*번\s*째\S*/g, /첫\s*번\S*/g, /(첫|둘|셋)째\S*/g,
    /(맨\s*)?(위|아래|밑|가운데|중간|끝|마지막)\s*(꺼|거|것|쪽|선택|옵션|칸|번)\S*/g, /(위|아래|밑|가운데)\s*에\s*(꺼|거|것)\S*/g,
    /(일|삼)\s*번\S*/g, /번호\S*/g,
    /(선택지?|옵션|보기|항목)\S*/g, /(고른|골랐|고를|고르|골라|찍었|찍을|찍자|찍고)\S*/g,
    /(안전|위험|무난|과감|대담|신중|조심스|모험|안정|도박|소극|적극)\S*/g,
    /(오염|불씨)\s*(이|가|은|는|을|를)?\s*(많|적|낮|높|제일|가장|덜|더|0|2|4)\S*/g,
    /(?<![A-Za-z])[abcABC]\s*(번|안|선택|로|를|을)\S*/g, /\([abcABC]\)/g,
  ];
  const censMask = w => Array.from(w).map((_, i) => CENS_GLYPH[(i * 3 + w.length) % CENS_GLYPH.length]).join('');
  const censStems = HOUSE_ROOMS.map(rm => {
    const stems = new Set();
    rm.ch.forEach(c => c.n.split(/\s+/).forEach(tok => {
      const w = tok.replace(/[^가-힣]/g, '');
      if (w.length < 2) return;
      if (w.length === 2 && CENS_PARTICLE.includes(w[1])) return;      // '문을' 같은 한 글자 낱말 + 조사는 제외
      const st = w.length === 2 ? w : w.slice(0, 2);
      if (!CENS_WEAK.has(st)) stems.add(st);
    }));
    return Array.from(stems).map(st => new RegExp('[가-힣]*' + st[0] + CENS_SEP + st[1] + '[가-힣]*', 'g'));
  });
  const houseCensor = (txt, room) => {
    let hit = false;
    const fix = re => { txt = txt.replace(re, m => { hit = true; return censMask(m); }); };
    (censStems[room] || []).forEach(fix);
    CENS_GENERIC.forEach(fix);
    return { t: txt, cens: hit };
  };
  const houseCh = (r, c) => HOUSE_ROOMS[r].ch[c];
  // 집마다 방 5곳을 무작위로 뽑습니다: 집 번호로 정해지므로 같은 집의 두 사람은 같은 방 순서를 지나고, 새로 들어갈 때마다 다른 조합이 나옵니다.
  const houseRoomIds = h => {
    const r = seeded(hash('house-rooms:' + h.id)), order = HOUSE_ROOMS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    return order.slice(0, HOUSE_LEN);
  };
  const dayKeyH = now => 'house:' + kstDay(now);
  const houseView = (h, uid, now) => {
    const host = h.host_id === uid, log = JSON.parse(h.log || '[]');
    const me = host ? 'a' : 'b', they = host ? 'b' : 'a';
    const partner = host ? { hn: h.ghn, rank: h.grk } : { hn: h.hhn, rank: h.hrk };
    const out = { id: h.id, status: h.status, role: host ? 'host' : 'guest', partner, room: Number(h.room), total: HOUSE_LEN,
      log: log.map(x => { const rm = HOUSE_ROOMS[x.r]; return { title: rm.title, mine: houseCh(x.r, x[me]).n, theirs: houseCh(x.r, x[they]).n, res: houseCh(x.r, x[me]).res, e: x['e' + me], t: x['t' + me], match: !!x.m }; }) };
    if (h.status === 'run') {
      const rm = HOUSE_ROOMS[houseRoomIds(h)[Number(h.room)]];
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
    const out = { on: true, left: await houseLeft(uid, now), max: houseDaily, rooms: HOUSE_LEN, emberName: EMBER, house: null, invite: null };
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
    const cz = houseCensor(txt, houseRoomIds(h)[Number(h.room)]);      // 선택지를 직접 말한 부분은 가려서 저장 (보낸 사람 화면에도 가려진 모습으로 보임)
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
        log.push(houseRoom(h, houseRoomIds(h)[Number(h.room)], Number(h.ca), Number(h.cb)));
        const last = Number(h.room) + 1 >= HOUSE_LEN;
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
