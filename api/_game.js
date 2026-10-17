'use strict';
// 게임 규칙 — 서버만 이 값을 사용해 결과를 결정합니다.
const crypto = require('node:crypto');

const rnd = (a, b) => crypto.randomInt(a, b + 1);          // a~b (양끝 포함)
const chance01 = () => crypto.randomInt(0, 1000000) / 1000000;

// 세계: 10개국, 나라마다 세부 지역. 헌터는 세부 지역에 머물고, F~A급은 그 나라 안의 세부 지역에서 출몰하며,
// S급만 서버 전체가 같은 '나라'에서 출몰합니다. pos 는 레이더(200x200) 위의 좌표입니다.
const P4 = [[78, 112], [142, 64], [58, 152], [150, 138]];
const R = (id, name, sub, icon, danger, pos) => ({ id, name, sub, icon, danger, pos });
const COUNTRIES = [
  { id: 'KR', name: '대한민국', lat: 36.5, lon: 127.8, regions: [
    R('city', '도심', '중구 게이트 지대', 'i-city', 'D', [78, 112]), R('mine', '폐광', '북부 지하 갱도', 'i-mine', 'C', [142, 64]),
    R('river', '한강변', '안개 자욱한 강가', 'i-wave', 'E', [58, 152]), R('temple', '산사', '봉인된 옛 절터', 'i-temple', 'B', [150, 138]),
    R('port', '폐항', '오염된 항만', 'i-port', 'C', [44, 66]), R('gate', '적월 게이트', '붉은 달 아래 균열', 'i-gate', 'A', [112, 38])] },
  { id: 'JP', name: '일본', lat: 36, lon: 138, regions: [
    R('jp-tokyo', '도쿄 번화가', '네온이 꺼진 게이트 거리', 'i-city', 'D', P4[0]), R('jp-mine', '이와미 갱도', '폐은광 깊은 곳', 'i-mine', 'C', P4[1]),
    R('jp-bay', '오사카만', '녹슨 컨테이너 항구', 'i-port', 'C', P4[2]), R('jp-shrine', '후지 신사', '산기슭의 봉인 신사', 'i-temple', 'B', P4[3])] },
  { id: 'CN', name: '중국', lat: 35, lon: 104, regions: [
    R('cn-old', '베이징 구시가', '붉은 성벽 아래 균열', 'i-city', 'D', P4[0]), R('cn-coal', '산시 탄광', '불타는 지하 탄층', 'i-mine', 'C', P4[1]),
    R('cn-gorge', '장강 협곡', '물안개 낀 절벽', 'i-wave', 'E', P4[2]), R('cn-temple', '소림 폐사', '무너진 선원', 'i-temple', 'B', P4[3])] },
  { id: 'RU', name: '러시아', lat: 61, lon: 95, regions: [
    R('ru-metro', '모스크바 지하철', '끝없는 지하 승강장', 'i-city', 'D', P4[0]), R('ru-ural', '우랄 광산', '얼어붙은 갱도', 'i-mine', 'C', P4[1]),
    R('ru-port', '블라디보스토크항', '얼음에 갇힌 부두', 'i-port', 'C', P4[2]), R('ru-snow', '시베리아 설원', '눈 속에 열린 균열', 'i-gate', 'A', P4[3])] },
  { id: 'US', name: '미국', lat: 39, lon: -98, regions: [
    R('us-ny', '뉴욕 맨해튼', '무너진 마천루 사이', 'i-city', 'D', P4[0]), R('us-canyon', '그랜드캐니언', '협곡 아래 폐갱도', 'i-mine', 'C', P4[1]),
    R('us-bayou', '미시시피 습지', '늪지에 깔린 안개', 'i-wave', 'E', P4[2]), R('us-desert', '네바다 사막', '모래 위에 열린 균열', 'i-gate', 'A', P4[3])] },
  { id: 'IT', name: '이탈리아', lat: 42.5, lon: 12.5, regions: [
    R('it-rome', '로마 유적', '콜로세움 아래 봉인', 'i-temple', 'B', P4[0]), R('it-venice', '베네치아 수로', '가라앉은 골목길', 'i-wave', 'E', P4[1]),
    R('it-genoa', '제노바항', '낡은 범선 부두', 'i-port', 'C', P4[2]), R('it-vesuvius', '베수비오 화구', '끓어오르는 균열', 'i-gate', 'A', P4[3])] },
  { id: 'MG', name: '마다가스카르', lat: -19, lon: 47, regions: [
    R('mg-tsingy', '칭기 석림', '칼날 같은 석회암 숲', 'i-mine', 'C', P4[0]), R('mg-river', '마하장가 강', '붉은 흙탕물 강', 'i-wave', 'E', P4[1]),
    R('mg-baobab', '바오바브 길', '거목 사이에 봉인된 제단', 'i-temple', 'B', P4[2]), R('mg-port', '토아마시나항', '버려진 어선 부두', 'i-port', 'C', P4[3])] },
  { id: 'BR', name: '브라질', lat: -10, lon: -52, regions: [
    R('br-rio', '리우 언덕마을', '밤마다 문이 열리는 골목', 'i-city', 'D', P4[0]), R('br-mine', '미나스 광산', '금빛 지하 갱도', 'i-mine', 'C', P4[1]),
    R('br-amazon', '아마존 강', '끝이 보이지 않는 수면', 'i-wave', 'E', P4[2]), R('br-gate', '파라 밀림', '밀림 속 붉은 균열', 'i-gate', 'A', P4[3])] },
  { id: 'EG', name: '이집트', lat: 26, lon: 30, regions: [
    R('eg-cairo', '카이로 구시가', '미로 같은 시장 골목', 'i-city', 'D', P4[0]), R('eg-nile', '나일 강변', '고요한 검은 물', 'i-wave', 'E', P4[1]),
    R('eg-pyramid', '기자 피라미드', '묘실에 갇힌 저주', 'i-temple', 'B', P4[2]), R('eg-suez', '수에즈 운하', '좌초된 화물선', 'i-port', 'C', P4[3])] },
  { id: 'AU', name: '호주', lat: -25, lon: 134, regions: [
    R('au-sydney', '시드니항', '불 꺼진 오페라 하우스', 'i-port', 'C', P4[0]), R('au-opal', '쿠버페디 광산', '지하 오팔 갱도', 'i-mine', 'C', P4[1]),
    R('au-reef', '대보초', '죽어 가는 산호 군락', 'i-wave', 'E', P4[2]), R('au-outback', '아웃백', '붉은 사막의 균열', 'i-gate', 'A', P4[3])] },
];
const COUNTRY_BY_ID = Object.fromEntries(COUNTRIES.map(c => [c.id, c]));
const REGIONS = COUNTRIES.flatMap(c => c.regions.map(r => Object.assign({}, r, { country: c.id })));
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
  S: ['적월의 군주', '흑룡 이무기',
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
  { k: 'top',  ranks: ['S'],           gap: () => 8 * HOUR },
];
const ACTIVE_MS = 30 * MIN;
const ACTIVE_MS_F = 10 * MIN;                     // F급만 예외: 10분 안에 토벌하지 않으면 사라짐
const ACTIVE_MS_S = 24 * HOUR;                    // S급은 24시간 동안 출현 (토벌되지 않으면 사라짐)
const activeMsOf = rank => (rank === 'F' ? ACTIVE_MS_F : rank === 'S' ? ACTIVE_MS_S : ACTIVE_MS);
// 명성: 전투력(레벨)이 오를 때, 헌터 등급이 오를 때만 함께 오릅니다 (시작은 항상 0)
const FAME_PER_LV = 5, FAME_PER_RANK = 20;                       // 출몰 후 토벌 가능한 시간

