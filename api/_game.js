'use strict';
// 게임 규칙 — 서버만 이 값을 사용해 결과를 결정합니다.
const crypto = require('node:crypto');

const rnd = (a, b) => crypto.randomInt(a, b + 1);          // a~b (양끝 포함)
const chance01 = () => crypto.randomInt(0, 1000000) / 1000000;

const REGIONS = [
  { id: 'city',   name: '도심' },
  { id: 'mine',   name: '폐광' },
  { id: 'river',  name: '한강변' },
  { id: 'temple', name: '산사' },
  { id: 'port',   name: '폐항' },
  { id: 'gate',   name: '적월 게이트' },
];
const REGION_BY_ID = Object.fromEntries(REGIONS.map(r => [r.id, r]));

const MON = {
  F: ['오염된 쥐떼', '허깨비'],
  E: ['도깨비 변이체', '오염체'],
  D: ['그림자 늑대', '강시 무리', '귀화 군집'],
  C: ['야차', '구미호 분신'],
  B: ['이무기 유체', '불가사리'],
  A: ['백귀야행', '천년 야차왕'],
  S: ['적월의 군주', '흑룡 이무기'],
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
const ACTIVE_MS = 30 * MIN;                       // 출몰 후 토벌 가능한 시간

const KILL_EXP = { F: 8, E: 12, D: 20, C: 35, B: 60, A: 120, S: 300 };
const HUNT_DIFF = { F: '쉬움', E: '쉬움', D: '쉬움', C: '보통', B: '보통', A: '어려움', S: '매우 어려움' };
const HUNT_BASE = { '쉬움': 0.85, '보통': 0.65, '어려움': 0.4 };

const RAID_NEED = 10;                              // S급 100% 참여 기준 인원
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
function huntChance(r, lv, participants) {
  if (r === 'S') {
    const lb = Math.min(0.1, (lv - 1) * 0.01);
    const p = 0.05 + 0.9 * Math.min(1, participants / RAID_NEED) + lb;
    return Math.max(0.05, Math.min(0.95, p));
  }
  const p = HUNT_BASE[HUNT_DIFF[r]] + Math.min(0.12, (lv - 1) * 0.015);
  return Math.max(0.05, Math.min(0.97, p));
}

function rollRank() {
  const r = chance01();
  return r < 0.5 ? 'F' : r < 0.65 ? 'E' : r < 0.8 ? 'D' : r < 0.875 ? 'C' : r < 0.95 ? 'B' : 'A';
}
const RANK_BASE = { F: 8, E: 11, D: 15, C: 20, B: 27, A: 36 };
function rollStats(rank) {
  const b = RANK_BASE[rank] || 8;
  const v = () => Math.max(1, b + rnd(-2, 3));
  return { hp: v(), str: v(), agi: v(), luck: v(), taint: 0 };
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
  rnd, chance01, REGIONS, REGION_BY_ID, MON, TIERS, ACTIVE_MS, KILL_EXP, HUNT_DIFF,
  RAID_NEED, S_MAX, S_WINDOW_MS, S_WAIT_MS, powNeed, cdOf, huntChance,
  rollRank, rollStats, makeCode, addExp, MIN, HOUR,
};
