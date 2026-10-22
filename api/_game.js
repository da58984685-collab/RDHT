'use strict';
// 게임 규칙 — 서버만 이 값을 사용해 결과를 결정합니다.
const crypto = require('node:crypto');

const rnd = (a, b) => crypto.randomInt(a, b + 1);          // a~b (양끝 포함)
const chance01 = () => crypto.randomInt(0, 1000000) / 1000000;

// 세계: 12개국(+적월문), 나라마다 세부 지역 9곳. 헌터는 세부 지역에 머물고, F~A급은 그 나라 안의 세부 지역에서 출몰하며,
// S급만 서버 전체가 같은 '나라'에서 출몰합니다. pos 는 레이더(200x200) 위의 좌표입니다.
const P9 = [[28, 36], [96, 26], [162, 40], [30, 84], [104, 76], [168, 92], [34, 132], [98, 126], [158, 138]];
const R = (id, name, sub, icon, danger, pos) => ({ id, name, sub, icon, danger, pos });
// 나라마다 세부 지역 9곳 (레이더 위 위치는 P9 순서)
const mk = (id, name, lat, lon, list) => ({ id, name, lat, lon, regions: list.map((x, i) => R(x[0], x[1], x[2], x[3], x[4], P9[i])) });
const COUNTRIES = [
  mk('KR', '대한민국', 36.5, 127.8, [
    ['city', '도심', '중구 게이트 지대', 'i-city', 'D'], ['mine', '폐광', '북부 지하 갱도', 'i-mine', 'C'], ['river', '한강변', '안개 자욱한 강가', 'i-wave', 'E'],
    ['temple', '산사', '봉인된 옛 절터', 'i-temple', 'B'], ['port', '폐항', '오염된 항만', 'i-port', 'C'], ['gate', '적월 게이트', '붉은 달 아래 균열', 'i-gate', 'A'],
    ['kr-conv', '편의점 골목', '새벽 편의점 앞의 깜빡이는 불빛', 'i-city', 'E'], ['kr-sky', '하늘정원', '고층 옥상에 버려진 정원', 'i-cloud', 'B'], ['kr-mall', '지하상가', '불 꺼진 지하 쇼핑로', 'i-city', 'D']]),
  mk('JP', '일본', 36, 138, [
    ['jp-tokyo', '도쿄 번화가', '네온이 꺼진 게이트 거리', 'i-city', 'D'], ['jp-mine', '이와미 갱도', '폐은광 깊은 곳', 'i-mine', 'C'], ['jp-bay', '오사카만', '녹슨 컨테이너 항구', 'i-port', 'C'],
    ['jp-shrine', '후지 신사', '산기슭의 봉인 신사', 'i-temple', 'B'], ['jp-conv', '심야 편의점', '새벽 두 시의 24시간 매장', 'i-city', 'E'], ['jp-sky', '도쿄 전망대', '구름 위의 관측 데크', 'i-cloud', 'B'],
    ['jp-forest', '아오키가하라', '길을 잃는 푸른 수해', 'i-tree', 'C'], ['jp-onsen', '폐온천', '김이 식지 않는 옛 온천가', 'i-wave', 'D'], ['jp-arcade', '아키하바라 오락실', '꺼지지 않는 게임기 불빛', 'i-city', 'E']]),
  mk('CN', '중국', 35, 104, [
    ['cn-old', '베이징 구시가', '붉은 성벽 아래 균열', 'i-city', 'D'], ['cn-coal', '산시 탄광', '불타는 지하 탄층', 'i-mine', 'C'], ['cn-gorge', '장강 협곡', '물안개 낀 절벽', 'i-wave', 'E'],
    ['cn-temple', '소림 폐사', '무너진 선원', 'i-temple', 'B'], ['cn-night', '상하이 야시장', '불 꺼진 노점 골목', 'i-city', 'E'], ['cn-tower', '상하이 첨탑', '유리 전망대의 균열', 'i-cloud', 'B'],
    ['cn-karst', '계림 봉우리', '안개 속 솟은 석회봉', 'i-mtn', 'C'], ['cn-wall', '만리장성 봉화대', '꺼지지 않는 옛 봉홧불', 'i-rock', 'B'], ['cn-tea', '쓰촨 폐찻집', '식지 않는 찻물의 방', 'i-grass', 'D']]),
  mk('RU', '러시아', 61, 95, [
    ['ru-metro', '모스크바 지하철', '끝없는 지하 승강장', 'i-city', 'D'], ['ru-ural', '우랄 광산', '얼어붙은 갱도', 'i-mine', 'C'], ['ru-port', '블라디보스토크항', '얼음에 갇힌 부두', 'i-port', 'C'],
    ['ru-snow', '시베리아 설원', '눈 속에 열린 균열', 'i-gate', 'A'], ['ru-red', '붉은 광장', '눈 덮인 돌바닥 위의 그림자', 'i-city', 'D'], ['ru-baikal', '바이칼 호수', '얼음 밑에서 올라오는 소리', 'i-wave', 'C'],
    ['ru-bunker', '지하 벙커', '봉인된 냉전기 시설', 'i-mine', 'B'], ['ru-taiga', '타이가 숲', '끝없이 이어진 침엽수림', 'i-tree', 'D'], ['ru-station', '횡단열차 간이역', '멈춰 선 열차', 'i-city', 'E']]),
  mk('US', '미국', 39, -98, [
    ['us-ny', '뉴욕 맨해튼', '무너진 마천루 사이', 'i-city', 'D'], ['us-canyon', '그랜드캐니언', '협곡 아래 폐갱도', 'i-mine', 'C'], ['us-bayou', '미시시피 습지', '늪지에 깔린 안개', 'i-wave', 'E'],
    ['us-desert', '네바다 사막', '모래 위에 열린 균열', 'i-gate', 'A'], ['us-diner', '국도변 다이너', '네온이 깜빡이는 24시간 식당', 'i-city', 'E'], ['us-vegas', '라스베이거스', '꺼진 카지노 거리', 'i-city', 'C'],
    ['us-sky', '시카고 전망대', '유리 바닥 아래의 심연', 'i-cloud', 'B'], ['us-forest', '옐로스톤 숲', '끓는 땅 위의 삼림', 'i-tree', 'D'], ['us-harbor', '샌프란시스코 부두', '안개에 잠긴 해안 다리', 'i-port', 'C']]),
  mk('IT', '이탈리아', 42.5, 12.5, [
    ['it-rome', '로마 유적', '콜로세움 아래 봉인', 'i-temple', 'B'], ['it-venice', '베네치아 수로', '가라앉은 골목길', 'i-wave', 'E'], ['it-genoa', '제노바항', '낡은 범선 부두', 'i-port', 'C'],
    ['it-vesuvius', '베수비오 화구', '끓어오르는 균열', 'i-gate', 'A'], ['it-alps', '돌로미티 설산', '눈 덮인 바위 첨탑', 'i-mtn', 'C'], ['it-cafe', '피렌체 카페 골목', '문 닫힌 에스프레소 바', 'i-city', 'E'],
    ['it-catacomb', '카타콤', '해골이 쌓인 지하 묘지', 'i-mine', 'B'], ['it-tuscany', '토스카나 언덕', '사이프러스가 늘어선 길', 'i-grass', 'E'], ['it-dome', '두오모 지붕', '붉은 돔 위의 바람', 'i-cloud', 'D']]),
  mk('MG', '마다가스카르', -19, 47, [
    ['mg-tsingy', '칭기 석림', '칼날 같은 석회암 숲', 'i-mine', 'C'], ['mg-river', '마하장가 강', '붉은 흙탕물 강', 'i-wave', 'E'], ['mg-baobab', '바오바브 길', '거목 사이에 봉인된 제단', 'i-temple', 'B'],
    ['mg-port', '토아마시나항', '버려진 어선 부두', 'i-port', 'C'], ['mg-lemur', '여우원숭이 숲', '울음소리가 끊긴 우림', 'i-tree', 'D'], ['mg-market', '안타나나리보 시장', '인적 끊긴 언덕 시장', 'i-city', 'E'],
    ['mg-cave', '안카나 동굴', '물이 고인 석회 동굴', 'i-mine', 'C'], ['mg-coast', '모론다바 해안', '노을 진 모래 해변', 'i-wave', 'D'], ['mg-plateau', '이살로 고원', '붉은 암벽의 고원', 'i-mtn', 'B']]),
  mk('BR', '브라질', -10, -52, [
    ['br-rio', '리우 언덕마을', '밤마다 문이 열리는 골목', 'i-city', 'D'], ['br-mine', '미나스 광산', '금빛 지하 갱도', 'i-mine', 'C'], ['br-amazon', '아마존 강', '끝이 보이지 않는 수면', 'i-wave', 'E'],
    ['br-gate', '파라 밀림', '밀림 속 붉은 균열', 'i-gate', 'A'], ['br-beach', '코파카바나', '파도가 멈춘 해변', 'i-wave', 'D'], ['br-sky', '코르코바도 전망대', '구름 속의 거대한 동상', 'i-cloud', 'B'],
    ['br-metro', '상파울루 지하철', '사람 없는 환승 통로', 'i-city', 'C'], ['br-pantanal', '판타나우 습지', '악어가 숨어 있는 늪', 'i-grass', 'D'], ['br-falls', '이구아수 폭포', '물소리에 가려진 비명', 'i-wave', 'C']]),
  mk('EG', '이집트', 26, 30, [
    ['eg-cairo', '카이로 구시가', '미로 같은 시장 골목', 'i-city', 'D'], ['eg-nile', '나일 강변', '고요한 검은 물', 'i-wave', 'E'], ['eg-pyramid', '기자 피라미드', '묘실에 갇힌 저주', 'i-temple', 'B'],
    ['eg-suez', '수에즈 운하', '좌초된 화물선', 'i-port', 'C'], ['eg-luxor', '룩소르 신전', '기둥 사이의 어둠', 'i-temple', 'B'], ['eg-oasis', '시와 오아시스', '야자수 아래의 샘', 'i-grass', 'E'],
    ['eg-bazaar', '칸 엘 칼릴리 시장', '향신료 냄새가 남은 상점가', 'i-city', 'D'], ['eg-sphinx', '스핑크스 광장', '모래 속에서 눈뜬 균열', 'i-gate', 'A'], ['eg-white', '백사막', '하얀 바위가 늘어선 사막', 'i-rock', 'C']]),
  mk('AU', '호주', -25, 134, [
    ['au-sydney', '시드니항', '불 꺼진 오페라 하우스', 'i-port', 'C'], ['au-opal', '쿠버페디 광산', '지하 오팔 갱도', 'i-mine', 'C'], ['au-reef', '대보초', '죽어 가는 산호 군락', 'i-wave', 'E'],
    ['au-outback', '아웃백', '붉은 사막의 균열', 'i-gate', 'A'], ['au-uluru', '울루루', '붉은 거석 아래의 울림', 'i-rock', 'B'], ['au-mel', '멜버른 골목 카페', '낙서 가득한 뒷골목', 'i-city', 'E'],
    ['au-rain', '데인트리 우림', '고대 숲의 짙은 안개', 'i-tree', 'D'], ['au-bridge', '하버브리지 전망대', '아치 위의 바람', 'i-cloud', 'C'], ['au-road', '그레이트 오션 로드', '절벽 해안 도로', 'i-wave', 'D']]),
  mk('IN', '인도', 22, 79, [
    ['in-delhi', '델리 구시가', '좁은 골목의 끝없는 시장', 'i-city', 'D'], ['in-ganges', '갠지스 강변', '재가 떠다니는 강가', 'i-wave', 'E'], ['in-taj', '타지마할', '대리석 돔 아래의 균열', 'i-temple', 'B'],
    ['in-mumbai', '뭄바이 항구', '녹슨 크레인이 선 부두', 'i-port', 'C'], ['in-thar', '타르 사막', '모래 위에 열린 균열', 'i-gate', 'A'], ['in-himalaya', '히말라야 기슭', '눈보라 속의 오래된 길', 'i-mtn', 'C'],
    ['in-spice', '향신료 시장', '매운 연기가 자욱한 시장', 'i-city', 'E'], ['in-ellora', '엘로라 석굴', '바위를 깎아 만든 사원', 'i-mine', 'B'], ['in-tea', '다르질링 찻밭', '안개 낀 계단식 찻밭', 'i-grass', 'D']]),
  mk('FR', '프랑스', 46.5, 2.5, [
    ['fr-paris', '파리 뒷골목', '가로등이 꺼진 석조 골목', 'i-city', 'D'], ['fr-seine', '센강', '다리 아래로 흐르는 검은 물', 'i-wave', 'E'], ['fr-museum', '지하 미술관', '봉인된 전시실', 'i-temple', 'B'],
    ['fr-marseille', '마르세유항', '어선이 가라앉은 부두', 'i-port', 'C'], ['fr-montblanc', '몽블랑', '얼음 틈에 열린 균열', 'i-gate', 'A'], ['fr-vine', '보르도 포도밭', '붉게 익은 포도 사이', 'i-grass', 'E'],
    ['fr-catacomb', '파리 지하묘지', '뼈로 쌓은 터널', 'i-mine', 'C'], ['fr-eiffel', '에펠탑 전망대', '철골 위의 붉은 달', 'i-cloud', 'B'], ['fr-cafe', '심야 카페', '문 닫을 시간이 없는 카페', 'i-city', 'E']]),
  // 적월문: 일본 동쪽 먼바다 위의 구역. 문으로 들어가면 안쪽 지역 가운데 한 곳으로 무작위 이동합니다.
  { id: 'GT', name: '적월문', lat: 35, lon: 155, gate: true, regions: [
    R('gt-hill', '푸른 언덕', '바람이 부는 풀밭 언덕', 'i-grass', 'E', [60, 120]), R('gt-ridge', '바위 골짜기', '깎아지른 바위벽 사이의 골짜기', 'i-rock', 'D', [140, 70]),
    R('gt-peak', '구름 봉우리', '구름을 두른 먼 산', 'i-mtn', 'C', [100, 45]), R('gt-wood', '외딴 숲길', '홀로 선 나무들의 길', 'i-tree', 'D', [50, 60]),
    R('gt-field', '최초의 게이트', '무너진 건물이 늘어선 거리', 'i-city', 'B', [140, 140]), R('gt-lake', '푸른 바다', '파도가 닿는 해안 절벽', 'i-wave', 'C', [95, 150])] },
];
const COUNTRY_BY_ID = Object.fromEntries(COUNTRIES.map(c => [c.id, c]));
const REGIONS = COUNTRIES.flatMap(c => c.regions.map(r => Object.assign({}, r, { country: c.id })));
// 적월문(gate)은 몬스터가 나타나지 않는 안전 지역입니다
const SPAWN_COUNTRIES = COUNTRIES.filter(c => !c.gate);
const SPAWN_REGIONS = REGIONS.filter(r => !COUNTRY_BY_ID[r.country].gate);
const REGION_BY_ID = Object.fromEntries(REGIONS.map(r => [r.id, r]));
const countryOf = id => (REGION_BY_ID[id] ? REGION_BY_ID[id].country : COUNTRY_BY_ID[id] ? id : 'KR');
// 나라 또는 세부 지역의 이름 (S급은 나라, F~A급은 세부 지역에서 출몰)
const placeName = id => (COUNTRY_BY_ID[id] ? COUNTRY_BY_ID[id].name : REGION_BY_ID[id] ? REGION_BY_ID[id].name : String(id || ''));
// 세부 지역 이름에 나라 이름을 붙여 보여줍니다
const placeLong = id => (REGION_BY_ID[id] ? COUNTRY_BY_ID[REGION_BY_ID[id].country].name + ' · ' + REGION_BY_ID[id].name : placeName(id));