// 등급별 처치 골드(G) 범위 [최소, 최대]
const KILL_GOLD = { F: [1, 5], E: [6, 15], D: [16, 35], C: [36, 70], B: [71, 120], A: [121, 180], S: [190, 200] };
const rollGold = rank => { const r = KILL_GOLD[rank] || [0, 0]; return r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1)); };
// 업적 종류: always(항상) · kills(처치 수) · rank(해당 등급 이상 처치) · sTry(S급 도전 수) · sWin(S급 처치 수) · lv(전투력 레벨) · manual(관리자가 직접 부여)
const RANK_IDX = { F: 0, E: 1, D: 2, C: 3, B: 4, A: 5, S: 6 };
const ACH_KINDS = ['always', 'kills', 'rank', 'sTry', 'sWin', 'lv', 'manual'];
// 처음 서버가 켜질 때 한 번만 넣는 기본 업적 (이후에는 관리자가 자유롭게 수정·삭제)
const ACH_SEED = [
  { id: 'reg',  name: '헌터 등록',   desc: '게이트 앞에서 헌터로 등록했다.', kind: 'always', val: '' },
  { id: 'k1',   name: '첫 사냥',     desc: '몬스터를 처음으로 처치했다.',     kind: 'kills', val: '1' },
  { id: 'k10',  name: '초보 사냥꾼', desc: '몬스터를 10마리 처치했다.',       kind: 'kills', val: '10' },
  { id: 'k50',  name: '숙련 사냥꾼', desc: '몬스터를 50마리 처치했다.',       kind: 'kills', val: '50' },
  { id: 'k200', name: '붉은 달의 학살자', desc: '몬스터를 200마리 처치했다.', kind: 'kills', val: '200' },
  { id: 'rC',   name: 'C급 토벌',    desc: 'C급 이상 몬스터를 처치했다.',     kind: 'rank', val: 'C' },
  { id: 'rA',   name: 'A급 토벌',    desc: 'A급 이상 몬스터를 처치했다.',     kind: 'rank', val: 'A' },
  { id: 'sTry', name: 'S급 도전',    desc: 'S급 몬스터 토벌에 도전했다.',     kind: 'sTry', val: '1' },
  { id: 'sWin', name: 'S급 토벌자',  desc: 'S급 몬스터를 처치했다.',          kind: 'sWin', val: '1' },
  { id: 'lv5',  name: '전투력 Lv.5',  desc: '전투력 5레벨을 달성했다.',       kind: 'lv', val: '5' },
  { id: 'lv10', name: '전투력 Lv.10', desc: '전투력 10레벨을 달성했다.',      kind: 'lv', val: '10' },
  { id: 'lv20', name: '전투력 Lv.20', desc: '전투력 20레벨을 달성했다.',      kind: 'lv', val: '20' },
];
const ACH_PIN_MAX = 3;
// 등급별 오염도(%) 상승 범위 [최소, 최대] (0.1% 단위)
const KILL_TAINT = { F: [0.5, 1], E: [1, 2], D: [2, 3.5], C: [3.5, 5.5], B: [5.5, 7.5], A: [7.5, 9], S: [9, 10] };
const rollTaint = rank => {
  const r = KILL_TAINT[rank] || [0, 0], lo = Math.round(r[0] * 10), hi = Math.round(r[1] * 10);
  return (lo + Math.floor(Math.random() * (hi - lo + 1))) / 10;
};
const KILL_EXP = { F: 8, E: 12, D: 20, C: 35, B: 60, A: 120, S: 300 };
const HUNT_DIFF = { F: '쉬움', E: '쉬움', D: '쉬움', C: '보통', B: '보통', A: '어려움', S: '매우 어려움' };
const HUNT_BASE = { '쉬움': 0.85, '보통': 0.65, '어려움': 0.4 };

