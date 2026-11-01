'use strict';
// 상시 컨텐츠 12종 (설계서: 적월협인 상시 컨텐츠 설계서)
//  1 장비 강화 · 7 적월문 무한 심층 · 12 PVP 리그 티어 · 17 칭호 컬렉션 · 18 희귀 변종 · 20 요리 · 21 낚시
//  22 육성 몬스터 원정 · 26 출석 도장판 · 27 시간대별 출몰 · 30 오늘의 운세
// 판정·보상은 모두 서버(이 파일)가 정하고, 화면은 결과만 그립니다. 시간 기준은 한국 시간(KST).
const G = require('./_game');

const HOUR = 3600000, MIN = 60000, DAY = 24 * HOUR;
const kst = now => new Date(now + 9 * HOUR);
const dayKey = now => kst(now).toISOString().slice(0, 10);                       // YYYY-MM-DD (KST)
const weekKey = now => { const d = kst(now), wd = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - wd)).toISOString().slice(0, 10); };   // 그 주 월요일
const monthKey = now => kst(now).toISOString().slice(0, 7);                       // YYYY-MM
const nextDayAt = now => { const d = kst(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - 9 * HOUR; };
const hash = s => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const ELK = G.ELEM_KEYS;

// ───────── 27 시간대별 출몰 ─────────
const SLOTS = [
  { k: 'dawn', ko: '새벽', from: 0, to: 6, els: ['shadow', 'arcane'], txt: '어둠·비전 몬스터가 자주 나옴 · 희귀 재료 확률 +20% · 변종 +0.5%p', exp: 1, gold: 1, rare: 1.2, variant: 0.005 },
  { k: 'morning', ko: '아침', from: 6, to: 12, els: ['holy', 'water'], txt: '신성·물 몬스터가 자주 나옴 · 조사 재료 1개 더', exp: 1, gold: 1, survey: 1 },
  { k: 'day', ko: '낮', from: 12, to: 18, els: ['fire', 'earth', 'blast'], txt: '화염·대지·폭발 몬스터가 자주 나옴 · 토벌 골드 +10%', exp: 1, gold: 1.1 },
  { k: 'night', ko: '밤', from: 18, to: 24, els: ['lightning', 'poison', 'ice'], txt: '번개·독·빙결 몬스터가 자주 나옴 · 토벌 경험치 +10% · 붉은 월어 낚시', exp: 1.1, gold: 1 },
];
const DAYS = [      // 0 = 일요일
  { ko: '일', els: ['holy', 'shadow'], txt: '강화 성공률 +5%p', enhance: 0.05 },
  { ko: '월', els: ['earth'], txt: '출석 골드 2배', attendGold: 2 },
  { ko: '화', els: ['fire'], txt: '장비 수리비 -30%', repair: 0.7 },
  { ko: '수', els: ['water'], txt: '조사 재료 2배', surveyMul: 2 },
  { ko: '목', els: ['lightning'], txt: '적월문 재출발 대기 절반', gateCd: 0.5 },
  { ko: '금', els: ['poison'], txt: '오염도 증가 -20%', taintRes: 20 },
  { ko: '토', els: ['ice', 'blast'], txt: '토벌 경험치 +20%', exp: 1.2 },
];
function timeMod(now) {
  const d = kst(now), h = d.getUTCHours(), slot = SLOTS.find(s => h >= s.from && h < s.to), day = DAYS[d.getUTCDay()];
  const els = Array.from(new Set(slot.els.concat(day.els)));
  return {
    slot: slot.k, slotKo: slot.ko, dayKo: day.ko, els, slotTxt: slot.txt, dayTxt: day.txt,
    exp: slot.exp * (day.exp || 1), gold: slot.gold, rare: slot.rare || 1, variant: slot.variant || 0, survey: (slot.survey || 0), surveyMul: day.surveyMul || 1,
    repair: day.repair || 1, gateCd: day.gateCd || 1, taintRes: day.taintRes || 0, enhance: day.enhance || 0, attendGold: day.attendGold || 1, night: slot.k === 'night', dawn: slot.k === 'dawn',
  };
}

// ───────── 1 장비 강화 ─────────
// [성공률, 비용(C등급 G), 필요 재료 희귀도, 실패 시 내구도, 실패 시 단계 하락]
const ENH = [null,
  [1, 200, '', 0, 0], [1, 400, '', 0, 0], [1, 700, '', 0, 0], [1, 1000, '', 0, 0],
  [0.70, 1500, 'r', 10, 0], [0.60, 2000, 'r', 10, 0], [0.45, 3000, 'e', 20, 0], [0.35, 4000, 'e', 20, 0],
  [0.25, 6000, 'l', 30, 1], [0.15, 8000, 'l', 30, 1]];
const ENH_MAX = 10, ENH_PER = 0.1, PROTECT = '강화 보호 부적';
const ZONE_OF_GRADE = { C: 0, B: 1, A: 2, S: 4 };
function enhMat(e, tier) {
  if (!tier) return null;
  const z = ZONE_OF_GRADE[e.grade] || 0;
  const m = G.GATE_MATS.find(x => x.zone === z && x.tier === tier) || G.GATE_MATS.find(x => x.tier === tier);
  return m ? m.name : null;
}
const plusVal = (val, plus) => Math.round(val * (1 + ENH_PER * (Number(plus) || 0)) * 10) / 10;

// ───────── 7 적월문 무한 심층 ─────────
const ABYSS_FROM = 50;            // 이 층을 넘어선 적이 있으면 51층부터 끝없이 내려갈 수 있음
const ABYSS_MAT = '심연 결정';
const ABYSS_REWARD = [[1, 30], [2, 15], [3, 15], [10, 8]];      // [이 순위까지, 심연 결정 개수]
const ABYSS_TITLE = 'abyss_walker';

// ───────── 17 칭호 ─────────
// tier: c 일반 · r 희귀 · e 영웅 · l 전설 / hidden: 조건을 알려 주지 않음
const TITLES = [
  { id: 'close_call', name: '아슬아슬한 자', tier: 'r', hidden: 1, how: '체력 5% 이하로 턴제 전투 승리' },
  { id: 'taint_edge', name: '오염의 끝', tier: 'e', hidden: 1, how: '오염도 90% 이상에서 토벌 성공' },
  { id: 'weak_hunter', name: '약점 사냥꾼', tier: 'r', hidden: 1, how: '속성 약점 공격 100회', counter: 'weak', need: 100 },
  { id: 'escape', name: '도망의 달인', tier: 'c', hidden: 1, how: '턴제 전투 도주 30회 성공', counter: 'flee', need: 30 },
  { id: 'dawn', name: '새벽 헌터', tier: 'r', hidden: 1, how: '새벽 시간대에 토벌 50회', counter: 'dawn_kill', need: 50 },
  { id: 'world', name: '세계 여행자', tier: 'e', hidden: 1, how: '모든 나라에서 토벌 1회 이상' },
  { id: 'enh_addict', name: '강화 중독', tier: 'r', hidden: 1, how: '+10 강화 실패 10회', counter: 'enh10_fail', need: 10 },
  { id: 'variant10', name: '변종 수집가', tier: 'e', hidden: 1, how: '희귀 변종 10종 처치' },
  { id: 'angler', name: '만선 어부', tier: 'l', hidden: 1, how: '전설 어종 낚기' },
  { id: 'regular', name: '개근 헌터', tier: 'e', hidden: 1, how: '출석 도장판 28칸 4번 완성' },
  { id: ABYSS_TITLE, name: '심연을 걸은 자', tier: 'l', how: '적월문 무한 심층 주간 1위 (한 주간)' },
];
const TITLE_BY = new Map(TITLES.map(t => [t.id, t]));

// ───────── 18 희귀 변종 ─────────
// 변종은 속성 도감(affinity.js)의 10종 가운데 하나로 나옵니다: 속성 → 몬스터 이름 (마법소녀 이벤트 중에만)
const VARIANT_SPECIES = { fire: '불꽃 정령', ice: '서리 결정', water: '심해 해파리', lightning: '뇌운', earth: '이끼 골렘', poison: '독 슬라임', blast: '봄버', holy: '세라핌', arcane: '떠도는 눈', shadow: '망령' };
const VARIANT_BASE = 0.01, VARIANT_LUCK = 0.005, VARIANT_MUL = 1.5, VARIANT_REWARD = 3, VARIANT_DROP = '변이의 비늘';

// ───────── 20 요리 ─────────
// eff: exp/gold = 비율(0.1 = +10%), luck/str/agi = 더하기, hpGuard/taintRes = %, elem = 속성 공격 피해 비율
const COOK = [
  { id: 'c1', name: '야채 볶음', mats: { '약초': 2, '들꽃': 1, '소금': 1 }, eff: { exp: 0.1 }, min: 30, txt: '토벌 경험치 +10%', art: { s: 'plate', f: '#6aa84f', g: '#e07a3a' } },
  { id: 'c2', name: '산나물 주먹밥', mats: { '야생 열매': 2, '해초': 1, '소금': 1 }, eff: { luck: 5 }, min: 30, txt: '행운 +5', art: { s: 'onigiri', f: '#f6f4ee', g: '#2a4a2a' } },
  { id: 'c3', name: '짐승 뼈 국밥', mats: { '짐승의 뼈': 2, '맑은 샘물': 2, '약초': 1 }, eff: { str: 6 }, min: 60, txt: '근력 +6', art: { s: 'bowl', f: '#e8dcc0', g: '#7cbf5a' } },
  { id: 'c4', name: '조개탕', mats: { '조개껍데기': 3, '해초': 1, '맑은 샘물': 1 }, eff: { hpGuard: 10 }, min: 60, txt: '체력 피해 -10%', art: { s: 'bowl', f: '#d8e8e0', g: '#e0b090' } },
  { id: 'c5', name: '구름 이슬 화채', mats: { '구름 이슬': 2, '들꽃': 2 }, eff: { agi: 6 }, min: 60, txt: '민첩 +6', art: { s: 'cup', f: '#a8d8f0', g: '#f08aa0' } },
  { id: 'c6', name: '매운탕', mats: { '민물 생선': 2, '독버섯': 1, '소금': 1 }, eff: { taintRes: 15 }, min: 60, txt: '오염도 증가 -15%', art: { s: 'pot', f: '#d0402a', g: '#7cbf5a' } },
  { id: 'c7', name: '적월 생선구이', mats: { '붉은 월어': 1, '적월석 가루': 1, '소금': 1 }, eff: { elem: 0.15 }, min: 90, txt: '속성 공격 피해 +15%', art: { s: 'fishplate', f: '#b03040', g: '#1a1012' } },
  { id: 'c8', name: '심연 전골', mats: { [ABYSS_MAT]: 2, '심연의 주인': 1 }, eff: { exp: 0.2, gold: 0.2 }, min: 120, txt: '토벌 경험치·골드 +20%', art: { s: 'pot', f: '#5a3a9a', g: '#c0a0ff' } },
  // ── 추가 요리 30종 (상점 '요리 재료' 탭의 재료 + 채집 재료 + 물고기) ──
  { id: 'c9', name: '계란말이', mats: { '달걀': 3, '대파': 1, '소금': 1 }, eff: { exp: 0.08 }, min: 30, art: { s: 'plate', f: '#f2c94c', g: '#4caf50' } },
  { id: 'c10', name: '김치볶음밥', mats: { '쌀': 2, '고추장': 1, '달걀': 1, '식용유': 1 }, eff: { str: 5 }, min: 45, art: { s: 'rice', f: '#e0603a', g: '#f2c94c' } },
  { id: 'c11', name: '된장찌개', mats: { '된장': 1, '두부': 1, '감자': 1, '대파': 1, '맑은 샘물': 1 }, eff: { hpGuard: 8 }, min: 60, art: { s: 'bowl', f: '#a8743a', g: '#7cbf5a' } },
  { id: 'c12', name: '불고기', mats: { '소고기': 2, '간장': 1, '양파': 1, '설탕': 1 }, eff: { str: 8 }, min: 60, art: { s: 'plate', f: '#7a3a22', g: '#4caf50' } },
  { id: 'c13', name: '닭꼬치', mats: { '닭고기': 2, '대파': 1, '간장': 1 }, eff: { agi: 6 }, min: 45, art: { s: 'skewer', f: '#c0703a', g: '#5aa04a' } },
  { id: 'c14', name: '감자전', mats: { '감자': 3, '밀가루': 1, '식용유': 1 }, eff: { luck: 4 }, min: 30, art: { s: 'pancake', f: '#e8c070', g: '#4caf50' } },
  { id: 'c15', name: '잔치국수', mats: { '국수 면': 2, '달걀': 1, '대파': 1, '간장': 1 }, eff: { exp: 0.1, gold: 0.05 }, min: 60, art: { s: 'noodle', f: '#f4ead0', g: '#f2c94c' } },
  { id: 'c16', name: '해물파전', mats: { '밀가루': 2, '대파': 2, '오징어': 1, '달걀': 1 }, eff: { elem: 0.1 }, min: 60, art: { s: 'plate', f: '#d8a050', g: '#5aa04a' } },
  { id: 'c17', name: '고등어구이', mats: { '고등어': 1, '소금': 1, '식용유': 1 }, eff: { agi: 5, luck: 3 }, min: 45, art: { s: 'fishplate', f: '#8a9aa8', g: '#1a1012' } },
  { id: 'c18', name: '오징어볶음', mats: { '오징어': 2, '고추장': 1, '양파': 1 }, eff: { str: 6, elem: 0.05 }, min: 60, art: { s: 'plate', f: '#e0603a', g: '#f4ead0' } },
  { id: 'c19', name: '꽃게탕', mats: { '꽃게': 2, '된장': 1, '대파': 1, '맑은 샘물': 1 }, eff: { hpGuard: 12 }, min: 90, art: { s: 'pot', f: '#e0603a', g: '#e8a040' } },
  { id: 'c20', name: '참치 주먹밥', mats: { '쌀': 2, '김': 1, '참다랑어': 1 }, eff: { exp: 0.15 }, min: 90, art: { s: 'onigiri', f: '#f6f4ee', g: '#1f3a2a' } },
  { id: 'c21', name: '카레라이스', mats: { '쌀': 2, '카레 가루': 1, '감자': 1, '당근': 1, '돼지고기': 1 }, eff: { exp: 0.12, str: 4 }, min: 90, art: { s: 'rice', f: '#d4a020', g: '#e07a3a' } },
  { id: 'c22', name: '돈가스', mats: { '돼지고기': 2, '밀가루': 1, '달걀': 1, '식용유': 1 }, eff: { str: 10 }, min: 90, art: { s: 'plate', f: '#c8843a', g: '#7cbf5a' } },
  { id: 'c23', name: '치즈 오믈렛', mats: { '달걀': 3, '치즈': 1, '우유': 1, '버터': 1 }, eff: { luck: 6 }, min: 60, art: { s: 'plate', f: '#f2d04c', g: '#e05a3a' } },
  { id: 'c24', name: '꿀 팬케이크', mats: { '밀가루': 2, '달걀': 1, '우유': 1, '꿀': 1 }, eff: { agi: 5, luck: 3 }, min: 60, art: { s: 'pancake', f: '#e0b060', g: '#a0522d' } },
  { id: 'c25', name: '열매 케이크', mats: { '밀가루': 2, '설탕': 1, '버터': 1, '달걀': 1, '야생 열매': 2 }, eff: { gold: 0.12 }, min: 90, art: { s: 'cake', f: '#f4e6c8', g: '#e06a8a' } },
  { id: 'c26', name: '꿀차', mats: { '꿀': 1, '찻잎': 1, '맑은 샘물': 1 }, eff: { taintRes: 10 }, min: 45, art: { s: 'mug', f: '#e0a040', b: '#d8c0a0' } },
  { id: 'c27', name: '녹차', mats: { '찻잎': 2, '맑은 샘물': 1 }, eff: { taintRes: 8, luck: 2 }, min: 45, art: { s: 'mug', f: '#7cae5a', b: '#e8e2d8' } },
  { id: 'c28', name: '밀크티', mats: { '찻잎': 1, '우유': 1, '설탕': 1 }, eff: { agi: 4 }, min: 30, art: { s: 'cup', f: '#c8a080', g: '#3a2a20' } },
  { id: 'c29', name: '열매 스무디', mats: { '야생 열매': 3, '우유': 1, '꿀': 1 }, eff: { luck: 5 }, min: 30, art: { s: 'cup', f: '#d04a7a', g: '#7cbf5a' } },
  { id: 'c30', name: '호빵', mats: { '밀가루': 2, '설탕': 1, '우유': 1 }, eff: { hpGuard: 6 }, min: 30, art: { s: 'bun', f: '#f4ead8', g: '#c0703a' } },
  { id: 'c31', name: '두부조림', mats: { '두부': 2, '간장': 1, '고춧가루': 1, '마늘': 1 }, eff: { taintRes: 12 }, min: 60, art: { s: 'plate', f: '#d8a060', g: '#e0603a' } },
  { id: 'c32', name: '삼계탕', mats: { '닭고기': 3, '쌀': 1, '마늘': 2, '약초': 2 }, eff: { hpGuard: 15, str: 4 }, min: 120, art: { s: 'pot', f: '#f0e2c0', g: '#7cbf5a' } },
  { id: 'c33', name: '갈비찜', mats: { '소고기': 3, '간장': 2, '당근': 1, '감자': 1, '설탕': 1 }, eff: { str: 12 }, min: 120, art: { s: 'pot', f: '#7a3a22', g: '#e07a3a' } },
  { id: 'c34', name: '메기 매운찜', mats: { '메기': 1, '고추장': 1, '대파': 1, '마늘': 1 }, eff: { elem: 0.12 }, min: 90, art: { s: 'pot', f: '#c0402a', g: '#7cbf5a' } },
  { id: 'c35', name: '장어 덮밥', mats: { '쌀': 2, '그림자 장어': 1, '간장': 1, '설탕': 1 }, eff: { exp: 0.15, agi: 4 }, min: 120, art: { s: 'rice', f: '#6a3a20', g: '#f2c94c' } },
  { id: 'c36', name: '문어 숙회', mats: { '문어': 1, '고추장': 1, '참기름': 1 }, eff: { elem: 0.1, luck: 3 }, min: 60, art: { s: 'plate', f: '#d06a7a', g: '#7cbf5a' } },
  { id: 'c37', name: '송어 버터구이', mats: { '송어': 1, '버터': 1, '마늘': 1 }, eff: { gold: 0.1, exp: 0.05 }, min: 90, art: { s: 'fishplate', f: '#d89a7a', g: '#f2e28a' } },
  { id: 'c38', name: '용왕 수라상', mats: { '용왕 비늘잉어': 1, '쌀': 2, '참기름': 1, '꿀': 1 }, eff: { exp: 0.25, gold: 0.25 }, min: 180, art: { s: 'pot', f: '#e8c050', g: '#d4202e' } },
];
// 효과 문구가 없는 요리는 eff 로 만들어 씀
const EFF_KO = { exp: '토벌 경험치', gold: '토벌 골드', elem: '속성 공격 피해', luck: '행운', str: '근력', agi: '민첩', hpGuard: '체력 피해', taintRes: '오염도 증가' };
function effTxt(e) {
  return Object.keys(e).map(k => k === 'exp' || k === 'gold' || k === 'elem' ? EFF_KO[k] + ' +' + Math.round(e[k] * 100) + '%' : k === 'hpGuard' || k === 'taintRes' ? EFF_KO[k] + ' -' + e[k] + '%' : EFF_KO[k] + ' +' + e[k]).join(' · ');
}
COOK.forEach(c => { if (!c.txt) c.txt = effTxt(c.eff); });
// ── 상점 '요리 재료' 탭: 요리에만 쓰는 재료 (정가 판매, 인벤토리 조합 아이템으로 들어감) ──
const COOK_MATS = [
  { name: '쌀', price: 30, desc: '밥과 죽의 기본' }, { name: '밀가루', price: 30, desc: '전·빵·면 반죽' }, { name: '국수 면', price: 35, desc: '바로 삶는 소면' },
  { name: '달걀', price: 25, desc: '어디에나 어울리는 재료' }, { name: '우유', price: 35, desc: '고소한 생우유' }, { name: '버터', price: 50, desc: '풍미를 더하는 버터' }, { name: '치즈', price: 70, desc: '쭉 늘어나는 치즈' },
  { name: '돼지고기', price: 80, desc: '볶음·튀김용 돼지고기' }, { name: '소고기', price: 120, desc: '구이·찜용 소고기' }, { name: '닭고기', price: 70, desc: '꼬치·탕용 닭고기' }, { name: '두부', price: 30, desc: '부드러운 두부' },
  { name: '감자', price: 25, desc: '포슬포슬한 감자' }, { name: '당근', price: 25, desc: '달큰한 당근' }, { name: '양파', price: 20, desc: '볶으면 단맛이 나는 양파' }, { name: '대파', price: 20, desc: '향을 내는 대파' }, { name: '마늘', price: 20, desc: '기운이 나는 마늘' },
  { name: '간장', price: 30, desc: '짭짤한 간장' }, { name: '된장', price: 40, desc: '구수한 된장' }, { name: '고추장', price: 40, desc: '매콤한 고추장' }, { name: '고춧가루', price: 30, desc: '얼큰한 맛' },
  { name: '설탕', price: 25, desc: '단맛 담당' }, { name: '꿀', price: 60, desc: '진한 벌꿀' }, { name: '식용유', price: 30, desc: '굽고 튀길 때' }, { name: '참기름', price: 45, desc: '고소한 마무리' },
  { name: '김', price: 25, desc: '바삭한 김' }, { name: '카레 가루', price: 50, desc: '향신료를 섞은 카레 가루' }, { name: '찻잎', price: 40, desc: '말린 찻잎' },
];
const COOK_MAT_BY = new Map(COOK_MATS.map(m => [m.name, m]));
const COOK_BY = new Map(COOK.map(c => [c.id, c]));
const DISH = new Map();       // 요리 아이템 이름 → { c, q } (q: 1 보통, 1.5 일품)
COOK.forEach(c => { DISH.set(c.name, { c, q: 1 }); DISH.set(c.name + ' (일품)', { c, q: 1.5 }); });      // 요리 아이템
const BUFF_MAX = 3 * HOUR, FINE_P = 0.1;

// ───────── 21 낚시 ─────────
// w: 물 종류(fresh 민물 · sea 바다 · any 둘 다) · spots: 이 지역에서만 · slot: 이 시간대에만(dawn/morning/day/night) · day: 이 요일에만(0=일) · hours: [시작, 끝) KST
// 등급 기본값: 판정 칸(win)·눈금 속도(speed) — 일반 .30/1.0 · 희귀 .22/1.3 · 영웅 .15/1.7 · 전설 .10/2.2
const FISH_TIER = { c: { win: 0.30, speed: 1.0 }, r: { win: 0.22, speed: 1.3 }, e: { win: 0.15, speed: 1.7 }, l: { win: 0.10, speed: 2.2 } };
const FISH = [
  { name: '민물 생선', tier: 'c', w: 'fresh', cm: [15, 45], gold: 20 },
  { name: '바다 새우', tier: 'c', w: 'sea', cm: [5, 18], gold: 20 },
  { name: '붉은 월어', tier: 'r', w: 'any', slot: 'night', cm: [30, 70], win: 0.20, speed: 1.4, gold: 80 },
  { name: '그레이윅 금빛 잉어', tier: 'e', w: 'any', spots: ['cw-isle'], cm: [40, 90], win: 0.14, speed: 1.8, gold: 250 },
  { name: '심연의 주인', tier: 'l', w: 'any', spots: ['gt-lake'], hours: [0, 4], cm: [120, 300], win: 0.09, speed: 2.4, gold: 1500 },
  // ── 추가 어종 30종 ──
  { name: '붕어', tier: 'c', w: 'fresh', cm: [10, 35], gold: 22 },
  { name: '피라미', tier: 'c', w: 'fresh', slot: 'morning', cm: [6, 15], gold: 24 },
  { name: '메기', tier: 'c', w: 'fresh', slot: 'night', cm: [25, 80], gold: 30 },
  { name: '운하 잉어', tier: 'c', w: 'fresh', spots: ['it-venice', 'fr-seine', 'in-ganges'], cm: [20, 60], gold: 30 },
  { name: '고등어', tier: 'c', w: 'sea', cm: [20, 45], gold: 22 },
  { name: '전갱이', tier: 'c', w: 'sea', slot: 'morning', cm: [15, 35], gold: 24 },
  { name: '오징어', tier: 'c', w: 'sea', slot: 'night', cm: [20, 50], gold: 28 },
  { name: '꽃게', tier: 'c', w: 'sea', cm: [10, 25], gold: 26 },
  { name: '보름 해파리', tier: 'c', w: 'sea', slot: 'dawn', cm: [10, 40], gold: 30 },
  { name: '송어', tier: 'r', w: 'fresh', spots: ['ru-baikal', 'cn-gorge', 'fr-seine', 'jp-onsen'], cm: [30, 70], gold: 70 },
  { name: '쏘가리', tier: 'r', w: 'fresh', spots: ['river', 'cn-gorge'], cm: [20, 50], gold: 80 },
  { name: '피라냐', tier: 'r', w: 'fresh', spots: ['br-amazon', 'br-falls'], cm: [15, 35], gold: 75 },
  { name: '나일 농어', tier: 'r', w: 'fresh', spots: ['eg-nile'], cm: [50, 150], gold: 90 },
  { name: '수정 가재', tier: 'r', w: 'fresh', spots: ['jp-onsen', 'it-venice', 'us-bayou'], cm: [8, 20], gold: 85 },
  { name: '달빛 은어', tier: 'r', w: 'fresh', slot: 'dawn', cm: [12, 30], gold: 90 },
  { name: '그림자 장어', tier: 'r', w: 'any', slot: 'night', cm: [40, 120], gold: 95 },
  { name: '참돔', tier: 'r', w: 'sea', slot: 'day', cm: [30, 80], gold: 80 },
  { name: '광어', tier: 'r', w: 'sea', spots: ['port', 'jp-bay', 'ru-port'], cm: [35, 90], gold: 85 },
  { name: '문어', tier: 'r', w: 'sea', slot: 'night', cm: [40, 120], gold: 80 },
  { name: '복어', tier: 'r', w: 'sea', spots: ['jp-bay', 'in-mumbai', 'eg-suez'], cm: [15, 40], gold: 100 },
  { name: '흰동가리', tier: 'r', w: 'sea', spots: ['au-reef', 'au-sydney'], cm: [6, 12], gold: 90 },
  { name: '아로와나', tier: 'e', w: 'fresh', spots: ['br-amazon'], slot: 'dawn', cm: [50, 100], gold: 260 },
  { name: '철갑상어', tier: 'e', w: 'fresh', spots: ['ru-baikal'], cm: [100, 250], gold: 300 },
  { name: '황금 메기', tier: 'e', w: 'fresh', spots: ['us-bayou', 'mg-river'], slot: 'night', cm: [60, 150], gold: 280 },
  { name: '성스러운 마하시르', tier: 'e', w: 'fresh', spots: ['in-ganges'], slot: 'day', cm: [60, 140], gold: 300 },
  { name: '참다랑어', tier: 'e', w: 'sea', spots: ['jp-bay', 'au-sydney', 'it-genoa', 'fr-marseille'], slot: 'dawn', cm: [100, 300], gold: 320 },
  { name: '황새치', tier: 'e', w: 'sea', spots: ['br-beach', 'mg-coast', 'au-road', 'us-harbor'], cm: [120, 300], gold: 300 },
  { name: '적월 해마', tier: 'e', w: 'any', spots: ['gt-lake'], slot: 'night', cm: [15, 35], gold: 350 },
  { name: '실러캔스', tier: 'l', w: 'sea', spots: ['mg-coast', 'mg-port'], slot: 'dawn', cm: [120, 200], gold: 1800 },
  { name: '용왕 비늘잉어', tier: 'l', w: 'fresh', spots: ['cn-gorge'], day: 0, cm: [150, 280], gold: 2000 },
].map(f => Object.assign({}, FISH_TIER[f.tier], f));
const FISH_BY = new Map(FISH.map(f => [f.name, f]));
const FISH_DAY = 20, FISH_TOL = 450;          // 하루 횟수 · 판정 여유(ms, 통신 지연)
const FISH_SPOTS = new Set(G.REGIONS.filter(r => r.icon === 'i-wave' || r.icon === 'i-port').map(r => r.id).concat(['gt-lake', 'cw-isle']));
// 바다: 항구 + 해안가(물결 아이콘이지만 바다인 곳) + 적월문 푸른 바다
const SEA_SPOTS = new Set(G.REGIONS.filter(r => r.icon === 'i-port').map(r => r.id).concat(['gt-lake', 'mg-coast', 'br-beach', 'au-reef', 'au-road']));
const FISH_SLOT_KO = { dawn: '새벽', morning: '아침', day: '낮', night: '밤' }, FISH_DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
// 어종 기록에 보여 줄 '나오는 곳'
function fishWhere(f) {
  const out = [f.spots ? f.spots.map(id => (G.placeLong(id) || id).split(' · ').pop()).join('·') : f.w === 'fresh' ? '민물' : f.w === 'sea' ? '바다' : '모든 물가'];
  if (f.slot) out.push(FISH_SLOT_KO[f.slot]);
  if (f.day !== undefined) out.push(FISH_DAY_KO[f.day] + '요일');
  if (f.hours) out.push(f.hours[0] + '~' + f.hours[1] + '시');
  return out.join(' · ');
}

// ───────── 22 육성 몬스터 원정 ─────────
const EXPED = [
  { id: 'field', ko: '들판 산책', hours: 1, bond: 0, loot: ['약초', '들꽃', '야생 열매'], diary: ['나비를 쫓아다니다 왔어요', '들꽃 향을 잔뜩 묻혀 왔어요', '풀밭에서 낮잠을 잤대요'] },
  { id: 'lake', ko: '고요한 호수', hours: 3, bond: 30, loot: ['맑은 샘물', '해초', '민물 생선'], diary: ['호숫가에서 개구리와 놀다 왔어요', '물수제비 뜨는 법을 배워 왔대요', '젖은 채로 뿌듯하게 돌아왔어요'] },
  { id: 'peak', ko: '구름 봉우리', hours: 6, bond: 60, loot: ['구름 이슬', '수정 파편', '새의 깃털'], diary: ['구름 위에서 해돋이를 봤대요', '독수리와 눈싸움을 했대요', '바람에 날아갈 뻔했대요'] },
  { id: 'gate', ko: '적월문 입구', hours: 8, bond: 90, loot: ['붉은 석재 조각', '균열난 기둥 파편', '먼지 낀 촛대', '낡은 문양판', '청동 문고리'], epic: ['수문장의 인장', '석상의 눈동자'], diary: ['문지기 석상 앞에서 한참 버티다 왔어요', '붉은 돌조각을 물고 자랑스럽게 왔어요', '무서웠는지 꼬리를 말고 돌아왔어요'] },
];
const EXPED_BY = new Map(EXPED.map(x => [x.id, x]));

// ───────── 26 출석 도장판 ─────────
const ATTEND_LEN = 28, ATTEND_GOLD = 300, ATTEND_STREAK = 7, ATTEND_TITLE_ROUNDS = 4;

// ───────── 30 오늘의 운세 ─────────
const FORTUNE = [
  { k: 'great', ko: '대길', p: 5, luck: 10, region: 0.3, variant: 2, txt: '행운 +10 · 변종 출현 2배 · 추천 지역 보상 +30%' },
  { k: 'good', ko: '길', p: 25, luck: 5, region: 0.2, txt: '행운 +5 · 추천 지역 보상 +20%' },
  { k: 'mid', ko: '중길', p: 40, region: 0.1, txt: '추천 지역 보상 +10%' },
  { k: 'small', ko: '소길', p: 25, fish: 0.05, txt: '낚시 희귀 이상 확률 +5%p' },
  { k: 'bad', ko: '흉', p: 5, txt: '오늘은 쉬어 가요 · 위로 500 G · 다음 운세는 길 이상' },
];
const FORTUNE_LINES = ['서쪽 물가에 반가운 인연이 있다', '오래 미뤄 둔 일을 끝내기 좋은 날', '붉은 달이 당신 편에 서 있다', '작은 친절이 큰 행운으로 돌아온다', '오늘의 실패는 내일의 길잡이',
  '익숙한 길에서 낯선 것을 줍는다', '서두르면 놓치고 기다리면 얻는다', '동쪽 바람이 좋은 소식을 데려온다', '친구의 말에 귀 기울이면 길이 보인다', '빈손으로 나가도 가득 차서 돌아온다',
  '높은 곳보다 깊은 곳에 답이 있다', '불빛 하나가 어둠 전체를 바꾼다', '오늘 만난 몬스터는 생각보다 약하다', '조급함을 내려놓으면 운이 붙는다', '두 번 생각하고 한 번에 움직여라',
  '잊고 있던 물건이 쓸모를 찾는다', '물소리를 따라가면 좋은 일이 생긴다', '처음 가는 지역에 행운이 숨어 있다', '오늘은 칼보다 지혜가 강하다', '작은 상처가 큰 경험치가 된다',
  '밤하늘을 올려다보면 답이 보인다', '사소한 약속을 지키면 큰 복이 온다', '서툰 도전이 빛나는 기록이 된다', '낡은 장비에 새 힘이 깃든다', '함께하면 두 배로 얻는다',
  '그림자 속에서 보물이 반짝인다', '지친 몸을 쉬게 하면 행운이 찾아온다', '돌아가는 길이 지름길이다', '오늘 고른 길이 정답이다', '붉은 달빛 아래 소원이 이루어진다'];

// ───────── 12 PVP 리그 티어 ─────────
const LEAGUE = [
  { k: 'bronze', ko: '브론즈', min: 0, win: 25, lose: 10, gold: 1000 },
  { k: 'silver', ko: '실버', min: 300, win: 22, lose: 14, gold: 2500 },
  { k: 'gold', ko: '골드', min: 700, win: 20, lose: 17, gold: 5000, mat: ['r', 3] },
  { k: 'plat', ko: '플래티넘', min: 1200, win: 18, lose: 18, gold: 8000, mat: ['e', 2] },
  { k: 'dia', ko: '다이아', min: 1800, win: 16, lose: 18, gold: 12000, mat: ['l', 1] },
  { k: 'legend', ko: '레전드', min: 2500, win: 15, lose: 20, gold: 20000, mat: ['l', 2] },
];
const tierIdx = lp => { let i = 0; for (let k = 0; k < LEAGUE.length; k++) if (lp >= LEAGUE[k].min) i = k; return i; };
const PROMO_NEED = 2, PROMO_FAIL_BACK = 50, PROTECT_GAMES = 3, DIFF_BONUS = 5;

// ═════════════ DB ═════════════
const SQL = [
  "CREATE TABLE IF NOT EXISTS ct_counter (user_id INTEGER NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, key))",
  "CREATE TABLE IF NOT EXISTS ct_title (user_id INTEGER NOT NULL, tid TEXT NOT NULL, at INTEGER NOT NULL, until INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, tid))",
  "CREATE TABLE IF NOT EXISTS ct_attend (user_id INTEGER PRIMARY KEY, last_day TEXT NOT NULL DEFAULT '', stamps INTEGER NOT NULL DEFAULT 0, rounds INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS ct_fortune (user_id INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, region TEXT NOT NULL, el TEXT NOT NULL, line INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))",
  "CREATE TABLE IF NOT EXISTS ct_gate_week (user_id INTEGER NOT NULL, week TEXT NOT NULL, best INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, week))",
  "CREATE INDEX IF NOT EXISTS ct_gate_week_w ON ct_gate_week(week, best)",
  "CREATE TABLE IF NOT EXISTS ct_fish_cast (user_id INTEGER PRIMARY KEY, fish TEXT NOT NULL, bite_at INTEGER NOT NULL, period INTEGER NOT NULL, w0 REAL NOT NULL, w1 REAL NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS ct_fish_log (user_id INTEGER NOT NULL, fish TEXT NOT NULL, best INTEGER NOT NULL DEFAULT 0, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, fish))",
  "CREATE TABLE IF NOT EXISTS ct_fish_day (user_id INTEGER NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))",
  "CREATE TABLE IF NOT EXISTS ct_news (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS ct_news_user ON ct_news(user_id, id)",
  "CREATE TABLE IF NOT EXISTS ct_aff (user_id INTEGER NOT NULL, mon TEXT NOT NULL, el TEXT NOT NULL, at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, mon))",      // 속성 도감: 스킬을 써 본 몬스터
  'ALTER TABLE users ADD COLUMN title TEXT NOT NULL DEFAULT \'\'',
  'ALTER TABLE pvp_queue ADD COLUMN mode TEXT NOT NULL DEFAULT \'league\'',
  'ALTER TABLE users ADD COLUMN buff TEXT NOT NULL DEFAULT \'\'',
  'ALTER TABLE users ADD COLUMN buff_until INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN buff_q REAL NOT NULL DEFAULT 1',
  'ALTER TABLE users ADD COLUMN lp INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN lp_peak INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN lp_games INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN lp_prot INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE users ADD COLUMN lp_promo TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN lp_season TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN fortune_bad INTEGER NOT NULL DEFAULT 0",
  'ALTER TABLE equip_inv ADD COLUMN plus INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE monsters ADD COLUMN variant TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE battles ADD COLUMN mvar TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE user_mons ADD COLUMN exp_spot TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE user_mons ADD COLUMN exp_from INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE user_mons ADD COLUMN exp_until INTEGER NOT NULL DEFAULT 0',
];
const PURGE = ['ct_counter', 'ct_title', 'ct_attend', 'ct_fortune', 'ct_gate_week', 'ct_fish_cast', 'ct_fish_log', 'ct_fish_day', 'ct_news', 'ct_aff'].map(t => ['DELETE FROM ' + t + ' WHERE user_id = ?']);

function install(d) {
  const { db, route, send, fail, limited, userById, grantGold, grantExp, logAcquire, giveItem, EQ_BY_ID, eqBonusOf } = d;
  const inv = async (uid, item) => { const r = await db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [uid, item]); return r ? Number(r.qty) : 0; };
  const take = async (uid, mats) => {      // 재료를 한꺼번에 씁니다(모자라면 하나도 쓰지 않음)
    const ks = Object.keys(mats);
    for (const k of ks) if (await inv(uid, k) < mats[k]) return { err: 'no_mats', item: k };
    const done = [];
    for (const k of ks) {
      const w = await db.run('UPDATE inventory SET qty = qty - ? WHERE user_id = ? AND item = ? AND qty >= ?', [mats[k], uid, k, mats[k]]);
      if (w.changes !== 1) { for (const [k2, v2] of done) await giveItem(uid, k2, v2); return { err: 'no_mats', item: k }; }
      done.push([k, mats[k]]);
    }
    await db.run('DELETE FROM inventory WHERE user_id = ? AND qty <= 0', [uid]);
    return { ok: true };
  };
  const haveMats = async (uid, mats) => { const o = {}; for (const k of Object.keys(mats)) o[k] = await inv(uid, k); return o; };
  // 헌터 한 명에게 보내는 소식: 다음 상태 확인 때 화면 아래 알림으로 한 번 보여 줌
  const notice = async (uid, title, body) => { try { await db.run('INSERT INTO ct_news (user_id, title, body, at) VALUES (?, ?, ?, ?)', [uid, title, body, Date.now()]); } catch (_) {} };

  // ── 카운터 · 칭호 ──
  async function bump(uid, key, n) {
    await db.run('INSERT INTO ct_counter (user_id, key, n) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET n = n + excluded.n', [uid, key, n || 1]);
    const r = await db.get('SELECT n FROM ct_counter WHERE user_id = ? AND key = ?', [uid, key]);
    const n2 = r ? Number(r.n) : 0;
    const t = TITLES.find(x => x.counter === key);
    if (t && n2 >= t.need) await grantTitle(uid, t.id);
    return n2;
  }
  async function mark(uid, key) { await db.run('INSERT INTO ct_counter (user_id, key, n) VALUES (?, ?, 1) ON CONFLICT(user_id, key) DO NOTHING', [uid, key]); }
  async function countPrefix(uid, p) { const r = await db.get('SELECT COUNT(*) AS c FROM ct_counter WHERE user_id = ? AND key LIKE ?', [uid, p + '%']); return Number(r.c) || 0; }
  async function grantTitle(uid, tid, until, name) {
    const now = Date.now();
    const had = await db.get('SELECT until FROM ct_title WHERE user_id = ? AND tid = ?', [uid, tid]);
    if (had && !Number(had.until) && !until) return false;
    await db.run('INSERT INTO ct_title (user_id, tid, at, until) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, tid) DO UPDATE SET at = excluded.at, until = excluded.until', [uid, tid, now, until || 0]);
    if (!had) await notice(uid, '칭호 획득', "칭호 '" + (name || (TITLE_BY.get(tid) || {}).name || tid) + "'을(를) 얻었습니다. 업적 앱의 칭호에서 달 수 있어요.");
    return !had;
  }
  const titleName = tid => { if (TITLE_BY.has(tid)) return TITLE_BY.get(tid).name; const m = /^season:(\d{4})-(\d{2}):(\w+)$/.exec(tid); if (m) { const t = LEAGUE.find(x => x.k === m[3]); return Number(m[2]) + '월 ' + (t ? t.ko : ''); } return ''; };
  const titleTier = tid => { if (TITLE_BY.has(tid)) return TITLE_BY.get(tid).tier; const m = /^season:[\d-]+:(\w+)$/.exec(tid); if (m) { const i = LEAGUE.findIndex(x => x.k === m[1]); return i >= 4 ? 'l' : i >= 2 ? 'e' : 'r'; } return 'c'; };
  async function titleOf(uid) {      // 지금 달고 있는 칭호 { name, tier } 또는 null
    const u = await db.get('SELECT title FROM users WHERE id = ?', [uid]);
    const tid = u ? u.title : '';
    if (!tid) return null;
    const now = Date.now();
    if (tid.indexOf('ach:') === 0) {
      const a = await db.get('SELECT a.name FROM ach_earned e JOIN achievements a ON a.id = e.ach_id WHERE e.user_id = ? AND e.ach_id = ?', [uid, tid.slice(4)]);
      return a ? { name: a.name, tier: 'c' } : null;
    }
    const own = await db.get('SELECT until FROM ct_title WHERE user_id = ? AND tid = ?', [uid, tid]);
    if (!TITLE_BY.has(tid) || !own || (Number(own.until) && Number(own.until) < now)) { await db.run("UPDATE users SET title = '' WHERE id = ? AND title = ?", [uid, tid]); return null; }      // 없어진 칭호(예: 숙소)는 떼어 냄
    return { name: titleName(tid), tier: titleTier(tid) };
  }
  route('GET', '/api/titles', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now();
    const own = new Map((await db.all('SELECT tid, at, until FROM ct_title WHERE user_id = ?', [uid])).map(r => [r.tid, r]));
    const ach = await db.all('SELECT a.id, a.name FROM ach_earned e JOIN achievements a ON a.id = e.ach_id WHERE e.user_id = ? ORDER BY e.at DESC', [uid]);
    const cur = (await db.get('SELECT title FROM users WHERE id = ?', [uid])).title;
    const list = TITLES.map(t => { const o = own.get(t.id), live = o && (!Number(o.until) || Number(o.until) > now); return { id: t.id, name: live || !t.hidden ? t.name : '???', tier: t.tier, how: live || !t.hidden ? t.how : '숨겨진 조건', own: !!live, until: live ? Number(o.until) || 0 : 0 }; });
    own.forEach((o, tid) => { if (!TITLE_BY.has(tid) && (!Number(o.until) || Number(o.until) > now)) list.push({ id: tid, name: titleName(tid), tier: titleTier(tid), how: 'PVP 리그 시즌 최고 티어', own: true, until: Number(o.until) || 0 }); });
    send(res, 200, { cur, list, ach: ach.map(a => ({ id: 'ach:' + a.id, name: a.name, tier: 'c', own: true })) });
  });
  route('POST', '/api/titles/wear', async (req, res, ctx) => {
    const uid = ctx.user.id, tid = String(ctx.body.id || '');
    if (tid) {
      if (tid.indexOf('ach:') === 0) { if (!(await db.get('SELECT 1 AS x FROM ach_earned WHERE user_id = ? AND ach_id = ?', [uid, tid.slice(4)]))) return fail(res, 404, 'not_owned'); }
      else { const o = await db.get('SELECT until FROM ct_title WHERE user_id = ? AND tid = ?', [uid, tid]); if (!o || (Number(o.until) && Number(o.until) < Date.now())) return fail(res, 404, 'not_owned'); }
    }
    await db.run('UPDATE users SET title = ? WHERE id = ?', [tid, uid]);
    send(res, 200, { ok: true, title: await titleOf(uid) });
  });

  // ── 버프(요리) · 운세 · 시간대를 모은 보너스 ──
  async function fortuneRow(uid, now) { return db.get('SELECT kind, region, el, line FROM ct_fortune WHERE user_id = ? AND day = ?', [uid, dayKey(now)]); }
  async function bonus(uid, now) {
    const b = { luck: 0, str: 0, agi: 0, hpGuard: 0, taintRes: 0, exp: 1, gold: 1, elem: 1, region: '', regionMul: 1, variant: 1, fish: 0 };
    const u = await db.get('SELECT buff, buff_until, buff_q FROM users WHERE id = ?', [uid]);
    if (u && u.buff && Number(u.buff_until) > now && COOK_BY.has(u.buff)) {
      const e = COOK_BY.get(u.buff).eff, q = Number(u.buff_q) || 1;
      if (e.exp) b.exp *= 1 + e.exp * q; if (e.gold) b.gold *= 1 + e.gold * q; if (e.elem) b.elem *= 1 + e.elem * q;
      ['luck', 'str', 'agi', 'hpGuard', 'taintRes'].forEach(k => { if (e[k]) b[k] += Math.round(e[k] * q); });
    }
    const f = await fortuneRow(uid, now);
    if (f) { const F = FORTUNE.find(x => x.k === f.kind) || {}; b.luck += F.luck || 0; if (F.region) { b.region = f.region; b.regionMul = 1 + F.region; } b.variant *= F.variant || 1; b.fish += F.fish || 0; }
    const t = timeMod(now); b.exp *= t.exp; b.gold *= t.gold; b.taintRes += t.taintRes;
    return b;
  }

  // ── 27 시간대 · 18 변종: 개인 몬스터가 생길 때 ──
  function pickName(rank, now) {
    const names = G.MON[rank], t = timeMod(now);
    const em = names.filter(n => t.els.includes(G.elemOf(n)));
    return em.length && Math.random() < 0.5 ? pick(em) : pick(names);
  }
  async function variantChance(uid, now) {
    const u = await db.get('SELECT stats FROM users WHERE id = ?', [uid]);
    let luck = 0; try { luck = Number(JSON.parse(u.stats).luck) || 0; } catch (_) {}
    const b = await bonus(uid, now);
    return (VARIANT_BASE + (luck + b.luck >= 50 ? VARIANT_LUCK : 0) + timeMod(now).variant) * b.variant;
  }
  const rollVariant = (name, p) => { if (!p || Math.random() >= p) return ''; return pick(Object.keys(VARIANT_SPECIES).filter(k => ELK.includes(k))); };      // 도감 10종 중 하나의 속성

  // ── 토벌 성공 보상 배율 · 칭호 조건 (huntWin 에서 부름) ──
  async function onKill(cur, m, now, before) {
    const b = await bonus(cur.id, now), t = timeMod(now);
    let mul = b.exp, gmul = b.gold, extra = [];
    if (b.region && cur.region === b.region) { mul *= b.regionMul; gmul *= b.regionMul; extra.push('추천 지역 +' + Math.round((b.regionMul - 1) * 100) + '%'); }
    if (m.variant) { mul *= VARIANT_REWARD; gmul *= VARIANT_REWARD; await giveItem(cur.id, VARIANT_DROP, 1); await logAcquire(cur.id, 'item', VARIANT_DROP, 1, '변종 ' + m.name + ' 토벌', now); extra.push(VARIANT_DROP + ' ×1');
      await mark(cur.id, 'vk:' + m.name); if (await countPrefix(cur.id, 'vk:') >= 10) await grantTitle(cur.id, 'variant10'); }
    if (t.dawn) await bump(cur.id, 'dawn_kill', 1);
    await mark(cur.id, 'kc:' + G.countryOf(m.region));
    if (await countPrefix(cur.id, 'kc:') >= G.SPAWN_COUNTRIES.length) await grantTitle(cur.id, 'world');
    if (before && before.taint >= 90) await grantTitle(cur.id, 'taint_edge');
    return { mul, gmul, note: extra.join(' · ') };
  }

  // ═════════ 26 출석 ═════════
  async function attend(uid, now) {
    const day = dayKey(now), y = dayKey(now - DAY);
    await db.run('INSERT INTO ct_attend (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING', [uid]);
    const a = await db.get('SELECT last_day, stamps, rounds, streak FROM ct_attend WHERE user_id = ?', [uid]);
    if (a.last_day === day) return { already: true, stamps: a.stamps, rounds: a.rounds, streak: a.streak };
    const stamps = a.stamps >= ATTEND_LEN ? 1 : a.stamps + 1, rounds = a.rounds + (stamps === ATTEND_LEN ? 1 : 0), streak = a.last_day === y ? a.streak + 1 : 1;
    const w = await db.run('UPDATE ct_attend SET last_day = ?, stamps = ?, rounds = ?, streak = ? WHERE user_id = ? AND last_day = ?', [day, stamps, rounds, streak, uid, a.last_day]);
    if (w.changes !== 1) return { already: true, stamps: a.stamps, rounds: a.rounds, streak: a.streak };
    const t = timeMod(now), got = [];
    let gold = Math.round(ATTEND_GOLD * (streak >= ATTEND_STREAK ? 1.5 : 1) * t.attendGold);
    for (let i = 0; i < 2; i++) { const m = pick(G.MATERIALS).name; await giveItem(uid, m, 1); got.push(m); }
    if (stamps === 7) { gold += 2000; await db.run('UPDATE users SET mon_food = MIN(99, mon_food + 3) WHERE id = ?', [uid]); got.push('몬스터 먹이 ×3'); }
    if (stamps === 14) { gold += 4000; for (let i = 0; i < 2; i++) { const m = pick(G.GATE_MATS.filter(x => x.tier === 'r')).name; await giveItem(uid, m, 1); got.push(m); } }
    if (stamps === 21) { await giveItem(uid, 'PVP 회복 포션', 1); got.push('PVP 회복 포션'); gold += 1500; }
    if (stamps === 28) { gold += 8000; const m = pick(G.GATE_MATS.filter(x => x.tier === 'e')).name; await giveItem(uid, m, 1); got.push(m); await giveItem(uid, PROTECT, 1); got.push(PROTECT); }
    await grantGold(uid, gold); await logAcquire(uid, 'gold', '골드', gold, '출석 도장 ' + stamps + '칸', now);
    if (rounds >= ATTEND_TITLE_ROUNDS) await grantTitle(uid, 'regular');
    return { ok: true, stamps, rounds, streak, gold, got, big: [7, 14, 21, 28].includes(stamps) };
  }
  const attendView = async uid => { const a = await db.get('SELECT last_day, stamps, rounds, streak FROM ct_attend WHERE user_id = ?', [uid]); return { stamps: a ? a.stamps : 0, rounds: a ? a.rounds : 0, streak: a ? a.streak : 0, today: !!a && a.last_day === dayKey(Date.now()), len: ATTEND_LEN, big: { 7: '2,000 G + 몬스터 먹이 3', 14: '4,000 G + 희귀 재료 2', 21: 'PVP 회복 포션 + 1,500 G', 28: '8,000 G + 영웅 재료 + 강화 보호 부적' }, daily: ATTEND_GOLD }; };
  route('POST', '/api/attend', async (req, res, ctx) => { send(res, 200, Object.assign(await attend(ctx.user.id, Date.now()), { view: await attendView(ctx.user.id) })); });
  route('GET', '/api/attend', async (req, res, ctx) => { send(res, 200, await attendView(ctx.user.id)); });

  // ═════════ 30 운세 ═════════
  function fortuneFor(code, day, badLast) {
    const h = hash(code + '|' + day);
    let roll = h % 100, k = FORTUNE[FORTUNE.length - 1];
    for (const f of FORTUNE) { if (roll < f.p) { k = f; break; } roll -= f.p; }
    if (badLast && (k.k === 'mid' || k.k === 'small' || k.k === 'bad')) k = FORTUNE[1];       // 지난번 흉 → 이번엔 길 이상
    const regs = G.SPAWN_REGIONS;
    return { kind: k.k, region: regs[(h >>> 7) % regs.length].id, el: ELK[(h >>> 13) % ELK.length], line: (h >>> 17) % FORTUNE_LINES.length };
  }
  const fortuneView = f => { if (!f) return null; const F = FORTUNE.find(x => x.k === f.kind); return { kind: f.kind, ko: F.ko, txt: F.txt, region: f.region, rname: G.placeLong(f.region), el: f.el, line: FORTUNE_LINES[f.line] || '' }; };
  route('GET', '/api/fortune', async (req, res, ctx) => { send(res, 200, { today: fortuneView(await fortuneRow(ctx.user.id, Date.now())), nextAt: nextDayAt(Date.now()) }); });
  route('POST', '/api/fortune', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now(), day = dayKey(now);
    const have = await fortuneRow(uid, now);
    if (have) return send(res, 200, { today: fortuneView(have), already: true });
    const u = await db.get('SELECT code, fortune_bad FROM users WHERE id = ?', [uid]);
    const f = fortuneFor(u.code, day, !!u.fortune_bad);
    const ins = await db.run('INSERT INTO ct_fortune (user_id, day, kind, region, el, line) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, day) DO NOTHING', [uid, day, f.kind, f.region, f.el, f.line]);
    if (ins.changes === 1) {
      await db.run('UPDATE users SET fortune_bad = ? WHERE id = ?', [f.kind === 'bad' ? 1 : 0, uid]);
      if (f.kind === 'bad') { await grantGold(uid, 500); await logAcquire(uid, 'gold', '골드', 500, '오늘의 운세 (흉 위로)', now); }
    }
    send(res, 200, { today: fortuneView(await fortuneRow(uid, now)) });
  });

  // ═════════ 1 장비 강화 ═════════
  function enhInfo(e, plus) {
    const to = (Number(plus) || 0) + 1;
    if (to > ENH_MAX) return null;
    const s = ENH[to], k = G.EQ_GRADE[e.grade].k, t = timeMod(Date.now());
    return { to, rate: Math.min(1, s[0] + (s[0] < 1 ? t.enhance : 0)), gold: Math.round(s[1] * k), mat: enhMat(e, s[2]), durLoss: s[3], drop: !!s[4] };
  }
  route('POST', '/api/equip/enhance', async (req, res, ctx) => {
    if (await limited('enh:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now();
    const r = await db.get('SELECT id, key, dur, plus FROM equip_inv WHERE id = ? AND user_id = ?', [Number(ctx.body.uid) || 0, uid]);
    if (!r || !EQ_BY_ID.has(r.key)) return fail(res, 404, 'no_equip');
    const e = EQ_BY_ID.get(r.key), info = enhInfo(e, r.plus);
    if (!info) return fail(res, 409, 'max');
    if (r.dur <= 0) return fail(res, 409, 'broken');
    const useProtect = !!ctx.body.protect && info.rate < 1;
    if (useProtect && await inv(uid, PROTECT) < 1) return fail(res, 400, 'no_protect');
    if (info.mat && await inv(uid, info.mat) < 1) return fail(res, 400, 'no_mats', { item: info.mat });
    const pay = await db.run('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?', [info.gold, uid, info.gold]);
    if (pay.changes !== 1) return fail(res, 402, 'no_gold', { cost: info.gold });
    const lock = await db.run('UPDATE equip_inv SET plus = plus WHERE id = ? AND user_id = ? AND plus = ?', [r.id, uid, r.plus]);
    if (lock.changes !== 1) { await grantGold(uid, info.gold); return fail(res, 409, 'busy'); }
    if (info.mat) { const t = await take(uid, { [info.mat]: 1 }); if (t.err) { await grantGold(uid, info.gold); return fail(res, 400, 'no_mats', { item: info.mat }); } }
    if (useProtect) await take(uid, { [PROTECT]: 1 });
    const ok = Math.random() < info.rate;
    let plus = r.plus, dur = r.dur, lost = 0, dropped = false;
    if (ok) plus = info.to;
    else if (!useProtect) {
      lost = info.durLoss; dur = Math.max(0, r.dur - lost);
      if (info.drop && plus > 0) { plus -= 1; dropped = true; }
      if (info.to === ENH_MAX) await bump(uid, 'enh10_fail', 1);
    }
    await db.run('UPDATE equip_inv SET plus = ?, dur = ? WHERE id = ? AND user_id = ?', [plus, dur, r.id, uid]);
    send(res, 200, { ok: true, success: ok, plus, dur, lost, dropped, protected: !ok && useProtect, cost: info.gold, mat: info.mat || null, next: enhInfo(e, plus) });
  });

  // ═════════ 7 무한 심층: 주간 기록 · 순위 · 정산 ═════════
  async function abyssRecord(uid, floor, now) {
    if (floor <= ABYSS_FROM) return;
    const wk = weekKey(now);
    await db.run('INSERT INTO ct_gate_week (user_id, week, best, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, week) DO UPDATE SET best = MAX(best, excluded.best), at = CASE WHEN excluded.best > best THEN excluded.at ELSE at END', [uid, wk, floor, now]);
  }
  async function abyssSettle(now) {      // 지난주 순위 보상 (한 번만)
    const prev = weekKey(now - 7 * DAY), key = 'abyss_settled_' + prev;
    const mk = await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', [key, '1']);
    if (mk.changes !== 1) return;
    const rows = await db.all('SELECT user_id, best FROM ct_gate_week WHERE week = ? ORDER BY best DESC, at ASC LIMIT 10', [prev]);
    for (let i = 0; i < rows.length; i++) {
      const rk = i + 1, qty = (ABYSS_REWARD.find(x => rk <= x[0]) || [0, 0])[1];
      if (qty) { await giveItem(rows[i].user_id, ABYSS_MAT, qty); await logAcquire(rows[i].user_id, 'item', ABYSS_MAT, qty, '무한 심층 주간 ' + rk + '위', now); }
      if (rk === 1) await grantTitle(rows[i].user_id, ABYSS_TITLE, Date.parse(weekKey(now) + 'T00:00:00Z') - 9 * HOUR + 7 * DAY);
      await notice(rows[i].user_id, '무한 심층 주간 순위', '지난주 무한 심층 ' + rk + '위 (최고 ' + rows[i].best + '층) · ' + ABYSS_MAT + ' ×' + qty);
    }
    const all60 = await db.all('SELECT user_id FROM ct_gate_week WHERE week = ? AND best >= 60', [prev]);
    for (const r of all60) if (!rows.find(x => x.user_id === r.user_id)) await giveItem(r.user_id, ABYSS_MAT, 3);
  }
  route('GET', '/api/gate/rank', async (req, res, ctx) => {
    const now = Date.now(); await abyssSettle(now);
    const wk = weekKey(now);
    const rows = await db.all('SELECT w.user_id, w.best, u.hunter_name AS hn FROM ct_gate_week w JOIN users u ON u.id = w.user_id WHERE w.week = ? ORDER BY w.best DESC, w.at ASC LIMIT 10', [wk]);
    const me = await db.get('SELECT best FROM ct_gate_week WHERE user_id = ? AND week = ?', [ctx.user.id, wk]);
    send(res, 200, { week: wk, list: rows.map((r, i) => ({ no: i + 1, hn: r.hn, best: r.best, me: r.user_id === ctx.user.id })), me: me ? me.best : 0, resetAt: Date.parse(wk + 'T00:00:00Z') - 9 * HOUR + 7 * DAY, rewards: '1위 심연 결정 ×30 + 칭호 · 2~3위 ×15 · 4~10위 ×8 · 60층 이상 ×3' });
  });

  // ═════════ 20 요리 ═════════
  // 상점 '요리 재료' 탭
  route('GET', '/api/shop/cook', async (req, res, ctx) => {
    const inv = await db.all('SELECT item, qty FROM inventory WHERE user_id = ? AND qty > 0', [ctx.user.id]), have = new Map(inv.map(r => [r.item, Number(r.qty)]));
    send(res, 200, { gold: ctx.user.gold, items: COOK_MATS.map(m => ({ name: m.name, desc: m.desc, price: m.price, have: have.get(m.name) || 0, uses: COOK.filter(c => c.mats[m.name]).map(c => c.name) })) });
  });
  route('POST', '/api/shop/cook/buy', async (req, res, ctx) => {
    if (await limited('buy:' + ctx.user.id, 60, HOUR)) return fail(res, 429, 'rate_limited');
    if (ctx.user.block_flags & 4) return fail(res, 403, 'blocked', { what: 'shop' });
    const m = COOK_MAT_BY.get(String(ctx.body.name || '')), uid = ctx.user.id;
    if (!m) return fail(res, 404, 'no_item');
    const qty = ctx.body.qty === undefined ? 1 : Number(ctx.body.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return fail(res, 400, 'bad_qty');
    const cur = await db.get('SELECT qty FROM inventory WHERE user_id = ? AND item = ?', [uid, m.name]), have = cur ? Number(cur.qty) : 0;
    if (have + qty > 9999) return fail(res, 400, 'max_qty', { room: Math.max(0, 9999 - have) });
    const total = m.price * qty;
    const pay = await db.run('UPDATE users SET gold = gold - ? WHERE id = ? AND gold >= ?', [total, uid, total]);
    if (pay.changes !== 1) return fail(res, 402, 'no_gold');
    try { await giveItem(uid, m.name, qty); } catch (e) { await grantGold(uid, total); throw e; }
    await logAcquire(uid, 'item', m.name, qty, '상점 요리 재료 (-' + total + ' G)', Date.now());
    const me = await db.get('SELECT gold FROM users WHERE id = ?', [uid]);
    send(res, 200, { ok: true, item: m.name, qty, spent: total, gold: me.gold });
  });
  route('GET', '/api/cook', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now();
    const u = await db.get('SELECT buff, buff_until, buff_q FROM users WHERE id = ?', [uid]);
    const list = [];
    for (const c of COOK) list.push({ id: c.id, name: c.name, txt: c.txt, min: c.min, art: c.art, mats: Object.keys(c.mats).map(k => ({ item: k, qty: c.mats[k] })), have: await haveMats(uid, c.mats) });
    const dishes = (await db.all('SELECT item, qty FROM inventory WHERE user_id = ? AND qty > 0', [uid])).filter(r => DISH.has(r.item)).map(r => ({ item: r.item, qty: r.qty, txt: DISH.get(r.item).c.txt, art: DISH.get(r.item).c.art, fine: DISH.get(r.item).q > 1 }));
    send(res, 200, { list, dishes, buff: u.buff && Number(u.buff_until) > now && COOK_BY.has(u.buff) ? { name: COOK_BY.get(u.buff).name, txt: COOK_BY.get(u.buff).txt, until: Number(u.buff_until), fine: Number(u.buff_q) > 1 } : null });
  });
  route('POST', '/api/cook', async (req, res, ctx) => {
    if (await limited('cook:' + ctx.user.id, 40, 60000)) return fail(res, 429, 'rate_limited');
    const c = COOK_BY.get(String(ctx.body.id || '')), uid = ctx.user.id;
    if (!c) return fail(res, 404, 'no_recipe');
    const t = await take(uid, c.mats);
    if (t.err) return fail(res, 400, 'no_mats', { item: t.item });
    const fine = Math.random() < FINE_P, item = c.name + (fine ? ' (일품)' : '');
    await giveItem(uid, item, 1); await logAcquire(uid, 'item', item, 1, '요리', Date.now());
    send(res, 200, { ok: true, item, fine });
  });
  route('POST', '/api/cook/eat', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now(), item = String(ctx.body.item || ''), d0 = DISH.get(item);
    if (!d0) return fail(res, 404, 'not_dish');
    const t = await take(uid, { [item]: 1 });
    if (t.err) return fail(res, 400, 'no_item');
    const u = await db.get('SELECT buff, buff_until, buff_q FROM users WHERE id = ?', [uid]);
    const same = u.buff === d0.c.id && Number(u.buff_until) > now;
    const until = Math.min(now + BUFF_MAX, (same ? Number(u.buff_until) : now) + d0.c.min * MIN);
    await db.run('UPDATE users SET buff = ?, buff_until = ?, buff_q = ? WHERE id = ?', [d0.c.id, until, same ? Math.max(Number(u.buff_q) || 1, d0.q) : d0.q, uid]);
    send(res, 200, { ok: true, buff: { name: d0.c.name, txt: d0.c.txt, until, fine: d0.q > 1 }, replaced: !same && u.buff && Number(u.buff_until) > now ? (COOK_BY.get(u.buff) || {}).name : null });
  });

  // ═════════ 21 낚시 ═════════
  function fishPool(region, now, extra) {
    const t = timeMod(now), d = kst(now), h = d.getUTCHours(), wd = d.getUTCDay(), sea = SEA_SPOTS.has(region);
    return FISH.filter(f => {
      if (f.spots) { if (!f.spots.includes(region)) return false; }
      else if ((f.w === 'fresh' && sea) || (f.w === 'sea' && !sea)) return false;
      if (f.slot && f.slot !== t.slot) return false;
      if (f.day !== undefined && f.day !== wd) return false;
      if (f.hours && !(h >= f.hours[0] && h < f.hours[1])) return false;
      return true;
    });
  }
  function fishRoll(pool, luck, extra) {
    // 등급을 먼저 뽑고(그 자리에 있는 등급만), 그 등급 안에서 고르게 뽑음 → 어종이 많아도 등급 확률은 그대로
    const w = { c: 70, r: 22, e: 7, l: 1 }, lk = Math.min(10, luck * 0.08) + (extra || 0) * 100;
    const tiers = ['c', 'r', 'e', 'l'].filter(k => pool.some(f => f.tier === k));
    const ws = tiers.map(k => k === 'c' ? Math.max(5, w.c - lk) : w[k] + lk * (k === 'r' ? 0.6 : k === 'e' ? 0.3 : 0.1));
    let x = Math.random() * ws.reduce((a, b) => a + b, 0), tier = tiers[tiers.length - 1];
    for (let i = 0; i < tiers.length; i++) { x -= ws[i]; if (x <= 0) { tier = tiers[i]; break; } }
    return pick(pool.filter(f => f.tier === tier));
  }
  const fishDay = async (uid, now) => { const r = await db.get('SELECT n FROM ct_fish_day WHERE user_id = ? AND day = ?', [uid, dayKey(now)]); return r ? Number(r.n) : 0; };
  route('GET', '/api/fish', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now(), u = await userById(uid);
    const here = FISH_SPOTS.has(u.region);
    const log = await db.all('SELECT fish, best, n FROM ct_fish_log WHERE user_id = ?', [uid]);
    send(res, 200, { here, place: G.placeLong(u.region), left: Math.max(0, FISH_DAY - await fishDay(uid, now)), max: FISH_DAY, pool: here ? fishPool(u.region, now).map(f => ({ name: f.name, tier: f.tier, known: !!log.find(x => x.fish === f.name) })) : [], spots: Array.from(FISH_SPOTS).map(id => G.placeLong(id)),
      log: FISH.map(f => { const l = log.find(x => x.fish === f.name); return { name: f.name, tier: f.tier, where: fishWhere(f), best: l ? l.best : 0, n: l ? l.n : 0 }; }) });
  });
  route('POST', '/api/fish/cast', async (req, res, ctx) => {
    if (await limited('fish:' + ctx.user.id, 60, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), u = await userById(uid);
    if (!FISH_SPOTS.has(u.region)) return fail(res, 409, 'not_here');
    const day = dayKey(now);
    const w = await db.run('INSERT INTO ct_fish_day (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1 WHERE n < ?', [uid, day, FISH_DAY]);
    if (w.changes !== 1) return fail(res, 429, 'no_casts');
    let luck = 0; try { luck = Number(JSON.parse(u.stats).luck) || 0; } catch (_) {}
    const b = await bonus(uid, now);
    const f = fishRoll(fishPool(u.region, now), luck + b.luck, b.fish);
    const bite = now + 1000 + Math.floor(Math.random() * 5000), period = Math.round(1600 / f.speed);
    const w0 = Math.random() * (1 - f.win), w1 = w0 + f.win;
    await db.run('INSERT INTO ct_fish_cast (user_id, fish, bite_at, period, w0, w1, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET fish = excluded.fish, bite_at = excluded.bite_at, period = excluded.period, w0 = excluded.w0, w1 = excluded.w1, at = excluded.at', [uid, f.name, bite, period, w0, w1, now]);
    send(res, 200, { ok: true, biteIn: bite - now, period, w0, w1, tier: f.tier, left: FISH_DAY - await fishDay(uid, now) });
  });
  // 눈금 위치: 입질 시각부터 period 동안 0→1→0 을 오갑니다 (서버와 화면이 같은 식을 씀)
  const markAt = (c, t) => { const x = ((t - c.bite_at) % c.period + c.period) % c.period / c.period; return x < 0.5 ? x * 2 : 2 - x * 2; };
  route('POST', '/api/fish/reel', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now();
    const c = await db.get('SELECT fish, bite_at, period, w0, w1, at FROM ct_fish_cast WHERE user_id = ?', [uid]);
    if (!c) return fail(res, 409, 'no_cast');
    await db.run('DELETE FROM ct_fish_cast WHERE user_id = ? AND at = ?', [uid, c.at]);
    if (now < c.bite_at) return send(res, 200, { ok: true, caught: false, why: 'early' });
    if (now > c.bite_at + 6000) return send(res, 200, { ok: true, caught: false, why: 'late' });
    let hit = false;
    for (let t = now - FISH_TOL; t <= now; t += 15) { if (t < c.bite_at) continue; const p = markAt(c, t); if (p >= c.w0 && p <= c.w1) { hit = true; break; } }
    if (!hit) return send(res, 200, { ok: true, caught: false, why: 'miss', fish: c.fish });
    const f = FISH_BY.get(c.fish), cm = f.cm[0] + Math.floor(Math.random() * (f.cm[1] - f.cm[0] + 1));
    await giveItem(uid, f.name, 1); await logAcquire(uid, 'item', f.name, 1, '낚시 (' + cm + 'cm)', now);
    const prev = await db.get('SELECT best FROM ct_fish_log WHERE user_id = ? AND fish = ?', [uid, f.name]);
    await db.run('INSERT INTO ct_fish_log (user_id, fish, best, n) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, fish) DO UPDATE SET best = MAX(best, excluded.best), n = n + 1', [uid, f.name, cm]);
    await grantGold(uid, f.gold);
    if (f.tier === 'l') await grantTitle(uid, 'angler');
    send(res, 200, { ok: true, caught: true, fish: f.name, tier: f.tier, cm, record: !prev || cm > prev.best, gold: f.gold });
  });

  // ═════════ 22 원정 ═════════
  route('GET', '/api/expedition', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now();
    const mons = await db.all('SELECT mon_id, nick, bond, walk_at, exp_spot, exp_from, exp_until FROM user_mons WHERE user_id = ?', [uid]);
    const cap = 1;
    send(res, 200, { cap, now, spots: EXPED.map(x => ({ id: x.id, ko: x.ko, hours: x.hours, bond: x.bond, loot: x.loot.concat(x.epic || []), epic: x.epic || [] })),
      mons: mons.map(r => { const m = G.FRIENDLY_MON.find(x => x.id === r.mon_id) || {}; return { id: r.mon_id, name: r.nick || m.name, grade: m.grade, bond: r.bond, walking: r.walk_at > 0, spot: r.exp_spot || '', spotKo: r.exp_spot ? (EXPED_BY.get(r.exp_spot) || {}).ko : '', from: Number(r.exp_from) || 0, until: Number(r.exp_until) || 0, done: !!r.exp_spot && Number(r.exp_until) <= now }; }) });
  });
  route('POST', '/api/expedition/send', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now(), id = String(ctx.body.id || ''), sp = EXPED_BY.get(String(ctx.body.spot || ''));
    if (!sp) return fail(res, 400, 'bad_spot');
    const r = await db.get('SELECT mon_id, bond, walk_at, exp_spot FROM user_mons WHERE user_id = ? AND mon_id = ?', [uid, id]);
    if (!r) return fail(res, 404, 'not_found');
    if (r.exp_spot) return fail(res, 409, 'on_expedition');
    if (r.walk_at > 0) return fail(res, 409, 'walking');
    if (r.bond < sp.bond) return fail(res, 409, 'low_bond', { need: sp.bond });
    const busy = await db.get("SELECT COUNT(*) AS c FROM user_mons WHERE user_id = ? AND exp_spot <> ''", [uid]);
    if (Number(busy.c) >= 1) return fail(res, 409, 'cap');
    const w = await db.run("UPDATE user_mons SET exp_spot = ?, exp_from = ?, exp_until = ? WHERE user_id = ? AND mon_id = ? AND exp_spot = ''", [sp.id, now, now + sp.hours * HOUR, uid, id]);
    if (w.changes !== 1) return fail(res, 409, 'busy');
    send(res, 200, { ok: true, until: now + sp.hours * HOUR });
  });
  route('POST', '/api/expedition/claim', async (req, res, ctx) => {
    const uid = ctx.user.id, now = Date.now(), id = String(ctx.body.id || '');
    const r = await db.get('SELECT mon_id, nick, bond, sat AS full, sat_at, exp_spot, exp_until FROM user_mons WHERE user_id = ? AND mon_id = ?', [uid, id]);
    if (!r || !r.exp_spot) return fail(res, 404, 'not_found');
    if (Number(r.exp_until) > now) return fail(res, 409, 'not_yet', { until: Number(r.exp_until) });
    const w = await db.run("UPDATE user_mons SET exp_spot = '', exp_from = 0, exp_until = 0 WHERE user_id = ? AND mon_id = ? AND exp_spot = ?", [uid, id, r.exp_spot]);
    if (w.changes !== 1) return fail(res, 409, 'busy');
    const sp = EXPED_BY.get(r.exp_spot) || EXPED[0], stage = G.bondStage(r.bond);
    let n = Math.round((3 + Math.floor(Math.random() * 3)) * (1 + stage * 0.25));
    const full = Math.max(0, Number(r.full) - (Number(r.exp_until) - (Number(r.sat_at) || Number(r.exp_until))) / HOUR * 4);
    if (full >= 70) n += 1;
    const got = {};
    for (let i = 0; i < n; i++) { const it = sp.epic && Math.random() < 0.08 ? pick(sp.epic) : pick(sp.loot); got[it] = (got[it] || 0) + 1; }
    for (const k of Object.keys(got)) { await giveItem(uid, k, got[k]); await logAcquire(uid, 'item', k, got[k], '원정 · ' + sp.ko, now); }
    const m = G.FRIENDLY_MON.find(x => x.id === id) || {};
    send(res, 200, { ok: true, got, diary: (r.nick || m.name) + '(이)가 ' + pick(sp.diary) });
  });

  // ═════════ 12 PVP 리그 ═════════
  async function leagueSeason(uid, now) {      // 새 달이면 지난 시즌 보상을 주고 LP 를 절반으로
    const mk = monthKey(now);
    const u = await db.get('SELECT lp, lp_peak, lp_games, lp_season FROM users WHERE id = ?', [uid]);
    if (u.lp_season === mk) return;
    const w = await db.run('UPDATE users SET lp_season = ? WHERE id = ? AND lp_season = ?', [mk, uid, u.lp_season]);
    if (w.changes !== 1) return;
    if (u.lp_season && Number(u.lp_games) > 0) {
      const ti = tierIdx(Number(u.lp_peak)), T = LEAGUE[ti];
      await grantGold(uid, T.gold); await logAcquire(uid, 'gold', '골드', T.gold, 'PVP 리그 ' + u.lp_season + ' 시즌 보상', now);
      if (T.mat) for (let i = 0; i < T.mat[1]; i++) await giveItem(uid, pick(G.GATE_MATS.filter(x => x.tier === T.mat[0])).name, 1);
      await grantTitle(uid, 'season:' + u.lp_season + ':' + T.k, 0, Number(u.lp_season.slice(5)) + '월 ' + T.ko);
      await notice(uid, 'PVP 리그 시즌 종료', u.lp_season + ' 시즌 최고 티어 ' + T.ko + ' · ' + T.gold.toLocaleString() + ' G' + (T.mat ? ' + 재료' : ''));
      const nl = ti === LEAGUE.length - 1 ? LEAGUE[2].min : Math.floor(Number(u.lp) * 0.5);
      await db.run("UPDATE users SET lp = ?, lp_peak = ?, lp_games = 0, lp_promo = '', lp_prot = 0 WHERE id = ?", [nl, nl, uid]);
    }
  }
  async function leagueResult(winId, loseId, now) {
    await leagueSeason(winId, now); await leagueSeason(loseId, now);
    const rows = await db.all('SELECT id, lp, lp_prot, lp_promo FROM users WHERE id IN (?, ?)', [winId, loseId]);
    const W = rows.find(r => r.id === winId), L = rows.find(r => r.id === loseId);
    if (!W || !L) return {};
    const tw = tierIdx(W.lp), tl = tierIdx(L.lp), out = {};
    const apply = async (r, won, oppTier) => {
      const ti = tierIdx(r.lp), T = LEAGUE[ti], next = LEAGUE[ti + 1];
      let lp = Number(r.lp), prot = Math.max(0, Number(r.lp_prot) - 1), promo = r.lp_promo ? JSON.parse(r.lp_promo) : null, msg = '', d0 = 0;
      if (promo && next) {
        if (won) promo.w++; else promo.l++;
        if (promo.w >= PROMO_NEED) { lp = next.min; promo = null; prot = PROTECT_GAMES; msg = next.ko + ' 승급!'; }
        else if (promo.l >= PROMO_NEED) { lp = next.min - PROMO_FAIL_BACK; promo = null; msg = '승급전 실패'; }
        else msg = '승급전 ' + promo.w + '승 ' + promo.l + '패';
      } else {
        d0 = won ? T.win + (oppTier > ti ? DIFF_BONUS : 0) : -(T.lose + (oppTier < ti ? DIFF_BONUS : 0));
        lp = Math.max(0, lp + d0);
        if (won && next && lp >= next.min) { lp = next.min - 1; promo = { w: 0, l: 0 }; msg = next.ko + ' 승급전 시작 (3전 2승)'; }
        if (!won && lp < T.min && ti > 0) { if (Number(r.lp_prot) > 0) { lp = T.min; msg = '강등 보호'; } else msg = LEAGUE[ti - 1].ko + '(으)로 강등'; }
      }
      await db.run('UPDATE users SET lp = ?, lp_peak = MAX(lp_peak, ?), lp_games = lp_games + 1, lp_prot = ?, lp_promo = ? WHERE id = ?', [lp, lp, prot, promo ? JSON.stringify(promo) : '', r.id]);
      out[r.id] = { d: lp - Number(r.lp), lp, tier: LEAGUE[tierIdx(lp)].ko, msg };
    };
    await apply(W, true, tl); await apply(L, false, tw);
    return out;
  }
  async function leagueView(uid) {
    const now = Date.now(); await leagueSeason(uid, now);
    const u = await db.get('SELECT lp, lp_peak, lp_games, lp_prot, lp_promo FROM users WHERE id = ?', [uid]);
    const ti = tierIdx(u.lp), T = LEAGUE[ti], next = LEAGUE[ti + 1];
    const top = await db.all('SELECT hunter_name AS hn, lp FROM users WHERE lp_games > 0 AND lp_season = ? ORDER BY lp DESC, id ASC LIMIT 20', [monthKey(now)]);
    const end = (() => { const k = kst(now); return Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 1) - 9 * HOUR; })();
    return { lp: u.lp, peak: u.lp_peak, games: u.lp_games, tier: T.k, tierKo: T.ko, min: T.min, next: next ? next.min : null, nextKo: next ? next.ko : null, prot: u.lp_prot, promo: u.lp_promo ? JSON.parse(u.lp_promo) : null, seasonEnd: end,
      tiers: LEAGUE.map(x => ({ k: x.k, ko: x.ko, min: x.min, win: x.win, lose: x.lose, gold: x.gold })), top: top.map((r, i) => ({ no: i + 1, hn: r.hn, lp: r.lp, tierKo: LEAGUE[tierIdx(r.lp)].ko })) };
  }
  route('GET', '/api/pvp/league', async (req, res, ctx) => { send(res, 200, await leagueView(ctx.user.id)); });

  async function takeNews(uid) {
    const rows = await db.all('SELECT id, title, body FROM ct_news WHERE user_id = ? ORDER BY id LIMIT 5', [uid]);
    if (rows.length) await db.run('DELETE FROM ct_news WHERE user_id = ? AND id <= ?', [uid, rows[rows.length - 1].id]);
    return rows.map(r => ({ title: r.title, body: r.body }));
  }
  // ── 화면 상태에 붙는 정보 (/api/state) ──
  async function stateExtra(uid, now) {
    const t = timeMod(now), u = await db.get('SELECT buff, buff_until, buff_q FROM users WHERE id = ?', [uid]);
    const f = await fortuneRow(uid, now), a = await db.get('SELECT last_day FROM ct_attend WHERE user_id = ?', [uid]);
    return { time: { slot: t.slot, slotKo: t.slotKo, dayKo: t.dayKo, els: t.els, slotTxt: t.slotTxt, dayTxt: t.dayTxt },
      buff: u.buff && Number(u.buff_until) > now && COOK_BY.has(u.buff) ? { name: COOK_BY.get(u.buff).name, txt: COOK_BY.get(u.buff).txt, until: Number(u.buff_until) } : null,
      fortune: f ? { ko: (FORTUNE.find(x => x.k === f.kind) || {}).ko, region: f.region, rname: G.placeLong(f.region) } : null, attended: !!a && a.last_day === dayKey(now), title: await titleOf(uid), news: await takeNews(uid) };
  }

  return {
    timeMod, bonus, pickName, variantChance, rollVariant, onKill, bump, grantTitle, titleOf, abyssRecord, abyssSettle, leagueResult, leagueView, stateExtra, enhInfo, plusVal,
    VARIANT_MUL, VARIANT_SPECIES, ABYSS_FROM, ABYSS_MAT, EXTRA_MAT_TIER, DISH, purge: id => PURGE.map(p => [p[0], p[1] === 2 ? [id, id] : [id]]),
  };
}
// 인벤토리 '조합 아이템' 탭에 들어가는 새 재료와 등급
const EXTRA_MAT_TIER = new Map([[VARIANT_DROP, 'e'], [ABYSS_MAT, 'r']].concat(FISH.map(f => [f.name, f.tier]), COOK_MATS.map(m => [m.name, 'c'])));      // 어종·요리 재료는 조합 재료로

module.exports = { install, SQL, timeMod, EXTRA_MAT_TIER, ENH, ENH_MAX, PROTECT, LEAGUE, TITLES, COOK, FISH, EXPED, FISH_SPOTS };