const MON = {
  F: ['오염된 쥐떼', '허깨비'],
  E: ['도깨비 변이체', '오염체'],
  D: ['그림자 늑대', '강시 무리', '귀화 군집'],
  C: ['야차', '구미호 분신'],
  B: ['이무기 유체', '불가사리'],
  A: ['백귀야행', '천년 야차왕'],
  S: ['혈귀 장군', '달그림자 무녀', '천년 구렁이', '저승의 사냥개', '철갑 도깨비왕', '낙뢰 해태'],
  SS: ['적월의 군주', '흑룡 이무기',
    '혈월의 여왕', '천공의 심판자', '심연의 군주', '만귀의 왕', '백골 제왕', '멸망의 불새',
    '대지를 삼키는 자', '폭풍의 용왕', '서리 마녀', '지옥문의 수문장', '붉은 달의 사도', '천 개의 눈'],
};

const MIN = 60000, HOUR = 3600000;
// 등급 묶음별 출몰 주기
const TIERS = [
  { k: 'f',    ranks: ['F'],           gap: () => 1 * MIN },
  { k: 'low',  ranks: ['E', 'D'],      gap: () => 5 * MIN },
  { k: 'mid',  ranks: ['C', 'B'],      gap: () => 30 * MIN },
  { k: 'high', ranks: ['A'],           gap: () => rnd(60, 120) * MIN },
  { k: 's',    ranks: ['S'],           gap: () => rnd(120, 240) * MIN },
  { k: 'top',  ranks: ['SS'],          gap: () => 8 * HOUR },
];
const ACTIVE_MS = 30 * MIN;
const ACTIVE_MS_F = 5 * MIN;                      // F급만 예외: 5분 안에 토벌하지 않으면 사라짐
const ACTIVE_MS_S = 24 * HOUR;                    // S급은 24시간 동안 출현 (토벌되지 않으면 사라짐)
const activeMsOf = rank => (rank === 'F' ? ACTIVE_MS_F : rank === 'SS' ? ACTIVE_MS_S : ACTIVE_MS);
// 명성: 전투력(레벨)이 오를 때, 헌터 등급이 오를 때만 함께 오릅니다 (시작은 항상 0)
const STAT_RESET_BASE = 1500, STAT_RESET_PER = 100;                 // 스탯 일괄 초기화: 기본 요금 + 되돌려 받는 포인트 1개당 골드
const statResetCost = (t) => t > 0 ? STAT_RESET_BASE + t * STAT_RESET_PER : 0;
const STAT_MAX = 100, FAME_MAX = 1000;                             // 근력·민첩·행운 최대치 / 명성 최대치
const FAME_PER_LV = 5, FAME_PER_RANK = 20;                       // 출몰 후 토벌 가능한 시간