const RAID_NEED = 100;                             // S급 자동 토벌 성공: 서로 다른 참여 헌터 수
const RAID_ATTEMPTS = 300;                         // S급 자동 토벌 성공: 도전(토벌) 횟수 합계 (중복 포함)
const S_MAX = 3;                                   // S급 1시간당 도전 횟수
const S_WINDOW_MS = HOUR;
const S_WAIT_MS = Number(process.env.S_RESULT_DELAY_MS) || 24 * HOUR;   // S급 결과 공개까지

const powNeed = lv => Math.round(30 * Math.pow(lv, 1.6));

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
  if (r === 'S') {
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
const HP_LOSS = { F: [1, 3], E: [2, 5], D: [4, 7], C: [6, 10], B: [9, 13], A: [12, 17], S: [16, 20] };
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
  out.taint = 0; out.fame = 0;
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

module.exports = {
  rnd, chance01, REGIONS, REGION_BY_ID, COUNTRIES, COUNTRY_BY_ID, countryOf, placeName, placeLong, MON, TIERS, ACTIVE_MS, ACTIVE_MS_F, ACTIVE_MS_S, activeMsOf, FAME_PER_LV, FAME_PER_RANK, KILL_EXP, KILL_GOLD, KILL_TAINT, rollTaint, RANK_IDX, ACH_KINDS, ACH_SEED, ACH_PIN_MAX, rollGold, HUNT_DIFF,
  RAID_NEED, RAID_ATTEMPTS, S_MAX, S_WINDOW_MS, S_WAIT_MS, powNeed, cdOf, huntChance,
  rollRank, rollStats, PROB_CAP, STR_WIN, guardChance, freeChance, HP_START, HP_MIN, HP_DYING_MS, HP_REVIVE, hpLoss, makeCode, addExp, MIN, HOUR,
};