// 등급별 처치 골드(G) 범위 [최소, 최대]
// 몬스터 토벌 골드: 기본값의 60% (40% 감소)
const GOLD_RATE = 0.6;
const KILL_GOLD = Object.fromEntries(Object.entries({ F: [1, 5], E: [6, 15], D: [16, 35], C: [36, 70], B: [71, 120], A: [121, 180], S: [181, 195], SS: [190, 200] }).map(([k, v]) => [k, [Math.max(1, Math.round(v[0] * GOLD_RATE)), Math.max(1, Math.round(v[1] * GOLD_RATE))]]));
const rollGold = rank => { const r = KILL_GOLD[rank] || [0, 0]; return r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1)); };
// 업적 종류: always(항상) · kills(처치 수) · rank(해당 등급 이상 처치) · sTry(S급 도전 수) · sWin(S급 처치 수) · lv(전투력 레벨) · manual(관리자가 직접 부여)
const RANK_IDX = { F: 0, E: 1, D: 2, C: 3, B: 4, A: 5, S: 6, SS: 7 };   // SS 는 몬스터 전용 (헌터 등급은 S 까지)
// 새 종류: visit(지역/나라:횟수 방문) · visits(전체 이동 횟수) · countries(방문한 나라 수) · collect(아이템:수집 개수) · slay(몬스터 이름:처치 수)
//          surveys(적월문 조사 횟수) · crafts(조합 횟수) · fails(토벌 실패 횟수) · friends(친구 수) · gifts(보낸 선물 횟수)
//          gold(보유 골드) · fame(명성) · taint(오염도) · hrank(헌터 등급 이상) · stat(근력/민첩/행운:값)
const ACH_KINDS = ['always', 'kills', 'rank', 'sTry', 'sWin', 'lv', 'manual',
  'visit', 'visits', 'countries', 'collect', 'slay', 'surveys', 'crafts', 'fails', 'friends', 'gifts', 'gold', 'fame', 'taint', 'hrank', 'stat'];
const ACH_COMPOUND = ['visit', 'collect', 'slay', 'stat'];       // 값이 '대상:숫자' 형태인 종류
const ACH_NUM = ['kills', 'sTry', 'sWin', 'lv', 'visits', 'countries', 'surveys', 'crafts', 'fails', 'friends', 'gifts', 'gold', 'fame', 'taint'];
// 처음 서버가 켜질 때 한 번만 넣는 기본 업적 (이후에는 관리자가 자유롭게 수정·삭제)
const ACH_SEED = [
  { id: 'reg',  name: '헌터 등록',   desc: '게이트 앞에서 헌터로 등록했다.', kind: 'always', val: '' },
  { id: 'k1',   name: '첫 사냥',     desc: '몬스터를 처음으로 처치했다.',     kind: 'kills', val: '1' },
  { id: 'k10',  name: '초보 사냥꾼', desc: '몬스터를 10마리 처치했다.',       kind: 'kills', val: '10' },
  { id: 'k50',  name: '숙련 사냥꾼', desc: '몬스터를 50마리 처치했다.',       kind: 'kills', val: '50' },
  { id: 'k200', name: '붉은 달의 학살자', desc: '몬스터를 200마리 처치했다.', kind: 'kills', val: '200' },
  { id: 'rC',   name: 'C급 토벌',    desc: 'C급 이상 몬스터를 처치했다.',     kind: 'rank', val: 'C' },
  { id: 'rA',   name: 'A급 토벌',    desc: 'A급 이상 몬스터를 처치했다.',     kind: 'rank', val: 'A' },
  { id: 'sTry', name: 'SS급 도전',   desc: 'SS급 몬스터 토벌에 도전했다.',     kind: 'sTry', val: '1' },
  { id: 'sWin', name: 'SS급 토벌자', desc: 'SS급 몬스터를 처치했다.',          kind: 'sWin', val: '1' },
  { id: 'lv5',  name: '전투력 Lv.5',  desc: '전투력 5레벨을 달성했다.',       kind: 'lv', val: '5' },
  { id: 'lv10', name: '전투력 Lv.10', desc: '전투력 10레벨을 달성했다.',      kind: 'lv', val: '10' },
  { id: 'lv20', name: '전투력 Lv.20', desc: '전투력 20레벨을 달성했다.',      kind: 'lv', val: '20' },
];
// 두 번째 기본 업적 묶음 (이미 운영 중인 서버에도 한 번만 추가됩니다. 이후에는 관리자가 자유롭게 수정·삭제)
const ACH_SEED2 = [
  { id: 'v-tokyo', name: '네온 아래의 단골', desc: '도쿄 번화가를 100번 방문했다.', kind: 'visit', val: 'jp-tokyo:100' },
  { id: 'v-gate', name: '문지기의 벗', desc: '적월문에 20번 드나들었다.', kind: 'visit', val: 'GT:20' },
  { id: 'v-first', name: '최초의 목격자', desc: '최초의 게이트를 15번 찾았다.', kind: 'visit', val: 'gt-field:15' },
  { id: 'v-river', name: '한강의 밤 산책', desc: '한강변을 30번 방문했다.', kind: 'visit', val: 'river:30' },
  { id: 'v-ny', name: '잠들지 않는 도시', desc: '뉴욕 맨해튼을 30번 방문했다.', kind: 'visit', val: 'us-ny:30' },
  { id: 'v-pyr', name: '파라오의 손님', desc: '기자 피라미드를 10번 방문했다.', kind: 'visit', val: 'eg-pyramid:10' },
  { id: 'vs50', name: '떠돌이 헌터', desc: '지역을 50번 옮겨 다녔다.', kind: 'visits', val: '50' },
  { id: 'vs300', name: '역마살', desc: '지역을 300번 옮겨 다녔다.', kind: 'visits', val: '300' },
  { id: 'cn8', name: '세계 일주', desc: '서로 다른 8개 나라를 방문했다.', kind: 'countries', val: '8' },
  { id: 'cn11', name: '지도의 끝', desc: '모든 나라와 적월문을 방문했다.', kind: 'countries', val: '11' },
  { id: 'c-herb', name: '약초꾼', desc: '약초를 20개 수집했다.', kind: 'collect', val: '약초:20' },
  { id: 'c-bottle', name: '공병 수집가', desc: '빈 공병을 20개 수집했다.', kind: 'collect', val: '빈 공병:20' },
  { id: 'c-fluid', name: '체액 채집가', desc: '몬스터의 체액을 20개 수집했다.', kind: 'collect', val: '몬스터의 체액:20' },
  { id: 'c-twig', name: '땔감 장인', desc: '나뭇가지를 50개 수집했다.', kind: 'collect', val: '나뭇가지:50' },
  { id: 'c-flower', name: '꽃을 아끼는 헌터', desc: '들꽃을 15송이 수집했다.', kind: 'collect', val: '들꽃:15' },
  { id: 'c-water', name: '샘물 지킴이', desc: '맑은 샘물을 20개 수집했다.', kind: 'collect', val: '맑은 샘물:20' },
  { id: 'sv30', name: '호기심 많은 탐험가', desc: '적월문에서 30번 조사했다.', kind: 'surveys', val: '30' },
  { id: 'sv100', name: '느낌표 중독', desc: '적월문에서 100번 조사했다.', kind: 'surveys', val: '100' },
  { id: 'cr5', name: '초보 연금술사', desc: '아이템을 5번 조합했다.', kind: 'crafts', val: '5' },
  { id: 'cr30', name: '붉은 달의 연금술사', desc: '아이템을 30번 조합했다.', kind: 'crafts', val: '30' },
  { id: 's-ghost', name: '허깨비 사냥꾼', desc: '허깨비를 30마리 처치했다.', kind: 'slay', val: '허깨비:30' },
  { id: 's-rat', name: '쥐잡이 명인', desc: '오염된 쥐떼를 30번 처치했다.', kind: 'slay', val: '오염된 쥐떼:30' },
  { id: 's-wolf', name: '늑대 무리의 적', desc: '그림자 늑대를 20마리 처치했다.', kind: 'slay', val: '그림자 늑대:20' },
  { id: 'fl10', name: '넘어져도 일어나는 자', desc: '토벌에 10번 실패하고도 계속 나섰다.', kind: 'fails', val: '10' },
  { id: 'fl50', name: '칠전팔기', desc: '토벌에 50번 실패했다. 그래도 멈추지 않는다.', kind: 'fails', val: '50' },
  { id: 'fr3', name: '든든한 동료들', desc: '친구를 3명 만들었다.', kind: 'friends', val: '3' },
  { id: 'gf5', name: '선물의 달인', desc: '친구에게 선물을 5번 보냈다.', kind: 'gifts', val: '5' },
  { id: 'gd1k', name: '두둑한 주머니', desc: '골드를 1,000 G 이상 모았다.', kind: 'gold', val: '1000' },
  { id: 'tt50', name: '붉은 달에 물든 자', desc: '오염도가 50% 이상이 되었다.', kind: 'taint', val: '50' },
  { id: 'fm100', name: '이름이 알려진 헌터', desc: '명성 100을 달성했다.', kind: 'fame', val: '100' },
  { id: 'fm500', name: '전설의 이름', desc: '명성 500을 달성했다.', kind: 'fame', val: '500' },
  { id: 'hE', name: 'E급 헌터', desc: '헌터 등급이 E급 이상이 되었다.', kind: 'hrank', val: 'E' },
  { id: 'hD', name: 'D급 헌터', desc: '헌터 등급이 D급 이상이 되었다.', kind: 'hrank', val: 'D' },
  { id: 'hC', name: 'C급 헌터', desc: '헌터 등급이 C급 이상이 되었다.', kind: 'hrank', val: 'C' },
  { id: 'hB', name: 'B급 헌터', desc: '헌터 등급이 B급 이상이 되었다.', kind: 'hrank', val: 'B' },
  { id: 'hA', name: 'A급 헌터', desc: '헌터 등급이 A급 이상이 되었다.', kind: 'hrank', val: 'A' },
  { id: 'hS', name: 'S급 헌터', desc: '헌터 등급이 S급에 올랐다.', kind: 'hrank', val: 'S' },
  { id: 'st-str', name: '괴력', desc: '근력이 50이 되었다.', kind: 'stat', val: 'str:50' },
  { id: 'st-agi', name: '바람의 발걸음', desc: '민첩이 50이 되었다.', kind: 'stat', val: 'agi:50' },
  { id: 'st-luck', name: '행운아', desc: '행운이 50이 되었다.', kind: 'stat', val: 'luck:50' },
];
// 세 번째 기본 업적 묶음 (독특한 업적 20개: 앞의 15개는 꾸준히 하면 얻고, 마지막 5개는 매우 어렵습니다. 이미 운영 중인 서버에도 한 번만 추가됩니다)
const ACH_SEED3 = [
  { id: 'u-mush', name: '겁 없는 미식가', desc: '독버섯을 25개 수집했다. 아마 익혀 먹었을 것이다.', kind: 'collect', val: '독버섯:25' },
  { id: 'u-pearl', name: '조개 속의 행운', desc: '진주를 3개 수집했다.', kind: 'collect', val: '진주:3' },
  { id: 'u-clover', name: '네잎 클로버 농장주', desc: '네잎 클로버를 5개 수집했다.', kind: 'collect', val: '네잎 클로버:5' },
  { id: 'u-dew', name: '구름 위의 이슬 한 방울', desc: '구름 이슬을 8개 수집했다.', kind: 'collect', val: '구름 이슬:8' },
  { id: 'u-key', name: '열쇠고리 수집가', desc: '오래된 열쇠를 4개 수집했다. 어디 문인지는 아무도 모른다.', kind: 'collect', val: '오래된 열쇠:4' },
  { id: 'u-seal', name: '문지기의 눈 밖에 난 자', desc: '수문장의 인장을 3개 모았다.', kind: 'collect', val: '수문장의 인장:3' },
  { id: 'u-yasha', name: '야차의 악몽', desc: '야차를 15마리 처치했다.', kind: 'slay', val: '야차:15' },
  { id: 'u-snake', name: '이무기의 천적', desc: '이무기 유체를 12마리 처치했다.', kind: 'slay', val: '이무기 유체:12' },
  { id: 'u-fox', name: '꼬리 아홉 중 하나', desc: '구미호 분신을 15마리 처치했다.', kind: 'slay', val: '구미호 분신:15' },
  { id: 'u-catacomb', name: '해골들의 이웃', desc: '파리 지하묘지를 25번 방문했다.', kind: 'visit', val: 'fr-catacomb:25' },
  { id: 'u-conv', name: '심야 편의점의 상주객', desc: '편의점 골목을 40번 방문했다. 삼각김밥은 늘 같은 맛이다.', kind: 'visit', val: 'kr-conv:40' },
  { id: 'u-sky', name: '높은 곳이 좋아', desc: '하늘정원을 30번 방문했다.', kind: 'visit', val: 'kr-sky:30' },
  { id: 'u-arcade', name: '동전이 마르지 않는 자', desc: '아키하바라 오락실을 40번 방문했다.', kind: 'visit', val: 'jp-arcade:40' },
  { id: 'u-craft', name: '가마솥의 주인', desc: '아이템을 100번 조합했다.', kind: 'crafts', val: '100' },
  { id: 'u-friends', name: '인맥왕', desc: '친구를 10명 만들었다.', kind: 'friends', val: '10' },
  // ── 어려운 업적 5개 ──
  { id: 'u-core', name: '적월의 심장을 훔친 자', desc: '적월의 핵을 2개 모았다. 적월문 가장 깊은 곳에서만 나온다.', kind: 'collect', val: '적월의 핵:2' },
  { id: 'u-luck100', name: '운명이 먼저 인사하는 자', desc: '행운을 100까지 끌어올렸다.', kind: 'stat', val: 'luck:100' },
  { id: 'u-fame', name: '불멸의 이름', desc: '명성을 최대치인 1000까지 올렸다.', kind: 'fame', val: '1000' },
  { id: 'u-rich', name: '붉은 달의 부호', desc: '골드를 100,000 G 이상 모았다.', kind: 'gold', val: '100000' },
  { id: 'u-k1000', name: '천 번째 사냥', desc: '몬스터를 1000마리 처치했다.', kind: 'kills', val: '1000' },
];
// 헌터 등급 승급: F→E, E→D 는 전투력(레벨)만 오르면 됩니다. D→C 부터는 처치 기록 등 조건이 더해지고, 위로 갈수록 어려워집니다.
//  kills: [{ min: 해당 등급 이상 몬스터, n: 처치 수 }], sTry: S급 토벌 도전 횟수, taintMax: 오염도(%) 이하여야 함
const PROMO = {
  F: { to: 'E', lv: 5 },
  E: { to: 'D', lv: 8 },
  D: { to: 'C', lv: 15, kills: [{ min: 'D', n: 20 }] },
  C: { to: 'B', lv: 22, kills: [{ min: 'C', n: 35 }, { min: 'B', n: 8 }] },
  B: { to: 'A', lv: 28, kills: [{ min: 'B', n: 50 }, { min: 'A', n: 10 }] },
  A: { to: 'S', lv: 33, kills: [{ min: 'A', n: 40 }], sTry: 3, taintMax: 40 },
};
const ACH_PIN_MAX = 3;
// 등급별 오염도(%) 상승 범위 [최소, 최대] (0.1% 단위)
const KILL_TAINT = { F: [9, 11], E: [11, 13], D: [13, 16], C: [16, 20], B: [20, 25], A: [25, 30], S: [28, 34], SS: [30, 40] };   // F급은 평균 10%: 토벌 10회에 오염도 100% (정화 필요)
const TAINT_SCALE = 0.485;   // 오염도 상승량 50% 감소 (이전 0.97 의 절반)
const rollTaint = rank => {
  const r = KILL_TAINT[rank] || [0, 0], lo = Math.round(r[0] * 10), hi = Math.round(r[1] * 10);
  return Math.round((lo + Math.floor(Math.random() * (hi - lo + 1))) * TAINT_SCALE) / 10;
};
// 오염도가 높은 헌터가 보낸 메신저는 받는 쪽에서 일부 글자가 깨져 보입니다 (메시지 번호로 고정되어 새로고침해도 같은 모양)
const GARBLE = ['▒', '░░', '▒', '▓▓', '▓'];
const garble = (text, taint, id) => {
  const t = Number(taint) || 0;
  if (t < 20) return text;
  const p = Math.min(0.65, t / 100 * 0.6);
  let a = (Number(id) * 2654435761 + 12345) >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  return Array.from(String(text)).map(ch => (/\s/.test(ch) ? ch : (rnd() < p ? GARBLE[Math.floor(rnd() * GARBLE.length)] : ch))).join('');
};
// 전투력(레벨) 상승 속도: 기본 경험치의 70% (30% 감소)
const EXP_RATE = 0.7;
const KILL_EXP = Object.fromEntries(Object.entries({ F: 8, E: 12, D: 20, C: 35, B: 60, A: 120, S: 200, SS: 300 }).map(([k, v]) => [k, Math.round(v * EXP_RATE)]));
const HUNT_DIFF = { F: '쉬움', E: '쉬움', D: '쉬움', C: '보통', B: '보통', A: '어려움', S: '매우 어려움', SS: '매우 어려움' };
const HUNT_BASE = { '쉬움': 0.85, '보통': 0.65, '어려움': 0.4, '매우 어려움': 0.25 };

const RAID_NEED = 100;                             // S급 자동 토벌 성공: 서로 다른 참여 헌터 수
const RAID_ATTEMPTS = 300;                         // S급 자동 토벌 성공: 도전(토벌) 횟수 합계 (중복 포함)
const S_MAX = 3;                                   // S급 1시간당 도전 횟수
const S_WINDOW_MS = HOUR;
const S_WAIT_MS = Number(process.env.S_RESULT_DELAY_MS) || 24 * HOUR;   // S급 결과 공개까지

// 전투력 레벨업에 필요한 경험치. 30레벨까지는 기존보다 훨씬 빠르게 오르고, 30레벨부터는 기존 그대로입니다.
const powNeed = lv => Math.max(10, Math.round(30 * Math.pow(lv, 1.6) * (lv < 30 ? 0.1 + 0.3 * Math.pow(lv / 30, 1.5) : 1)));

function cdOf(r) {
  return r === 'F' || r === 'E' ? 1 * MIN
    : r === 'D' || r === 'C' ? rnd(3, 5) * MIN
    : r === 'B' ? 10 * MIN : 15 * MIN;
}

// 성공 확률. S급은 서버 전체 참여 인원(participants)에 따라 달라집니다.
// 모든 확률은 값이 어떻든 95%를 넘지 않습니다.
const PROB_CAP = 0.95;
const capP = p => Math.max(0, Math.min(PROB_CAP, p));
// 스탯 효과 (1포인트당): 근력 = 토벌 성공 확률 +1%p, 민첩 = 실패 시 체력 차감 방지 +3%p, 행운 = 시간 제한 없이 재토벌 1회 +3%p
const STR_WIN = 0.01, AGI_GUARD = 0.03, LUCK_FREE = 0.03;
const guardChance = agi => capP((Number(agi) || 0) * AGI_GUARD);
const freeChance = luck => capP((Number(luck) || 0) * LUCK_FREE);
function huntChance(r, lv, participants, str) {
  if (r === 'SS') {
    const lb = Math.min(0.1, (lv - 1) * 0.01);
    const p = 0.05 + 0.9 * Math.min(1, participants / RAID_NEED) + lb + (Number(str) || 0) * STR_WIN;
    return Math.max(0.05, capP(p));
  }
  const p = HUNT_BASE[HUNT_DIFF[r]] + Math.min(0.12, (lv - 1) * 0.015) + (Number(str) || 0) * STR_WIN;
  return Math.max(0.05, capP(p));
}

// 체력: 100에서 시작. 토벌에 실패하면 등급에 따라 줄고(최대 20), 5 아래로는 내려가지 않습니다.
// 5 이하가 되면 빈사 상태로 5분간 토벌할 수 없고, 5분 뒤 체력 10으로 돌아옵니다. 그 외에는 저절로 회복되지 않습니다.
const HP_START = 100, HP_MIN = 5, HP_DYING_MS = 5 * MIN, HP_REVIVE = 10;
const HP_LOSS = { F: [1, 3], E: [2, 5], D: [4, 7], C: [6, 10], B: [9, 13], A: [12, 17], S: [14, 18], SS: [16, 20] };
const hpLoss = rank => { const r = HP_LOSS[rank] || [1, 3]; return Math.min(20, rnd(r[0], r[1])); };

function rollRank() {
  const r = chance01();
  return r < 0.5 ? 'F' : r < 0.65 ? 'E' : r < 0.8 ? 'D' : r < 0.875 ? 'C' : r < 0.95 ? 'B' : 'A';
}
// 등급별 시작 스탯: 체력은 항상 100. 근력·민첩·행운은 기본 1~9이고, 등급에 따라 일부가 더 높게 시작합니다.
//  F: 모두 한 자리 / E: 10~12 한 개 / D: 10~12 두 개 / C: 13~15 한 개 / B: 15~16 한 개 / A: 18~20 한 개 / S: 20~21 두 개
const STAT_TIER = { F: [0, 0, 0], E: [1, 10, 12], D: [2, 10, 12], C: [1, 13, 15], B: [1, 15, 16], A: [1, 18, 20], S: [2, 20, 21] };
function rollStats(rank) {
  const [n, lo, hi] = STAT_TIER[rank] || STAT_TIER.F;
  const keys = ['str', 'agi', 'luck'], high = new Set();
  while (high.size < n) high.add(keys[rnd(0, 2)]);
  const out = { hp: HP_START };
  keys.forEach(k => { out[k] = high.has(k) ? rnd(lo, hi) : rnd(1, 9); });
  out.taint = 0; out.fame = 0; out.sp = 0;      // sp: 투자하지 않은 스탯포인트 (전투력 레벨이 1 오를 때마다 1)
  return out;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  let out;
  do {
    out = Array.from({ length: 8 }, () => CODE_CHARS[crypto.randomInt(0, CODE_CHARS.length)]).join('');
  } while (!/[A-Z]/.test(out) || !/[0-9]/.test(out));
  return out.slice(0, 4) + '-' + out.slice(4);
}

// 경험치를 더하고 레벨업을 처리합니다.
function addExp(lv, exp, gain) {
  exp += gain;
  let up = false;
  while (exp >= powNeed(lv)) { exp -= powNeed(lv); lv++; up = true; }
  return { lv, exp, up };
}

// ── 적월문 조사 재료 · 조합법 ──
// 재료: [이름, 설명, 흔함(가중치), {지역: 가중치}]  (지역 가중치가 없으면 모든 지역에서 아주 드물게 나옴)
const SV_MARKS = { 'gt-hill': 4, 'gt-ridge': 3, 'gt-peak': 5, 'gt-wood': 4, 'gt-field': 5, 'gt-lake': 3 };   // 지역마다 보이는 '!' 개수 (3~5개)
const MATERIALS = [
  { name: '약초', desc: '쓴 향이 나는 풀. 상처에 바르면 좋다.', w: 10, at: { 'gt-hill': 5, 'gt-wood': 4, 'gt-peak': 1 } },
  { name: '나뭇가지', desc: '마른 나뭇가지. 어디에나 쓸모가 있다.', w: 10, at: { 'gt-wood': 5, 'gt-hill': 3, 'gt-field': 2 } },
  { name: '빈 공병', desc: '깨끗이 비워진 유리병. 물약을 담을 수 있다.', w: 9, at: { 'gt-field': 5, 'gt-lake': 3, 'gt-ridge': 2 } },
  { name: '몬스터의 체액', desc: '끈적하고 냄새가 지독한 체액.', w: 9, at: { 'gt-field': 3, 'gt-wood': 3, 'gt-ridge': 3, 'gt-hill': 2, 'gt-lake': 2, 'gt-peak': 2 } },
  { name: '들꽃', desc: '언덕에 핀 작은 꽃. 은은한 향이 난다.', w: 8, at: { 'gt-hill': 6, 'gt-peak': 1 } },
  { name: '야생 열매', desc: '새콤달콤한 붉은 열매.', w: 8, at: { 'gt-wood': 5, 'gt-hill': 3 } },
  { name: '맑은 샘물', desc: '차갑고 깨끗한 물.', w: 7, at: { 'gt-peak': 4, 'gt-hill': 3, 'gt-ridge': 2 } },
  { name: '이끼', desc: '바위에 낀 촉촉한 이끼.', w: 8, at: { 'gt-ridge': 5, 'gt-wood': 3 } },
  { name: '독버섯', desc: '화려한 갓을 가진 위험한 버섯.', w: 6, at: { 'gt-wood': 5, 'gt-ridge': 1 } },
  { name: '부싯돌', desc: '두 번 부딪치면 불꽃이 튄다.', w: 7, at: { 'gt-ridge': 4, 'gt-peak': 3 } },
  { name: '철광석 조각', desc: '검붉은 쇳덩이 조각.', w: 6, at: { 'gt-ridge': 4, 'gt-field': 3 } },
  { name: '새의 깃털', desc: '가볍고 부드러운 깃털.', w: 8, at: { 'gt-peak': 5, 'gt-hill': 3 } },
  { name: '짐승의 뼈', desc: '단단하게 굳은 오래된 뼈.', w: 7, at: { 'gt-field': 4, 'gt-wood': 3, 'gt-ridge': 1 } },
  { name: '낡은 천조각', desc: '누군가 입던 옷의 조각.', w: 8, at: { 'gt-field': 5, 'gt-wood': 1 } },
  { name: '녹슨 못', desc: '삭아서 부러지기 직전의 못.', w: 7, at: { 'gt-field': 5 } },
  { name: '소금', desc: '하얗게 굳은 바다 소금.', w: 8, at: { 'gt-lake': 6 } },
  { name: '조개껍데기', desc: '결이 고운 하얀 조개껍데기.', w: 7, at: { 'gt-lake': 5 } },
  { name: '해초', desc: '짭짤한 냄새가 나는 해초.', w: 8, at: { 'gt-lake': 5 } },
  { name: '구름 이슬', desc: '봉우리 구름에서 맺힌 맑은 이슬.', w: 4, at: { 'gt-peak': 5 } },
  { name: '수정 파편', desc: '희미하게 빛나는 투명한 조각.', w: 3, at: { 'gt-peak': 3, 'gt-ridge': 3 } },
  { name: '네잎 클로버', desc: '찾기 어려운 행운의 풀.', w: 2, at: { 'gt-hill': 4 } },
  { name: '진주', desc: '은은한 빛을 내는 둥근 진주.', w: 2, at: { 'gt-lake': 4 } },
  { name: '적월석 가루', desc: '붉게 빛나는 돌의 가루. 어디서든 아주 드물게 발견된다.', w: 1, at: {} },
  { name: '오래된 열쇠', desc: '무엇을 여는지 알 수 없는 낡은 열쇠.', w: 2, at: { 'gt-field': 3 } },
];

// ── 적월문 심층 탐험(50층) 전용 재료: 구간(10층)마다 일반·희귀·영웅 재료가 있고, 30층부터 전설 재료가 아주 드물게 나옵니다. (현장 조사에서는 나오지 않음)
const GATE_ZONES = [
  { name: '입구 회랑', boss: '문지기 석상' }, { name: '붉은 수로', boss: '수룡' }, { name: '잿빛 서고', boss: '금서의 사서' },
  { name: '심연의 정원', boss: '그림자 정원사' }, { name: '적월의 심장', boss: '적월의 주인' },
];
const GATE_MATS = [
  { name: '붉은 석재 조각', desc: '입구 회랑의 벽에서 떨어진 붉은 돌조각.', tier: 'c', zone: 0 },
  { name: '낡은 문양판', desc: '오래된 문양이 새겨진 석판.', tier: 'r', zone: 0 },
  { name: '수문장의 인장', desc: '문지기 석상이 지니고 있던 인장.', tier: 'e', zone: 0 },
  { name: '수로의 이끼구슬', desc: '붉은 물에서 자란 이끼가 구슬처럼 뭉쳤다.', tier: 'c', zone: 1 },
  { name: '붉은 물방울', desc: '굳지 않는 붉은 물방울.', tier: 'r', zone: 1 },
  { name: '수룡의 비늘', desc: '수룡의 몸에서 떨어진 단단한 비늘.', tier: 'e', zone: 1 },
  { name: '찢어진 서책', desc: '글자가 반쯤 지워진 책장.', tier: 'c', zone: 2 },
  { name: '잉크 병', desc: '마르지 않는 검은 잉크가 든 병.', tier: 'r', zone: 2 },
  { name: '금서의 표지', desc: '읽으면 안 되는 책의 가죽 표지.', tier: 'e', zone: 2 },
  { name: '심연의 꽃잎', desc: '어둠 속에서만 피는 꽃의 잎.', tier: 'c', zone: 3 },
  { name: '그림자 열매', desc: '손에 쥐면 그림자처럼 흐려지는 열매.', tier: 'r', zone: 3 },
  { name: '심연의 씨앗', desc: '심연의 정원사가 가꾸던 검은 씨앗.', tier: 'e', zone: 3 },
  { name: '월광 가루', desc: '붉은 달빛이 굳어 생긴 가루.', tier: 'c', zone: 4 },
  { name: '적월의 눈물', desc: '붉은 달이 흘린 듯한 맑은 방울.', tier: 'r', zone: 4 },
  { name: '적월의 심장 파편', desc: '적월의 주인에게서 떨어진 붉은 파편.', tier: 'e', zone: 4 },
  { name: '월식의 조각', desc: '달이 가려지던 순간을 담은 전설의 조각.', tier: 'l', zone: 4, special: true },
  { name: '균열난 기둥 파편', desc: '금이 간 회랑 기둥에서 떨어진 파편.', tier: 'c', zone: 0 },
  { name: '먼지 낀 촛대', desc: '오래전 꺼진 촛불의 받침.', tier: 'c', zone: 0 },
  { name: '청동 문고리', desc: '회랑 문에 달려 있던 묵직한 청동 고리.', tier: 'r', zone: 0 },
  { name: '봉인 부적 조각', desc: '반쯤 찢어진 봉인 부적.', tier: 'r', zone: 0 },
  { name: '석상의 눈동자', desc: '문지기 석상의 눈에 박혀 있던 검은 보석.', tier: 'e', zone: 0 },
  { name: '문지기의 열쇠', desc: '모든 문을 연다고 전해지는 낡은 열쇠.', tier: 'l', zone: 0 },
  { name: '녹슨 쇠사슬', desc: '붉은 물에 잠겨 삭은 쇠사슬.', tier: 'c', zone: 1 },
  { name: '젖은 부적', desc: '물에 젖어도 글씨가 번지지 않는 부적.', tier: 'c', zone: 1 },
  { name: '붉은 산호', desc: '수로 바닥에서 자란 붉은 산호.', tier: 'r', zone: 1 },
  { name: '물귀신의 머리카락', desc: '젖은 채 엉킨 검은 머리카락.', tier: 'r', zone: 1 },
  { name: '수룡의 송곳니', desc: '수룡의 입에서 빠진 날카로운 송곳니.', tier: 'e', zone: 1 },
  { name: '붉은 조류의 핵', desc: '붉은 물살의 중심에서 건진 맥동하는 핵.', tier: 'l', zone: 1 },
  { name: '곰팡이 핀 두루마리', desc: '펼치면 재가 날리는 두루마리.', tier: 'c', zone: 2 },
  { name: '부러진 깃펜', desc: '잉크가 아직 마르지 않은 깃펜.', tier: 'c', zone: 2 },
  { name: '봉인된 책갈피', desc: '끼워 둔 페이지가 영영 열리지 않는 책갈피.', tier: 'r', zone: 2 },
  { name: '재가 된 양피지', desc: '손대면 부서지지만 글자는 남아 있는 양피지.', tier: 'r', zone: 2 },
  { name: '사서의 안경', desc: '서고의 사서가 쓰던 둥근 안경.', tier: 'e', zone: 2 },
  { name: '금서의 심장', desc: '금서 안에서 뛰고 있던 검붉은 덩어리.', tier: 'l', zone: 2 },
  { name: '시든 덩굴', desc: '검게 말라붙은 덩굴.', tier: 'c', zone: 3 },
  { name: '검은 이슬', desc: '정원 잎사귀에 맺힌 새까만 이슬.', tier: 'c', zone: 3 },
  { name: '달빛 가시', desc: '달빛을 머금어 은은히 빛나는 가시.', tier: 'r', zone: 3 },
  { name: '그림자 뿌리', desc: '땅 밑 그림자 속에서 자란 뿌리.', tier: 'r', zone: 3 },
  { name: '정원사의 가위', desc: '그림자 정원사가 쓰던 커다란 가위.', tier: 'e', zone: 3 },
  { name: '심연의 왕관 조각', desc: '정원의 왕이 쓰던 왕관의 깨진 조각.', tier: 'l', zone: 3 },
  { name: '붉은 재', desc: '적월의 열기에 타고 남은 붉은 재.', tier: 'c', zone: 4 },
  { name: '굳은 월광', desc: '굳어서 돌이 된 달빛.', tier: 'c', zone: 4 },
  { name: '핏빛 수정', desc: '안쪽에서 붉은 빛이 일렁이는 수정.', tier: 'r', zone: 4 },
  { name: '월식의 깃털', desc: '달이 가려질 때만 떨어지는 검은 깃털.', tier: 'r', zone: 4 },
  { name: '주인의 손톱', desc: '적월의 주인의 손톱. 만지면 맥이 뛴다.', tier: 'e', zone: 4 },
  { name: '적월의 핵', desc: '적월의 심장 한가운데 박혀 있던 핵.', tier: 'l', zone: 4 },
];

// ── 오염 거래(계약): 오염도를 대가로 보상을 받습니다. 하루에 계약마다 한 번. ──
const PACTS = [
  { id: 'p_gold1', name: '그림자 상인의 흥정', desc: '어둠 속 상인이 금화를 내미는 대신 몸 안의 탁기를 거래한다.', taint: 6, gold: 400 },
  { id: 'p_fame', name: '명예 매매', desc: '누군가의 명성을 사 오는 대가로 오염이 쌓인다.', taint: 8, fame: 4 },
  { id: 'p_exp', name: '피의 서약', desc: '핏빛 서약서에 이름을 쓰면 경험이 몸에 스며든다.', taint: 10, exp: 150 },
  { id: 'p_str', name: '부패한 부적', desc: '썩은 부적을 몸에 지니면 힘이 솟는다.', taint: 12, stat: 'str', amt: 2 },
  { id: 'p_agi', name: '그림자 걸음', desc: '그림자가 발끝을 끌어 걸음이 가벼워진다.', taint: 12, stat: 'agi', amt: 2 },
  { id: 'p_luck', name: '심연의 속삭임', desc: '귓가의 속삭임을 따르면 운이 트인다.', taint: 12, stat: 'luck', amt: 2 },
  { id: 'p_mat', name: '금단의 재료상', desc: '금지된 거래로 적월석 가루를 넘겨받는다.', taint: 15, item: '적월석 가루', qty: 2 },
  { id: 'p_gold2', name: '악마의 지갑', desc: '끝없이 금화가 쏟아지는 지갑. 그만큼 깊이 오염된다.', taint: 20, gold: 1500 },
];
const PACT_BACKLASH = 0.2, PACT_BACKLASH_TAINT = 5;     // 계약의 반동: 20% 확률로 오염도가 추가로 5 더 오름
// ── 도시 괴담: 소문이 돌고, 믿는 사람이 모이면 진실 여부가 가려집니다. ──
const RUMOR_NEED = 3, RUMOR_OPEN_MS = 6 * HOUR, RUMOR_GAP_MS = 90 * MIN, RUMOR_MAX_OPEN = 2;
const RUMOR_TPL = [
  { t: '{p}의 입 찢어진 여자', mon: '입 찢어진 여자', rank: 'B', body: '해 질 녘 {p} 골목에서 마스크 쓴 여자가 "나 예뻐?" 하고 묻는다는 소문입니다.', hoax: '마스크를 쓴 채 길을 묻던 평범한 행인이었다고 합니다.' },
  { t: '{p}의 밤마다 우는 아이', mon: '울음귀', rank: 'B', body: '밤이면 {p} 근처에서 아이 울음소리가 들리는데, 가 보면 아무도 없다고 합니다.', hoax: '길고양이의 울음소리를 잘못 들은 것이었습니다.' },
  { t: '{p}의 열세 번째 계단', mon: '열세 번째 계단의 그것', rank: 'A', body: '{p}의 계단은 분명 열두 개인데, 밤에 올라가면 하나가 더 있다고 합니다.', hoax: '계단 수를 잘못 센 것이었습니다. 몇 번을 세어도 열두 개입니다.' },
  { t: '{p}의 없는 층', mon: '없는 층의 주민', rank: 'B', body: '{p}의 엘리베이터에서 존재하지 않는 층 버튼이 눌린다는 소문이 돕니다.', hoax: '고장 난 엘리베이터 버튼의 오작동이었다고 합니다.' },
  { t: '{p}의 거울 속 또 다른 나', mon: '거울 속의 나', rank: 'A', body: '{p}의 거울 앞에서 한 박자 늦게 웃는 "나"를 봤다는 사람이 늘고 있습니다.', hoax: '낡은 거울의 반사 지연일 뿐이었습니다.' },
  { t: '{p}의 새벽 3시 전화박스', mon: '수화기 너머의 목소리', rank: 'C', body: '새벽 3시, {p}의 낡은 전화박스가 혼자 울린다는 소문입니다.', hoax: '전화박스 안에서 울린 건 누군가의 잃어버린 휴대폰이었습니다.' },
  { t: '{p}의 끝나지 않는 막차', mon: '막차의 승객', rank: 'B', body: '{p}에서 막차를 타면 종점에 닿지 않고 계속 달린다고 합니다.', hoax: '졸다가 종점을 지나친 취객의 이야기가 부풀려진 것이었습니다.' },
  { t: '{p}의 웃는 인형', mon: '웃는 인형', rank: 'C', body: '{p}의 오래된 가게 진열장에서 밤마다 인형의 표정이 바뀐다는 소문입니다.', hoax: '진열장 조명이 흔들려 그렇게 보인 것이었습니다.' },
];
const EVENT = require('./_event');      // [EVENT:HALLOWEEN] 이벤트 데이터 (api/_event.js)
RUMOR_TPL.push(...EVENT.RUMOR_TPL);         // [EVENT:HALLOWEEN] 이벤트 소문 (이벤트가 꺼지면 새로 만들어지지 않음)
// 보상표: 소문에 어떻게 표를 던졌고 결과가 어떻게 되었는가
const RUMOR_REWARD = { believeTrue: { gold: 150, exp: 30 }, doubtFalse: { gold: 80, exp: 20 }, believeFalse: { gold: -100, exp: 0 } };

// ── 장비: 탑 재료로만 조합할 수 있고, 상점·몬스터에서는 얻을 수 없습니다. ──
// 등급(C~S)에 따라 성능과 내구도가 달라집니다. 내구도는 토벌을 한 번 할 때마다(성공·실패 모두) 착용 중인 장비마다 1씩 줄고, 0이 되면 효과가 사라집니다(수리하면 복구).
const EQ_GRADE = {
  C: { dur: 30, repair: 150, k: 1 },
  B: { dur: 50, repair: 400, k: 2 },
  A: { dur: 80, repair: 900, k: 3.4 },
  S: { dur: 120, repair: 2000, k: 5.4 },
};
// 부위마다 올려 주는 능력과 등급별 수치 [C, B, A, S]
const EQ_SLOTS = {
  weapon: { ko: '무기', stat: 'str', ko_stat: '근력', v: [3, 6, 10, 16], unit: '' },
  armor: { ko: '방어구', stat: 'hpGuard', ko_stat: '체력 피해 감소', v: [10, 18, 28, 40], unit: '%' },
  head: { ko: '머리', stat: 'luck', ko_stat: '행운', v: [2, 4, 7, 11], unit: '' },
  boots: { ko: '신발', stat: 'agi', ko_stat: '민첩', v: [3, 6, 10, 16], unit: '' },
  acc: { ko: '장신구', stat: 'taintRes', ko_stat: '오염도 증가 감소', v: [8, 15, 24, 35], unit: '%' },
  mask: EVENT.MASK_SLOT,      // [EVENT:HALLOWEEN] 가면 (능력치는 장비마다 bonus 로 지정)
};
const EQUIPS = [
  { id: 'e_w1', name: '회랑의 석제 단검', slot: 'weapon', grade: 'C', desc: '기둥 파편을 갈아 만든 투박한 단검.', mats: { '균열난 기둥 파편': 4, '먼지 낀 촛대': 1, '붉은 석재 조각': 3 } },
  { id: 'e_w2', name: '수룡의 송곳니 창', slot: 'weapon', grade: 'B', desc: '수룡의 송곳니를 창끝에 박았다.', mats: { '수룡의 송곳니': 1, '녹슨 쇠사슬': 3, '붉은 산호': 2, '나뭇가지': 4 } },
  { id: 'e_w3', name: '정원사의 가위검', slot: 'weapon', grade: 'A', desc: '거대한 가위를 한 자루 검으로 벼렸다.', mats: { '정원사의 가위': 1, '달빛 가시': 3, '시든 덩굴': 4, '철광석 조각': 3 } },
  { id: 'e_w4', name: '금서의 필검', slot: 'weapon', grade: 'A', desc: '금서의 글귀가 칼날에 번지는 가는 검.', mats: { '금서의 심장': 1, '부러진 깃펜': 3, '재가 된 양피지': 3, '철광석 조각': 2 } },
  { id: 'e_w5', name: '적월의 대검', slot: 'weapon', grade: 'S', desc: '붉은 달의 힘이 깃든 거대한 검.', mats: { '적월의 핵': 1, '주인의 손톱': 2, '핏빛 수정': 3, '월식의 조각': 1 } },
  { id: 'e_a1', name: '석재 흉갑', slot: 'armor', grade: 'C', desc: '석재를 이어 붙인 무거운 흉갑.', mats: { '붉은 석재 조각': 5, '균열난 기둥 파편': 3, '낡은 천조각': 3 } },
  { id: 'e_a2', name: '촛대 방패', slot: 'armor', grade: 'C', desc: '촛대 받침을 펴 만든 작은 방패.', mats: { '먼지 낀 촛대': 3, '녹슨 쇠사슬': 2, '녹슨 못': 4 } },
  { id: 'e_a3', name: '산호 비늘 갑옷', slot: 'armor', grade: 'B', desc: '산호와 비늘 조각을 엮은 갑옷.', mats: { '붉은 산호': 3, '물귀신의 머리카락': 2, '수로의 이끼구슬': 4, '낡은 천조각': 3 } },
  { id: 'e_a4', name: '재의 사서 외투', slot: 'armor', grade: 'A', desc: '타다 남은 양피지를 겹겹이 누빈 외투.', mats: { '사서의 안경': 1, '재가 된 양피지': 4, '봉인된 책갈피': 2, '곰팡이 핀 두루마리': 4 } },
  { id: 'e_a5', name: '심연의 갑주', slot: 'armor', grade: 'S', desc: '심연의 왕관 조각을 박은 검은 갑주.', mats: { '심연의 왕관 조각': 1, '그림자 뿌리': 3, '정원사의 가위': 1, '심연의 씨앗': 2 } },
  { id: 'e_h1', name: '청동 문고리 투구', slot: 'head', grade: 'C', desc: '문고리를 녹여 만든 단단한 투구.', mats: { '청동 문고리': 2, '균열난 기둥 파편': 3, '낡은 천조각': 2 } },
  { id: 'e_h2', name: '봉인 부적 두건', slot: 'head', grade: 'B', desc: '부적 조각을 덧댄 두건. 눈앞이 맑아진다.', mats: { '봉인 부적 조각': 3, '젖은 부적': 3, '새의 깃털': 3, '낡은 천조각': 2 } },
  { id: 'e_h3', name: '통찰의 안경', slot: 'head', grade: 'A', desc: '사서의 안경에 수정을 끼운 안경.', mats: { '사서의 안경': 1, '수정 파편': 3, '봉인된 책갈피': 2, '금서의 표지': 1 } },
  { id: 'e_h4', name: '심연의 왕관', slot: 'head', grade: 'S', desc: '깨진 왕관을 다시 이어 붙인 왕관.', mats: { '심연의 왕관 조각': 1, '달빛 가시': 3, '그림자 열매': 3, '심연의 꽃잎': 4 } },
  { id: 'e_b1', name: '쇠사슬 장화', slot: 'boots', grade: 'C', desc: '쇠사슬을 감은 투박한 장화.', mats: { '녹슨 쇠사슬': 3, '낡은 천조각': 3, '짐승의 뼈': 2 } },
  { id: 'e_b2', name: '월식의 깃털 신발', slot: 'boots', grade: 'B', desc: '검은 깃털이 달린 가벼운 신발.', mats: { '월식의 깃털': 3, '새의 깃털': 4, '굳은 월광': 2, '낡은 천조각': 2 } },
  { id: 'e_b3', name: '그림자 뿌리 각반', slot: 'boots', grade: 'A', desc: '발이 그림자처럼 소리 없이 움직인다.', mats: { '그림자 뿌리': 3, '검은 이슬': 3, '정원사의 가위': 1, '시든 덩굴': 3 } },
  { id: 'e_b4', name: '월광의 장화', slot: 'boots', grade: 'S', desc: '굳은 월광으로 빚은 하늘을 걷는 장화.', mats: { '적월의 핵': 1, '굳은 월광': 4, '월식의 깃털': 3, '문지기의 열쇠': 1 } },
  { id: 'e_x1', name: '붉은 산호 목걸이', slot: 'acc', grade: 'B', desc: '오염을 걸러 주는 붉은 산호 목걸이.', mats: { '붉은 산호': 2, '물귀신의 머리카락': 2, '진주': 1, '조개껍데기': 2 } },
  { id: 'e_x2', name: '적월의 반지', slot: 'acc', grade: 'S', desc: '붉은 달빛이 오염을 밀어내는 반지.', mats: { '적월의 핵': 1, '붉은 조류의 핵': 1, '핏빛 수정': 2, '붉은 재': 4 } },
];
EQUIPS.push(...EVENT.MASKS);                 // [EVENT:HALLOWEEN] 이벤트 가면 (조합 가능 여부는 이벤트 켜짐 상태에 따름)
// 조합법: 재료를 모두 모으면 완성 아이템 1개를 만듭니다. (완성 아이템은 '사용'하면 효과가 나타남)
const RECIPES = [
  { id: 'r_fruit', name: '열매 주스', desc: '새콤한 열매를 짜 병에 담은 주스.', mats: { '야생 열매': 3, '빈 공병': 1 }, stat: 'hp', amt: 10 },
  { id: 'r_heal1', name: '하급 회복약', desc: '약초를 우려낸 기본적인 회복약.', mats: { '약초': 2, '맑은 샘물': 1, '빈 공병': 1 }, stat: 'hp', amt: 20 },
  { id: 'r_soup', name: '해초 스프', desc: '해초와 소금으로 끓인 따뜻한 스프.', mats: { '해초': 2, '소금': 1, '조개껍데기': 1, '맑은 샘물': 1 }, stat: 'hp', amt: 30 },
  { id: 'r_heal2', name: '상급 회복약', desc: '들꽃을 더해 효능을 높인 회복약.', mats: { '약초': 3, '들꽃': 2, '맑은 샘물': 1, '빈 공병': 1 }, stat: 'hp', amt: 50 },
  { id: 'r_pure1', name: '정화의 물약', desc: '이끼와 소금으로 몸의 탁기를 씻어낸다.', mats: { '맑은 샘물': 1, '소금': 2, '이끼': 1, '빈 공병': 1 }, stat: 'taint', amt: -10 },
  { id: 'r_pure2', name: '강력 정화약', desc: '구름 이슬과 수정으로 만든 강한 정화약.', mats: { '구름 이슬': 2, '수정 파편': 1, '진주': 1, '빈 공병': 1 }, stat: 'taint', amt: -25 },
  { id: 'r_str', name: '힘의 영약', desc: '뼈와 체액을 달여 만든 걸쭉한 영약.', mats: { '짐승의 뼈': 2, '몬스터의 체액': 2, '독버섯': 1, '빈 공병': 1 }, stat: 'str', amt: 2 },
  { id: 'r_agi', name: '민첩의 영약', desc: '깃털처럼 가벼워지는 영약.', mats: { '새의 깃털': 3, '야생 열매': 2, '맑은 샘물': 1, '빈 공병': 1 }, stat: 'agi', amt: 2 },
  { id: 'r_luck1', name: '행운의 부적', desc: '네잎 클로버를 천에 싸 묶은 부적.', mats: { '네잎 클로버': 1, '새의 깃털': 1, '낡은 천조각': 1, '나뭇가지': 1 }, stat: 'luck', amt: 3 },
  { id: 'r_luck2', name: '진주 목걸이', desc: '진주를 조개껍데기와 엮은 목걸이.', mats: { '진주': 1, '조개껍데기': 2, '낡은 천조각': 1 }, stat: 'luck', amt: 5 },
  { id: 'r_g1', name: '수문장의 가호', desc: '석재 인장에 깃든 수호의 힘.', mats: { '수문장의 인장': 1, '붉은 석재 조각': 2, '빈 공병': 1 }, stat: 'hp', amt: 80 },
  { id: 'r_g2', name: '수룡의 영약', desc: '수룡의 비늘을 달인 강한 영약.', mats: { '수룡의 비늘': 1, '붉은 물방울': 2, '빈 공병': 1 }, stat: 'str', amt: 4 },
  { id: 'r_g3', name: '금서의 지혜', desc: '금서의 한 구절이 행운을 끌어온다.', mats: { '금서의 표지': 1, '잉크 병': 2, '낡은 천조각': 1 }, stat: 'luck', amt: 6 },
  { id: 'r_g4', name: '심연의 정화약', desc: '심연의 씨앗으로 짙은 오염을 씻어낸다.', mats: { '심연의 씨앗': 1, '심연의 꽃잎': 3, '맑은 샘물': 1, '빈 공병': 1 }, stat: 'taint', amt: -45 },
  { id: 'r_g5', name: '적월의 비약', desc: '붉은 달의 힘으로 몸이 가벼워진다.', mats: { '적월의 심장 파편': 1, '적월의 눈물': 2, '월광 가루': 2, '빈 공병': 1 }, stat: 'agi', amt: 6 },
  { id: 'r_g6', name: '월식의 성유', desc: '모든 오염을 가리는 전설의 성유.', mats: { '월식의 조각': 1, '적월의 눈물': 1, '월광 가루': 2, '빈 공병': 1 }, stat: 'taint', amt: -70 },
  { id: 'r_crystal', name: '적월의 결정', desc: '적월석 가루를 굳혀 만든 붉은 결정.', mats: { '적월석 가루': 3, '수정 파편': 2, '철광석 조각': 1, '부싯돌': 1 }, stat: 'str', amt: 5 },
];
const CRAFT_DEFS = {};                       // 이름 -> {desc, stat, amt}  (완성 아이템)
RECIPES.forEach(r => { CRAFT_DEFS[r.name] = { desc: r.desc, stat: r.stat, amt: r.amt }; });


// ── 턴제 전투: 헌터 등급과 같거나 높은 등급의 몬스터(SS급·오염 몬스터 제외)와는 라운드마다 행동을 골라 싸웁니다. ──
const BT = {
  idleMs: 10 * MIN,                      // 이 시간 동안 행동이 없으면 전투가 취소됩니다 (불이익 없음)
  maxRound: 40,
  heavy: { mul: 1.8, hit: 0.7, cd: 2 },  // 내 강타
  guardTaken: 0.35, guardBonus: 0.3,     // 방어: 이번 라운드 받는 피해 ×0.35, 다음 공격 +30%
  mHeavy: 1.7, mHeavyChance: 0.25,       // 몬스터 강공(예고됨)
};
const BT_REF = { F: 2, E: 7, D: 14, C: 22, B: 32, A: 44, S: 60, SS: 80 };      // 등급마다 '보통 헌터'의 전투력 레벨 (근력은 레벨의 0.8배로 가정)
const btMon = (rank, name, pl) => {
  // 오염 사냥꾼: 헌터의 체력·공격력에 맞춰 강하게 — 한 번 맞을 때 최대 체력의 약 15% (강공 약 25%), 체력은 헌터 공격력의 12배
  if (name === '오염 사냥꾼' && pl) return { hp: Math.ceil(pl.atk * 12), atk: Math.max(7, Math.round(pl.max * 0.15)) };
  const L = BT_REF[rank] || 2, atkRef = 6 + 1.2 * L + 0.8 * (L * 0.8);
  return { hp: Math.round(atkRef * 4), atk: Math.max(3, Math.round((40 + 5 * L) * 0.22)) };
};
// ── 오염 단계: 오염도가 오를수록 불이익이 하나씩 붙습니다 (100%는 기존대로 '폭주') ──
//   1단계 30~59%: 상점 가격 +10%
//   2단계 60~79%: 상점 가격 +20% · 토벌에 실패하면 골드를 잃음 · 오염 사냥꾼이 나타날 수 있음
//   3단계 80~99%: 상점 가격 +30% · 위험 지역(B·A급 지역)에 들어갈 수 없음 · 오염 사냥꾼이 더 자주 나타남 · 위험 구간 한정 몬스터가 아주 드물게 나타남
const taintStage = t => { t = Number(t) || 0; return t >= 100 ? 3 : t >= 80 ? 3 : t >= 60 ? 2 : t >= 30 ? 1 : 0; };
const TAINT_SHOP_PCT = [0, 10, 20, 30];
const TAINT_BAN_DANGER = new Set(['B', 'A']);
const taintPrice = (price, stage) => (price > 0 ? Math.ceil(price * (100 + TAINT_SHOP_PCT[stage || 0]) / 100) : price);
const TAINT_LOSE_GOLD_MUL = 1.5;                                       // 2단계부터 토벌에 실패하면, 그 등급 평균 토벌 골드의 1.5배를 잃음 (가진 골드가 한도)
const HUNTER_CHANCE = [0, 0, 0.06, 0.12];                              // 오염 사냥꾼: 30분마다 한 번 굴림 (단계별 확률)
const RARE_CHANCE = 0.02;                                              // 위험 구간(80~99%)에서 한정 몬스터: 30분마다 한 번, 2%
// 오염 몬스터 둘: 이름으로 구분합니다. 이 둘은 항상 턴제 전투로 싸우고, 보상은 등급 보상에 배수가 붙습니다.
const SPECIAL_MON = {
  '오염 사냥꾼': { kind: 'hunter', exp: 2, gold: 2, purge: 8, minRounds: 6 },     // 처치하면 오염도 -8%. 6라운드가 지나기 전에는 쓰러지지 않음
  '혈월의 잔영': { kind: 'rare', exp: 4, gold: 5, drop: ['월식의 조각', 1] },       // 위험 구간 한정. 처치 보상이 큼 (오염도는 보통대로 오름)
};
const btPlayer = (lv, st) => ({
  max: 40 + (Number(lv) || 1) * 5,
  atk: 6 + (Number(lv) || 1) * 1.2 + (Number(st.str) || 0) * 0.8,
  dodge: Math.min(0.35, (Number(st.agi) || 0) * 0.003),
  crit: Math.min(0.5, 0.05 + (Number(st.luck) || 0) * 0.005),
  flee: Math.min(0.9, 0.45 + (Number(st.agi) || 0) * 0.004),
});
const isTurnBased = (monRank, hunterRank) => monRank !== 'SS' && RANK_IDX[monRank] !== undefined && RANK_IDX[monRank] >= (RANK_IDX[hunterRank] || 0);

module.exports = {
  BT, btMon, btPlayer, isTurnBased, taintStage, TAINT_SHOP_PCT, TAINT_BAN_DANGER, taintPrice, TAINT_LOSE_GOLD_MUL, HUNTER_CHANCE, RARE_CHANCE, SPECIAL_MON,
  SV_MARKS, MATERIALS, GATE_MATS, GATE_ZONES, EQ_GRADE, EQ_SLOTS, EQUIPS, PACTS, PACT_BACKLASH, PACT_BACKLASH_TAINT, RUMOR_NEED, RUMOR_OPEN_MS, RUMOR_GAP_MS, RUMOR_MAX_OPEN, RUMOR_TPL, RUMOR_REWARD, RECIPES, CRAFT_DEFS,
  STAT_MAX, STAT_RESET_BASE, STAT_RESET_PER, statResetCost, FAME_MAX, rnd, chance01, SPAWN_COUNTRIES, SPAWN_REGIONS, REGIONS, REGION_BY_ID, COUNTRIES, COUNTRY_BY_ID, countryOf, placeName, placeLong, MON, TIERS, ACTIVE_MS, ACTIVE_MS_F, ACTIVE_MS_S, activeMsOf, FAME_PER_LV, FAME_PER_RANK, KILL_EXP, KILL_GOLD, KILL_TAINT, rollTaint, garble, RANK_IDX, ACH_KINDS, ACH_COMPOUND, ACH_NUM, ACH_SEED, ACH_SEED2, ACH_SEED3, PROMO, ACH_PIN_MAX, rollGold, HUNT_DIFF,
  RAID_NEED, RAID_ATTEMPTS, S_MAX, S_WINDOW_MS, S_WAIT_MS, powNeed, cdOf, huntChance,
  rollRank, rollStats, PROB_CAP, STR_WIN, guardChance, freeChance, HP_START, HP_MIN, HP_DYING_MS, HP_REVIVE, hpLoss, makeCode, addExp, MIN, HOUR,
};
