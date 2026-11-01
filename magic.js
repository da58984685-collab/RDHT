'use strict';
// 마법소녀 이벤트 (마법소녀 테마가 켜져 있을 때만): 1차 묶음
//  변신(쿨타임마다 · 회당 30분 버프) · 1 변신 주문 짓기 · 2 코스튬 디자인 · 3 마법소녀 팀 · 4 정화의 노래 · 5 별자리 잇기
// 판정·보상은 모두 서버(이 파일)가 정하고, 화면(mg.js)은 결과만 그립니다. 시간 기준은 한국 시간(KST).

const HOUR = 3600000, MIN = 60000;
const kst = now => new Date(now + 9 * HOUR);
const dayKey = now => kst(now).toISOString().slice(0, 10);
const weekKey = now => { const d = kst(now), wd = (d.getUTCDay() + 6) % 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - wd)).toISOString().slice(0, 10); };
const prevWeek = now => weekKey(now - 7 * 24 * HOUR);
const hash = s => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const cp = s => Array.from(String(s)).length;

// ───────── 변신 ─────────
const TF_BUFF = 30 * MIN;          // 변신 한 번에 30분 버프
const TF_CD = 2 * HOUR;            // 다음 변신까지 쉬는 시간 (변신한 순간부터)
const TF_FX = { exp: 0.10, gold: 0.10, hpGuard: 5 };          // 변신 중: 경험치·골드 +10%, 체력 피해 -5%
const JOINT_FX = { exp: 0.05, gold: 0.05, luck: 3 };           // 합동 변신(팀 3명 모두 오늘 변신) 중 추가
const DEF_SPELL = '샤랄라 반짝, 별빛이여 모여라!';
// 이벤트가 시작된 뒤 처음 들어올 때 직접 따라 적어야 하는 맹세 주문 (띄어쓰기는 몇 칸이든 한 칸으로 봅니다)
const OATH = '눈물은 칼집에, 맹세는 칼끝에';
const oathNorm = t => String(t == null ? '' : t).normalize('NFC').replace(/\s+/g, ' ').trim();

// ───────── 1 변신 주문 ─────────
const SPELL_MAX = 30, VOTE_WEEK = 5;      // 주문 30자 · 한 주에 '반짝' 5번 (같은 주문엔 한 번)

// ───────── 2 코스튬 ─────────
const COS = {
  r: [['bow', '큰 나비 리본'], ['star', '별 리본'], ['heart', '하트 리본'], ['cat', '고양이 귀 리본'], ['crown', '작은 왕관']],
  s: [['puff', '퍼프 치마'], ['frill', '프릴 치마'], ['bell', '종 치마'], ['tulip', '튤립 치마'], ['long', '긴 드레스']],
  c: [['sakura', '벚꽃'], ['sky', '하늘'], ['lemon', '레몬'], ['lavender', '라벤더'], ['mint', '민트']],
  w: [['star', '별'], ['heart', '하트'], ['moon', '초승달'], ['gem', '보석'], ['flower', '꽃']],
};
const COS_KEYS = ['r', 's', 'c', 'w'];
const cosOk = o => COS_KEYS.every(k => COS[k].some(p => p[0] === o[k]) || COS_SHOP.some(p => p[0] === k && p[1] === o[k]));      // 기본 부품 + 거울 상점 부품

// ───────── 3 팀 ─────────
const TEAM_COLORS = ['pink', 'sky', 'yellow'], TEAM_KO = { pink: '분홍', sky: '하늘', yellow: '노랑' }, TEAM_MAX = 3, TEAM_NAME_MAX = 12;

// ───────── 4 정화의 노래 ─────────
const SONG_DAY = 3, SONG_N = 28, SONG_MAX = 25;      // 하루 3번 · 별 28개 · 정확도 100%면 오염도 -25

function songChart(seed) {
  const r = rng(seed), notes = [];
  let t = 1600;
  for (let i = 0; i < SONG_N; i++) { notes.push({ t: Math.round(t), l: Math.floor(r() * 3) }); t += [360, 420, 480, 540, 600, 720][Math.floor(r() * 6)]; }
  return { notes, len: Math.round(t + 900) };
}

// ───────── 5 별자리 ─────────
// 판은 10×7 칸. 별 좌표 [x, y], 이을 선은 별 번호 쌍
const STARS = [
  { k: 'rabbit', ko: '토끼자리', fx: { agi: 5 }, txt: '민첩 +5',
    s: [[2, 0], [4, 0], [3, 2], [5, 3], [7, 3], [8, 5], [5, 5]], e: [[0, 2], [1, 2], [2, 3], [3, 4], [4, 5], [3, 6], [6, 5]] },
  { k: 'crown', ko: '왕관자리', fx: { luck: 5 }, txt: '행운 +5',
    s: [[0, 4], [2, 2], [4, 1], [6, 1], [8, 2], [9, 4], [5, 3]], e: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 3]] },
  { k: 'lion', ko: '사자자리', fx: { str: 5 }, txt: '근력 +5',
    s: [[2, 2], [3, 0], [5, 0], [6, 2], [5, 3], [7, 4], [9, 6], [4, 6]], e: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [4, 5], [5, 6], [5, 7]] },
  { k: 'swan', ko: '백조자리', fx: { hpGuard: 8 }, txt: '체력 피해 -8%',
    s: [[5, 0], [5, 2], [5, 4], [5, 6], [1, 3], [9, 1]], e: [[0, 1], [1, 2], [2, 3], [4, 1], [1, 5]] },
  { k: 'aqua', ko: '물병자리', fx: { taintRes: 10 }, txt: '오염도 증가 -10%',
    s: [[1, 1], [3, 2], [4, 0], [6, 2], [7, 0], [8, 4], [6, 6]], e: [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5], [5, 6]] },
  { k: 'whale', ko: '고래자리', fx: { exp: 0.05 }, txt: '토벌 경험치 +5%',
    s: [[1, 3], [3, 1], [5, 2], [7, 1], [9, 3], [6, 5], [3, 5]], e: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0]] },
  { k: 'lyra', ko: '거문고자리', fx: { gold: 0.05 }, txt: '토벌 골드 +5%',
    s: [[4, 0], [3, 2], [6, 2], [2, 6], [7, 6]], e: [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 4]] },
];
// 오늘의 별자리 + 가짜 별 3개 + 섞은 번호 (같은 날에는 모두에게 같은 판)
function starToday(now) {
  const day = dayKey(now), r = rng(hash('star:' + day)), C = STARS[hash('sk:' + day) % STARS.length];
  const used = new Set(C.s.map(p => p[0] + ',' + p[1])), pts = C.s.map(p => ({ x: p[0], y: p[1], real: true }));
  let guard = 0;
  while (pts.length < C.s.length + 3 && guard++ < 200) {
    const x = Math.floor(r() * 10), y = Math.floor(r() * 7), key = x + ',' + y;
    if (used.has(key)) continue;
    if ([[0, 1], [1, 0], [0, -1], [-1, 0]].some(d => used.has((x + d[0]) + ',' + (y + d[1])))) continue;      // 진짜 별에 바로 붙지 않게
    used.add(key); pts.push({ x, y, real: false });
  }
  const order = pts.map((p, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const idOf = i => order.indexOf(i);      // 원래 번호 → 화면 번호
  return { C, day, stars: order.map(i => ({ id: idOf(i), x: pts[i].x, y: pts[i].y })).sort((a, b) => a.id - b.id), edges: C.e.map(e => [idOf(e[0]), idOf(e[1])]) };
}
const edgeKey = e => Math.min(e[0], e[1]) + '-' + Math.max(e[0], e[1]);

// ═════════════ 2차 묶음 ═════════════
// ───────── 6 요정의 편지 ─────────
// 요정 3종 중 한 명과 계약 (이벤트 동안 바꿀 수 없음). 하루 한두 번 메신저로 편지 → 답장 3개 중 하나 → 기분·친밀도가 바뀜.
// 기분이 좋으면 다음 변신 시간이 늘어납니다 (60 이상 +5분, 80 이상 +10분). 하루가 지나도록 답장하지 않은 편지는 기분 -4.
const FAIRIES = {
  lumi: { ko: '루미', kind: '별빛 요정', tag: '밝고 수다스러워요' },
  pio: { ko: '피오', kind: '꽃잎 요정', tag: '수줍고 다정해요' },
  nea: { ko: '네아', kind: '달빛 요정', tag: '조용하고 깊어요' },
};
const MOOD0 = 60, FBOND_MAX = 100;
const moodBonus = m => (m >= 80 ? 10 : m >= 60 ? 5 : 0);      // 변신 시간 + 분
const moodKo = m => (m >= 80 ? '아주 좋아요' : m >= 60 ? '좋아요' : m >= 40 ? '보통이에요' : m >= 20 ? '시무룩해요' : '토라졌어요');
const bondTier = b => (b >= 60 ? 2 : b >= 25 ? 1 : 0);
// 대화 편지: [요정][친밀도 단계] = [[편지, [[답장, 기분, 친밀도] ×3]] ×2]
const CHAT = {
  lumi: [
    [['헌터! 오늘 하늘 봤어? 별이 하나 새로 생겼어. 내가 이름 붙여도 돼?', [['당연하지! 뭐라고 지을 거야?', 8, 2], ['별이 새로 생기기도 해?', 3, 1], ['바빠서 못 봤어.', -6, 0]]],
     ['변신할 때 내 이름도 한 번 불러 줄래? 그럼 힘이 두 배가 될 것 같아!', [['루미! 이렇게?', 8, 2], ['생각해 볼게.', 1, 1], ['그런 효과는 없잖아.', -5, 0]]]],
    [['어제 꿈에 네가 나왔어. 붉은 달 아래서 칼을 들고 서 있었는데… 조금 무서웠지만 멋있었어.', [['무서워하지 마, 내가 지켜 줄게.', 8, 3], ['무슨 칼이었어?', 3, 2], ['꿈은 꿈일 뿐이야.', -4, 1]]],
     ['오늘은 반짝이는 걸 하나 주웠어! 너한테 주고 싶은데, 받아 줄 거지?', [['고마워, 소중히 할게!', 8, 3], ['뭔데? 보여 줘.', 4, 2], ['필요 없어.', -7, 0]]]],
    [['있잖아, 계약 맺은 날 기억나? 그날부터 내 빛이 조금씩 더 밝아졌어. 다 네 덕분이야.', [['나도 루미 덕분에 버텨.', 9, 3], ['정말? 신기하다.', 4, 2], ['그냥 기분 탓 아닐까.', -5, 1]]],
     ['혹시 언젠가 내 빛이 꺼지면… 그때도 나를 기억해 줄래?', [['꺼지게 두지 않을 거야.', 9, 3], ['갑자기 왜 그런 말을 해?', 3, 2], ['그런 얘긴 하지 말자.', -2, 1]]]],
  ],
  pio: [
    [['저, 저기… 오늘 토벌 다녀오셨어요? 다치지는 않으셨죠…?', [['응, 멀쩡해. 걱정해 줘서 고마워.', 8, 2], ['조금 긁혔어.', 3, 1], ['신경 쓰지 마.', -6, 0]]],
     ['제 날개가 오늘 좀 구겨졌어요… 이상해 보여요?', [['전혀, 오늘도 예뻐.', 8, 2], ['살짝? 금방 펴질 거야.', 2, 1], ['잘 모르겠는데.', -4, 0]]]],
    [['헌터님이 변신하는 모습을 보면 가슴이 콩닥거려요. 저도 언젠가 더 커질 수 있을까요?', [['피오는 지금도 충분히 멋져.', 8, 3], ['같이 커 가자.', 6, 2], ['요정은 원래 작잖아.', -6, 1]]],
     ['오늘 바람이 엄청 셌어요. 날아가지 않으려고 헌터님 주머니에 숨어 있었던 거, 눈치채셨어요?', [['어쩐지 따뜻하더라.', 8, 3], ['전혀 몰랐어!', 3, 2], ['허락 없이 들어오지 마.', -7, 0]]]],
    [['헌터님은 제가 무서워하는 것도 다 알고 계시죠. 그래서… 같이 있으면 덜 무서워요.', [['앞으로도 옆에 있을게.', 9, 3], ['뭐가 제일 무서운데?', 4, 2], ['혼자서도 해야지.', -5, 1]]],
     ['붉은 달이 뜨는 밤엔 잠이 안 와요. 오늘 밤만 편지를 조금 길게 써도 될까요?', [['얼마든지. 다 읽을게.', 9, 3], ['졸리면 바로 자.', 3, 2], ['짧게 부탁해.', -6, 0]]]],
  ],
  nea: [
    [['달은 매일 조금씩 깎이고, 또 차올라. 너도 오늘 조금 깎였니?', [['응, 좀 지쳤어.', 8, 2], ['난 오늘 꽉 찼어!', 5, 1], ['무슨 말인지 모르겠어.', -5, 0]]],
     ['칼집에 넣은 눈물은 녹슬지 않아. 그러니 참지 않아도 돼.', [['고마워, 네아.', 8, 2], ['눈물 흘릴 일 없어.', 2, 1], ['설교는 됐어.', -6, 0]]]],
    [['어젯밤 마물 하나가 울면서 사라졌어. 정화된다는 건 슬픈 걸까, 다행인 걸까.', [['다행이라고 믿고 싶어.', 8, 3], ['둘 다 아닐까.', 7, 2], ['마물한테 감정이 어딨어.', -6, 1]]],
     ['네 맹세를 들은 날부터 달빛이 덜 차가워졌어. 신기하지.', [['네아가 따뜻해진 거야.', 8, 3], ['기분 탓 아냐?', 2, 1], ['달빛은 원래 차갑지.', -4, 1]]]],
    [['언젠가 맹세가 무거워지면 반만 나한테 맡겨. 나는 원래 밤에 강하니까.', [['그럼 반씩 나눠 들자.', 9, 3], ['괜찮아, 아직 버틸 만해.', 4, 2], ['내 짐은 내가 들어.', -3, 1]]],
     ['끝이 오더라도 나는 마지막까지 네 그림자에 있을 거야. 그게 계약이니까.', [['계약이 아니어도 같이 있자.', 9, 3], ['끝 같은 건 오지 않아.', 5, 2], ['무겁게 굴지 마.', -5, 0]]]],
  ],
};
// 힌트 편지 (그날 실제 정보로 채움): {r} 지역, {ko} 별자리, {txt} 효과
const HINT = {
  lumi: { mon: '오늘 {r} 쪽에 마물이 잔뜩 보여! 조심해서 다녀와!', star: '오늘 밤하늘엔 {ko}가 떠! 이어 주면 {txt}래!', taint: '요즘 얼굴이 좀 어두워… 정화의 노래 같이 부를래?', calm: '오늘은 하늘이 맑아! 변신하기 딱 좋은 날이야.', hello: '계약 고마워! 오늘부터 난 너의 별빛이야. 하루 한두 번 편지 보낼게!' },
  pio: { mon: '저기… 오늘 {r} 쪽에 마물이 많이 보였어요. 조심하세요…', star: '오늘은 {ko}가 보여요. 이으면 {txt}래요.', taint: '몸이 무거워 보여요… 정화의 노래를 불러 보시면 어떨까요?', calm: '오늘은 조용한 날이에요. 천천히 다녀오세요.', hello: '계, 계약해 주셔서 고마워요… 하루에 한두 번, 편지 드려도 될까요?' },
  nea: { mon: '{r} 쪽 공기가 탁해. 마물이 많아. 칼끝을 세워 두렴.', star: '오늘 하늘엔 {ko}. 이으면 {txt}.', taint: '탁한 기운이 쌓였어. 노래로 씻어 내.', calm: '오늘 밤은 고요해. 이런 밤엔 맹세가 또렷해지지.', hello: '계약은 맺어졌어. 하루 한두 번, 달이 움직일 때마다 편지를 보낼게.' },
};
const HINT_OPTS = [['고마워! 조심할게.', 5, 1], ['알려 줘서 고마워.', 3, 1], ['알아서 할게.', -4, 0]];
const HELLO_OPTS = [['잘 부탁해!', 6, 2], ['응, 기다릴게.', 4, 1], ['너무 자주는 말고.', -3, 0]];
const REACT = { lumi: ['헤헤, 역시 너야!', '응응, 알았어!', '…칫, 알았어.'], pio: ['고, 고마워요…!', '네, 알겠어요.', '아… 죄송해요.'], nea: ['…고마워. 따뜻하네.', '그래.', '…그렇구나.'] };

// ───────── 7 마법 일기장 ─────────
const STAMP_DAYS = 7, DIARY_DAYS = 35;

// ───────── 8 소원 별똥별 ─────────
// 하루 4번(한국 시간 9시~23시 반 사이 무작위), 30초 동안 지구본 위로 지나갑니다. 누른 헌터 모두 같은 보상, 누른 사람이 많을수록 커짐.
const SHOOT_N = 4, SHOOT_DUR = 30000, SHOOT_GRACE = 4000, SHOOT_EARLY = 15000;
const shootReward = n => { const k = Math.min(Math.max(1, n), 25); return { gold: 80 + 40 * k, exp: 30 + 15 * k }; };

// ───────── 9 마물을 친구로 ─────────
// 정화(토벌 성공) 때 낮은 확률(6%, 20번 연속 없으면 다음엔 꼭)로 '착해진 마물'이 따라옴. 종류마다 한 마리, 하루 2마리까지.
const PET_CHANCE = 0.06, PET_PITY = 20, PET_DAY = 2;
const PET_ACT = { pet: { add: 6, cd: HOUR, ko: '쓰다듬기' }, play: { add: 12, cd: 3 * HOUR, ko: '놀아 주기' } };
const PET_DONE_GOLD = 300;
const PETS = [
  { k: 'sock', ko: '짝 잃은 양말', s: ['한 짝뿐인 양말이 구석에서 훌쩍이고 있어요.', '양말이 손가락을 꼭 감쌌어요. 짝을 찾는 꿈을 꾼대요.', '빨래 바구니 옆에서 익숙한 무늬를 봤대요!', '드디어 짝을 찾았어요! 두 짝이 나란히 폴짝폴짝.'] },
  { k: 'umbrella', ko: '길 잃은 우산', s: ['버려진 우산이 비에 젖은 채 떨고 있어요.', '우산이 살을 활짝 펴 보였어요. 아직 쓸모 있대요.', '손잡이에 붙은 이름표 조각을 찾았어요.', '주인 이름을 기억해 냈어요! 이제 맑은 날에도 웃어요.'] },
  { k: 'pillow', ko: '잠 못 드는 베개', s: ['밤새 뒤척인 베개가 눈 밑이 퀭해요.', '토닥토닥 해 주니 하품을 했어요.', '자장가를 듣고 꾸벅꾸벅 졸아요.', '드디어 푹 잠들었어요. 쿨쿨… 꿈속에서도 웃어요.'] },
  { k: 'key', ko: '녹슨 열쇠', s: ['아무 문도 못 여는 열쇠가 풀이 죽어 있어요.', '녹을 닦아 주니 조금 반짝여요.', '어딘가에서 딸깍 소리가 들린 것 같대요.', '맞는 자물쇠를 찾았어요! 딸깍, 보물 상자가 열렸어요.'] },
  { k: 'candle', ko: '꺼질 뻔한 촛불', s: ['바람에 꺼질 듯 말 듯 흔들리는 촛불이에요.', '두 손으로 감싸 주니 불꽃이 조금 커졌어요.', '이제 혼자서도 꼿꼿이 서 있어요.', '다시 환하게 타올라요! 방 안이 따뜻해졌어요.'] },
  { k: 'balloon', ko: '바람 빠진 풍선', s: ['쭈글쭈글 바람 빠진 풍선이 바닥을 굴러요.', '후~ 불어 주니 살짝 부풀었어요.', '둥실, 발끝이 땅에서 떨어졌어요!', '빵빵하게 부풀어 하늘 높이 둥실 떠올랐어요.'] },
  { k: 'teacup', ko: '이 빠진 찻잔', s: ['가장자리가 깨진 찻잔이 부끄러워 숨어 있어요.', '따뜻한 차를 부어 주니 김이 몽글몽글.', '깨진 곳을 금빛으로 메워 주기로 했어요.', '금빛 이음새가 반짝반짝! 세상에 하나뿐인 찻잔이 됐어요.'] },
  { k: 'kite', ko: '줄 끊긴 연', s: ['줄이 끊긴 연이 나뭇가지에 걸려 있어요.', '조심조심 내려 주니 꼬리를 살랑였어요.', '새 줄을 묶어 주었어요. 바람을 기다려요.', '바람을 타고 하늘 높이! 줄 끝에서 신나게 춤춰요.'] },
];
const petStage = h => (h >= 100 ? 3 : h >= 60 ? 2 : h >= 30 ? 1 : 0);

// ───────── 10 마법소녀 연출 대결 ─────────
// 빛 > 리본 > 노래 > 빛. 3턴 동안 하나씩 (미리 3개를 골라 둠). 이긴 쪽은 진 쪽 코스튬 부품 하나를 구경하는 '반짝 카드'.
const DUEL_BEAT = { l: 'r', r: 's', s: 'l' }, DUEL_KO = { l: '빛', r: '리본', s: '노래' }, DUEL_DAY = 10, DUEL_WAIT = 24 * HOUR;
const picksOk = p => typeof p === 'string' && /^[lrs]{3}$/.test(p);

// ═════════════ 3차 묶음 ═════════════
// ───────── 11 마법 학교 수업 ─────────
// 이벤트를 켠 주부터 매주 한 과목씩(4과목을 돌아가며). 과목마다 기존 활동 3가지를 채우면 수료증, 4과목을 모두 수료하면 졸업 칭호.
const SUBJ = [
  { k: 'fly', ko: '비행 수업', desc: '하늘을 나는 감각을 익혀요.', t: [['move', '지역 이동', 5], ['hunt', '토벌 성공', 5], ['star', '별자리 잇기', 1]] },
  { k: 'potion', ko: '물약 수업', desc: '재료를 섞어 정화의 힘을 담아요.', t: [['craft', '조합', 2], ['song', '정화의 노래', 1], ['hunt', '토벌 성공', 5]] },
  { k: 'star', ko: '별 읽기 수업', desc: '밤하늘과 요정의 말을 읽어요.', t: [['star', '별자리 잇기', 2], ['tf', '변신', 3], ['letter', '요정에게 답장', 2]] },
  { k: 'care', ko: '마물 돌봄 수업', desc: '작은 생명을 돌보는 법을 배워요.', t: [['raise', '육성 먹이·목욕', 3], ['pet', '마물 친구 돌보기', 3], ['hunt', '토벌 성공', 8]] },
];
// ───────── 12 거울 나라의 나 ─────────
// 내 PVP 스탯을 뒤집은 분신(1↔5, 2↔4). 한 주에 한 번 나타나고 3번까지 도전, 쓰러뜨리면 거울 조각 → 거울 상점에서 코스튬 부품.
const MIRROR_TRIES = 3, SHARD_WIN = 6, MIRROR_TITLE = 4;
const COS_SHOP = [['r', 'tiara', '거울 티아라', 6], ['r', 'bunny', '토끼 귀', 5], ['s', 'moon', '달빛 드레스', 8], ['c', 'midnight', '한밤', 5], ['c', 'ruby', '적월', 6], ['w', 'mirror', '손거울', 6]];
// ───────── 13 반짝 우체통 ─────────
const MAIL_MAX = 50, MAIL_DAY = 3;
// ───────── 14 리본 묶기 ─────────
const RIB_COLORS = ['pink', 'sky', 'yellow', 'lavender', 'mint'], RIB_KO = { pink: '분홍', sky: '하늘', yellow: '노랑', lavender: '보라', mint: '민트' }, RIB_FX = 0.05;

const SQL = [
  "CREATE TABLE IF NOT EXISTS mg_state (user_id INTEGER PRIMARY KEY, tf_until INTEGER NOT NULL DEFAULT 0, tf_next INTEGER NOT NULL DEFAULT 0, tf_total INTEGER NOT NULL DEFAULT 0, cos TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE IF NOT EXISTS mg_day (user_id INTEGER NOT NULL, day TEXT NOT NULL, tf INTEGER NOT NULL DEFAULT 0, song INTEGER NOT NULL DEFAULT 0, star TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, day))",
  "CREATE TABLE IF NOT EXISTS mg_spell (user_id INTEGER NOT NULL, week TEXT NOT NULL, text TEXT NOT NULL, votes INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, week))",
  "CREATE INDEX IF NOT EXISTS mg_spell_w ON mg_spell(week, votes)",
  "CREATE TABLE IF NOT EXISTS mg_vote (voter INTEGER NOT NULL, owner INTEGER NOT NULL, week TEXT NOT NULL, PRIMARY KEY (voter, owner, week))",
  "CREATE TABLE IF NOT EXISTS mg_team (leader INTEGER PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS mg_team_mem (user_id INTEGER PRIMARY KEY, leader INTEGER NOT NULL, color TEXT NOT NULL, at INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS mg_team_mem_l ON mg_team_mem(leader)",
  "CREATE TABLE IF NOT EXISTS mg_team_inv (to_id INTEGER NOT NULL, leader INTEGER NOT NULL, at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (to_id, leader))",
  "ALTER TABLE mg_state ADD COLUMN oath TEXT NOT NULL DEFAULT ''",      // 맹세 주문을 적은 이벤트 회차 (mg_epoch)
  "CREATE TABLE IF NOT EXISTS mg_song (user_id INTEGER PRIMARY KEY, seed INTEGER NOT NULL, at INTEGER NOT NULL)",
  // ── 2차 묶음 ──
  "ALTER TABLE mg_state ADD COLUMN diary_pub INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE mg_state ADD COLUMN pet_pity INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE mg_day ADD COLUMN wish INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE mg_day ADD COLUMN duel INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE mg_day ADD COLUMN dn INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE mg_day ADD COLUMN pet TEXT NOT NULL DEFAULT ''",
  "CREATE TABLE IF NOT EXISTS mg_fairy (user_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, mood INTEGER NOT NULL DEFAULT 60, bond INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS mg_letter (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, day TEXT NOT NULL, slot INTEGER NOT NULL, text TEXT NOT NULL, opts TEXT NOT NULL, pick INTEGER NOT NULL DEFAULT -1, react TEXT NOT NULL DEFAULT '', seen INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS mg_letter_u ON mg_letter(user_id, day, slot)",
  "CREATE TABLE IF NOT EXISTS mg_diary (user_id INTEGER NOT NULL, day TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, day))",
  "CREATE TABLE IF NOT EXISTS mg_wish (sid TEXT NOT NULL, user_id INTEGER NOT NULL, at INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (sid, user_id))",
  "CREATE INDEX IF NOT EXISTS mg_wish_u ON mg_wish(user_id, paid)",
  "CREATE TABLE IF NOT EXISTS mg_pet (user_id INTEGER NOT NULL, kind TEXT NOT NULL, happy INTEGER NOT NULL DEFAULT 0, pet_at INTEGER NOT NULL DEFAULT 0, play_at INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (user_id, kind))",
  "CREATE TABLE IF NOT EXISTS mg_duel (id INTEGER PRIMARY KEY AUTOINCREMENT, a INTEGER NOT NULL, b INTEGER NOT NULL DEFAULT 0, ap TEXT NOT NULL, bp TEXT NOT NULL DEFAULT '', st TEXT NOT NULL, win INTEGER NOT NULL DEFAULT 0, card TEXT NOT NULL DEFAULT '', seen_a INTEGER NOT NULL DEFAULT 0, seen_b INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, done_at INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS mg_duel_st ON mg_duel(st, at)",
  "CREATE INDEX IF NOT EXISTS mg_duel_a ON mg_duel(a, id)",
  "CREATE INDEX IF NOT EXISTS mg_duel_b ON mg_duel(b, id)",
  "CREATE TABLE IF NOT EXISTS mg_card (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, from_name TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS mg_card_u ON mg_card(user_id, id)",
  // ── 3차 묶음 ──
  "CREATE TABLE IF NOT EXISTS mg_act (user_id INTEGER NOT NULL, week TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, week, k))",
  "CREATE TABLE IF NOT EXISTS mg_cert (user_id INTEGER NOT NULL, subj TEXT NOT NULL, week TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, subj))",
  "ALTER TABLE mg_state ADD COLUMN shards INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE mg_state ADD COLUMN mirror_wins INTEGER NOT NULL DEFAULT 0",
  "CREATE TABLE IF NOT EXISTS mg_mirror (user_id INTEGER NOT NULL, week TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, win INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, week))",
  "CREATE TABLE IF NOT EXISTS mg_cos_own (user_id INTEGER NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, k, v))",
  "CREATE TABLE IF NOT EXISTS mg_mail (id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, text TEXT NOT NULL, taint REAL NOT NULL DEFAULT 0, at INTEGER NOT NULL, seen INTEGER NOT NULL DEFAULT 0, heart INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS mg_mail_to ON mg_mail(to_id, id)",
  "CREATE INDEX IF NOT EXISTS mg_mail_from ON mg_mail(from_id, at)",
  "CREATE TABLE IF NOT EXISTS mg_rib (user_id INTEGER PRIMARY KEY, partner INTEGER NOT NULL, color TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS mg_rib_off (from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, color TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (from_id, to_id))",
];

function install(d) {
  const { db, route, send, fail, limited, userById, userByCode, isFriend, applyItemEffect, themeState, CT, normCode, grantGold, grantExp, logAcquire, placeName, pvpMine, compFx, G } = d;
  const on = async () => (await themeState()) === 'magic';
  const off = res => fail(res, 404, 'event_off');
  const stRow = async uid => (await db.get('SELECT tf_until, tf_next, tf_total, cos FROM mg_state WHERE user_id = ?', [uid])) || { tf_until: 0, tf_next: 0, tf_total: 0, cos: '' };
  const ensure = uid => db.run('INSERT INTO mg_state (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING', [uid]);
  const dayRow = async (uid, now) => (await db.get('SELECT tf, song, star FROM mg_day WHERE user_id = ? AND day = ?', [uid, dayKey(now)])) || { tf: 0, song: 0, star: '' };
  const ensureDay = (uid, now) => db.run('INSERT INTO mg_day (user_id, day) VALUES (?, ?) ON CONFLICT(user_id, day) DO NOTHING', [uid, dayKey(now)]);
  const nameOf = async id => { const r = await db.get('SELECT hunter_name FROM users WHERE id = ?', [id]); return r ? r.hunter_name : '(헌터)'; };
  const cosParse = s => { try { const o = JSON.parse(s || ''); return o && cosOk(o) ? o : null; } catch (_) { return null; } };

  // ── 팀 ──
  async function teamOf(uid) {
    const m = await db.get('SELECT leader FROM mg_team_mem WHERE user_id = ?', [uid]);
    if (!m) return null;
    const t = await db.get('SELECT leader, name FROM mg_team WHERE leader = ?', [m.leader]);
    if (!t) { await db.run('DELETE FROM mg_team_mem WHERE user_id = ?', [uid]); return null; }
    const mem = await db.all('SELECT m.user_id, m.color, u.hunter_name FROM mg_team_mem m JOIN users u ON u.id = m.user_id WHERE m.leader = ? ORDER BY m.at, m.user_id', [t.leader]);
    return { leader: t.leader, name: t.name, mem };
  }
  async function jointToday(team, now) {
    if (!team || team.mem.length < TEAM_MAX) return false;
    const day = dayKey(now);
    for (const m of team.mem) { const r = await db.get('SELECT tf FROM mg_day WHERE user_id = ? AND day = ?', [m.user_id, day]); if (!r || !Number(r.tf)) return false; }
    return true;
  }

  // ── 보너스: _content.js 의 bonus() 에 더해집니다 (토벌·턴제 전투·조사 등) ──
  CT.setMgBonus(async (uid, now, b) => {
    if (!(await on())) return;
    const s = await stRow(uid), dr = await dayRow(uid, now);
    if (Number(s.tf_until) > now) {
      b.exp *= 1 + TF_FX.exp; b.gold *= 1 + TF_FX.gold; b.hpGuard += TF_FX.hpGuard;
      if (await jointToday(await teamOf(uid), now)) { b.exp *= 1 + JOINT_FX.exp; b.gold *= 1 + JOINT_FX.gold; b.luck += JOINT_FX.luck; }
    }
    const rb = await db.get('SELECT r.partner, u.region AS pr, me.region AS mr FROM mg_rib r JOIN users u ON u.id = r.partner JOIN users me ON me.id = r.user_id WHERE r.user_id = ?', [uid]);
    if (rb && rb.pr && rb.pr === rb.mr) { b.exp *= 1 + RIB_FX; b.gold *= 1 + RIB_FX; }      // 리본으로 묶인 친구와 같은 지역: 토벌 보상 +5%
    if (dr.star) {
      const C = STARS.find(x => x.k === dr.star);
      if (C) Object.keys(C.fx).forEach(k => { if (k === 'exp' || k === 'gold') b[k] *= 1 + C.fx[k]; else b[k] = (b[k] || 0) + C.fx[k]; });
    }
  });

  // ── 이벤트 회차: 관리자가 테마를 마법소녀로 켤 때마다 새 회차 (회차마다 첫 입장에 맹세 주문) ──
  async function epoch() {
    const r = await db.get("SELECT value FROM settings WHERE key = 'mg_epoch'");
    if (r && r.value) return r.value;
    const v = String(Date.now());
    await db.run("INSERT INTO settings (key, value) VALUES ('mg_epoch', ?) ON CONFLICT(key) DO NOTHING", [v]);
    return (await db.get("SELECT value FROM settings WHERE key = 'mg_epoch'")).value;
  }
  async function newEpoch() { await db.run("INSERT INTO settings (key, value) VALUES ('mg_epoch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(Date.now())]); }
  async function oathNeed(uid) {
    if (!(await on())) return false;
    const s = await db.get('SELECT oath FROM mg_state WHERE user_id = ?', [uid]);
    return !s || s.oath !== await epoch();
  }
  route('GET', '/api/mg/oath', async (req, res, ctx) => { send(res, 200, { need: await oathNeed(ctx.user.id), phrase: OATH }); });
  route('POST', '/api/mg/oath', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    if (await limited('mgoath:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
    if (oathNorm(ctx.body.text) !== OATH) return fail(res, 400, 'wrong');
    await ensure(ctx.user.id);
    await db.run('UPDATE mg_state SET oath = ? WHERE user_id = ?', [await epoch(), ctx.user.id]);
    send(res, 200, { ok: true });
  });

  // ── 주간 1위 주문 (지난주 1위가 있으면 그것, 없으면 이번 주 선두) ──
  async function topSpell(now) {
    for (const [wk, label] of [[prevWeek(now), '지난주 1위'], [weekKey(now), '이번 주 1위']]) {
      const r = await db.get('SELECT s.text, s.votes, u.hunter_name FROM mg_spell s JOIN users u ON u.id = s.user_id WHERE s.week = ? AND s.votes > 0 ORDER BY s.votes DESC, s.at ASC LIMIT 1', [wk]);
      if (r) return { text: r.text, by: r.hunter_name, votes: Number(r.votes), label };
    }
    return null;
  }
  async function mySpell(uid, now) {
    const r = await db.get('SELECT text, votes FROM mg_spell WHERE user_id = ? AND week = ?', [uid, weekKey(now)])
      || await db.get('SELECT text, 0 AS votes FROM mg_spell WHERE user_id = ? ORDER BY week DESC LIMIT 1', [uid]);
    return r ? { text: r.text, votes: Number(r.votes) || 0 } : null;
  }

  // ── 화면 상태에 붙는 정보 (/api/state 의 mg) ──
  async function stateOf(uid, now) {
    if (!(await on())) return null;
    const s = await stRow(uid), dr = await dayRow(uid, now), C = dr.star ? STARS.find(x => x.k === dr.star) : null;
    return Object.assign({ until: Number(s.tf_until) > now ? Number(s.tf_until) : 0, next: Number(s.tf_next) > now ? Number(s.tf_next) : 0, star: C ? { ko: C.ko, txt: C.txt } : null }, await stateExtra(uid, now));
  }
  // ── 간단 프로필·PVP 화면에 그릴 코스튬 ──
  async function cosOf(uid) {
    if (!(await on())) return null;
    const s = await db.get('SELECT cos FROM mg_state WHERE user_id = ?', [uid]);
    return s ? cosParse(s.cos) : null;
  }
  async function profileExtra(uid) {
    if (!(await on())) return null;
    const t = await teamOf(uid), me = t ? t.mem.find(m => m.user_id === uid) : null;
    const s = await db.get('SELECT diary_pub FROM mg_state WHERE user_id = ?', [uid]), f = await db.get('SELECT kind FROM mg_fairy WHERE user_id = ?', [uid]);
    const rb = await ribOf(uid);
    return { cos: await cosOf(uid), team: t ? { name: t.name, color: me ? me.color : 'pink' } : null, diary: !!(s && Number(s.diary_pub)), fairy: f ? f.kind : '', ribbon: rb ? { color: rb.color, with: rb.hunter_name } : null };
  }

  // ═════════ 앱 첫 화면: 모든 탭의 정보를 한 번에 ═════════
  route('GET', '/api/mg', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), s = await stRow(uid), dr = await dayRow(uid, now), team = await teamOf(uid);
    const st = starToday(now);
    send(res, 200, {
      now, buffMin: TF_BUFF / MIN, cdMin: TF_CD / MIN, fx: TF_FX, joint: JOINT_FX,
      tf: { until: Number(s.tf_until) > now ? Number(s.tf_until) : 0, next: Number(s.tf_next) > now ? Number(s.tf_next) : 0, total: Number(s.tf_total) || 0, today: Number(dr.tf) || 0 },
      spell: await mySpell(uid, now), top: await topSpell(now), defSpell: DEF_SPELL,
      cos: cosParse(s.cos), parts: COS, shop: await shopView(uid),
      teamOn: !!team, jointOn: await jointToday(team, now),
      song: { left: Math.max(0, SONG_DAY - (Number(dr.song) || 0)), max: SONG_DAY, purge: SONG_MAX, taint: await taintNow(uid) },
      star: { ko: st.C.ko, txt: st.C.txt, done: dr.star === st.C.k, stars: st.stars, hint: st.edges.map(e => [st.stars[e[0]], st.stars[e[1]]].map(p => [p.x, p.y])) },
    });
  });
  async function taintNow(uid) { const u = await db.get('SELECT stats FROM users WHERE id = ?', [uid]); try { return Math.round((Number(JSON.parse(u.stats).taint) || 0) * 10) / 10; } catch (_) { return 0; } }

  // ═════════ 변신 ═════════
  route('POST', '/api/mg/transform', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    if (await limited('mgtf:' + ctx.user.id, 20, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now();
    await ensure(uid);
    const fy = await fairyRow(uid), extra = fy ? moodBonus(Number(fy.mood)) : 0, buff = TF_BUFF + extra * MIN;      // 요정 기분이 좋으면 변신 시간 +5·10분
    const w = await db.run('UPDATE mg_state SET tf_until = ?, tf_next = ?, tf_total = tf_total + 1 WHERE user_id = ? AND tf_next <= ?', [now + buff, now + TF_CD, uid, now]);
    if (w.changes !== 1) { const s = await stRow(uid); return send(res, 409, { error: 'cooldown', next: Number(s.tf_next), now }); }
    await ensureDay(uid, now);
    await db.run('UPDATE mg_day SET tf = tf + 1 WHERE user_id = ? AND day = ?', [uid, dayKey(now)]);
    try { await CT.bump(uid, 'mg_tf', 1); } catch (_) {}
    await act(uid, 'tf');
    const team = await teamOf(uid), joint = await jointToday(team, now);
    const sp = await mySpell(uid, now);
    send(res, 200, { ok: true, now, until: now + buff, next: now + TF_CD, chant: sp ? sp.text : DEF_SPELL, top: await topSpell(now), joint, team: team ? team.name : '', fairy: fy ? { ko: FAIRIES[fy.kind].ko, extra } : null });
  });

  // ═════════ 1 변신 주문 ═════════
  route('GET', '/api/mg/spells', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), wk = weekKey(now);
    const rows = await db.all('SELECT s.user_id, s.text, s.votes, u.hunter_name FROM mg_spell s JOIN users u ON u.id = s.user_id WHERE s.week = ? ORDER BY s.votes DESC, s.at ASC LIMIT 40', [wk]);
    const mine = new Set((await db.all('SELECT owner FROM mg_vote WHERE voter = ? AND week = ?', [uid, wk])).map(r => r.owner));
    send(res, 200, { week: wk, left: Math.max(0, VOTE_WEEK - mine.size), max: SPELL_MAX, top: await topSpell(now), mine: await mySpell(uid, now),
      list: rows.map((r, i) => ({ no: i + 1, id: r.user_id, text: r.text, by: r.hunter_name, votes: Number(r.votes), me: r.user_id === uid, voted: mine.has(r.user_id) })) });
  });
  route('POST', '/api/mg/spell', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    if (await limited('mgsp:' + ctx.user.id, 10, HOUR)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), wk = weekKey(now), text = String(ctx.body.text == null ? '' : ctx.body.text).replace(/\s+/g, ' ').trim();
    if (!text || cp(text) > SPELL_MAX) return fail(res, 400, 'bad_text');
    const old = await db.get('SELECT text FROM mg_spell WHERE user_id = ? AND week = ?', [uid, wk]);
    if (old && old.text === text) return send(res, 200, { ok: true, same: true });
    // 문장을 바꾸면 이번 주에 받은 '반짝'은 처음부터 다시 받습니다
    await db.run('INSERT INTO mg_spell (user_id, week, text, votes, at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(user_id, week) DO UPDATE SET text = excluded.text, votes = 0, at = excluded.at', [uid, wk, text, now]);
    await db.run('DELETE FROM mg_vote WHERE owner = ? AND week = ?', [uid, wk]);
    send(res, 200, { ok: true, reset: !!old });
  });
  route('POST', '/api/mg/spell/vote', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), wk = weekKey(now), owner = Number(ctx.body.id) || 0;
    if (owner === uid) return fail(res, 400, 'self');
    if (!(await db.get('SELECT 1 AS x FROM mg_spell WHERE user_id = ? AND week = ?', [owner, wk]))) return fail(res, 404, 'not_found');
    const n = await db.get('SELECT COUNT(*) AS c FROM mg_vote WHERE voter = ? AND week = ?', [uid, wk]);
    if (Number(n.c) >= VOTE_WEEK) return fail(res, 409, 'no_votes');
    const w = await db.run('INSERT INTO mg_vote (voter, owner, week) VALUES (?, ?, ?) ON CONFLICT(voter, owner, week) DO NOTHING', [uid, owner, wk]);
    if (w.changes !== 1) return fail(res, 409, 'voted');
    await db.run('UPDATE mg_spell SET votes = votes + 1 WHERE user_id = ? AND week = ?', [owner, wk]);
    send(res, 200, { ok: true, left: VOTE_WEEK - Number(n.c) - 1 });
  });

  // ═════════ 2 코스튬 ═════════
  route('POST', '/api/mg/costume', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const o = {}; COS_KEYS.forEach(k => { o[k] = String((ctx.body || {})[k] || ''); });
    if (!cosOk(o)) return fail(res, 400, 'bad_part');
    for (const k of COS_KEYS) { if (COS_SHOP.some(p => p[0] === k && p[1] === o[k]) && !(await db.get('SELECT 1 AS x FROM mg_cos_own WHERE user_id = ? AND k = ? AND v = ?', [ctx.user.id, k, o[k]]))) return fail(res, 403, 'not_owned'); }      // 거울 상점 부품은 산 것만
    await ensure(ctx.user.id);
    await db.run('UPDATE mg_state SET cos = ? WHERE user_id = ?', [JSON.stringify(o), ctx.user.id]);
    send(res, 200, { ok: true, cos: o });
  });

  // ═════════ 3 팀 ═════════
  async function teamView(uid, now) {
    const t = await teamOf(uid), day = dayKey(now);
    const inv = await db.all('SELECT i.leader, t.name, u.hunter_name FROM mg_team_inv i JOIN mg_team t ON t.leader = i.leader JOIN users u ON u.id = i.leader WHERE i.to_id = ? ORDER BY i.at DESC', [uid]);
    let team = null;
    if (t) {
      const mem = [];
      for (const m of t.mem) { const r = await db.get('SELECT tf FROM mg_day WHERE user_id = ? AND day = ?', [m.user_id, day]); mem.push({ name: m.hunter_name, color: m.color, today: !!(r && Number(r.tf)), me: m.user_id === uid, leader: m.user_id === t.leader }); }
      const pend = await db.all('SELECT u.hunter_name FROM mg_team_inv i JOIN users u ON u.id = i.to_id WHERE i.leader = ?', [t.leader]);
      team = { name: t.name, mem, leader: t.leader === uid, pend: pend.map(p => p.hunter_name), joint: await jointToday(t, now), full: t.mem.length >= TEAM_MAX };
    }
    return { team, invites: inv.map(i => ({ leader: i.leader, name: i.name, from: i.hunter_name })), colors: TEAM_COLORS, colorKo: TEAM_KO, max: TEAM_MAX, nameMax: TEAM_NAME_MAX };
  }
  route('GET', '/api/mg/team', async (req, res, ctx) => { if (!(await on())) return off(res); send(res, 200, await teamView(ctx.user.id, Date.now())); });
  route('POST', '/api/mg/team/create', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), name = String(ctx.body.name || '').replace(/\s+/g, ' ').trim(), color = String(ctx.body.color || 'pink');
    if (!name || cp(name) > TEAM_NAME_MAX) return fail(res, 400, 'bad_name');
    if (!TEAM_COLORS.includes(color)) return fail(res, 400, 'bad_color');
    if (await teamOf(uid)) return fail(res, 409, 'in_team');
    await db.run('INSERT INTO mg_team (leader, name, at) VALUES (?, ?, ?) ON CONFLICT(leader) DO UPDATE SET name = excluded.name, at = excluded.at', [uid, name, now]);
    await db.run('INSERT INTO mg_team_mem (user_id, leader, color, at) VALUES (?, ?, ?, ?)', [uid, uid, color, now]);
    await db.run('DELETE FROM mg_team_inv WHERE to_id = ?', [uid]);
    send(res, 200, Object.assign({ ok: true }, await teamView(uid, now)));
  });
  route('POST', '/api/mg/team/invite', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    if (await limited('mgti:' + ctx.user.id, 20, HOUR)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), t = await teamOf(uid);
    if (!t) return fail(res, 409, 'no_team');
    const raw = String(ctx.body.target || '').trim();
    let f = raw ? await userByCode(normCode(raw)) : null;
    if (!f && raw) { const rs = await db.all('SELECT u.id FROM friends fr JOIN users u ON u.id = fr.friend_id WHERE fr.user_id = ? AND u.hunter_name = ?', [uid, raw]); if (rs.length === 1) f = await userById(rs[0].id); }
    if (!f) return fail(res, 404, 'no_user');
    if (f.id === uid) return fail(res, 400, 'self');
    if (!(await isFriend(uid, f.id))) return fail(res, 403, 'not_friend');
    if (await teamOf(f.id)) return fail(res, 409, 'target_in_team');
    const pend = await db.get('SELECT COUNT(*) AS c FROM mg_team_inv WHERE leader = ?', [t.leader]);
    if (t.mem.length + Number(pend.c) >= TEAM_MAX) return fail(res, 409, 'full');
    await db.run('INSERT INTO mg_team_inv (to_id, leader, at) VALUES (?, ?, ?) ON CONFLICT(to_id, leader) DO UPDATE SET at = excluded.at', [f.id, t.leader, now]);
    send(res, 200, Object.assign({ ok: true, to: f.hunter_name }, await teamView(uid, now)));
  });
  route('POST', '/api/mg/team/answer', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), leader = Number(ctx.body.leader) || 0, yes = !!ctx.body.yes;
    const inv = await db.get('SELECT 1 AS x FROM mg_team_inv WHERE to_id = ? AND leader = ?', [uid, leader]);
    if (!inv) return fail(res, 404, 'gone');
    await db.run('DELETE FROM mg_team_inv WHERE to_id = ? AND leader = ?', [uid, leader]);
    if (yes) {
      if (await teamOf(uid)) return fail(res, 409, 'in_team');
      const t = await db.get('SELECT leader FROM mg_team WHERE leader = ?', [leader]);
      if (!t) return fail(res, 404, 'gone');
      const mem = await db.all('SELECT color FROM mg_team_mem WHERE leader = ?', [leader]);
      if (mem.length >= TEAM_MAX) return fail(res, 409, 'full');
      const color = TEAM_COLORS.find(c => !mem.some(m => m.color === c)) || 'pink';
      await db.run('INSERT INTO mg_team_mem (user_id, leader, color, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING', [uid, leader, color, now]);
      await db.run('DELETE FROM mg_team_inv WHERE to_id = ?', [uid]);
    }
    send(res, 200, Object.assign({ ok: true }, await teamView(uid, now)));
  });
  route('POST', '/api/mg/team/color', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, color = String(ctx.body.color || ''), t = await teamOf(uid);
    if (!t) return fail(res, 409, 'no_team');
    if (!TEAM_COLORS.includes(color)) return fail(res, 400, 'bad_color');
    if (t.mem.some(m => m.user_id !== uid && m.color === color)) return fail(res, 409, 'color_taken');
    await db.run('UPDATE mg_team_mem SET color = ? WHERE user_id = ?', [color, uid]);
    send(res, 200, Object.assign({ ok: true }, await teamView(uid, Date.now())));
  });
  route('POST', '/api/mg/team/leave', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, t = await teamOf(uid);
    if (!t) return fail(res, 409, 'no_team');
    if (t.leader === uid) {      // 팀장이 나가면 팀이 해산됩니다
      await db.run('DELETE FROM mg_team_mem WHERE leader = ?', [uid]);
      await db.run('DELETE FROM mg_team_inv WHERE leader = ?', [uid]);
      await db.run('DELETE FROM mg_team WHERE leader = ?', [uid]);
    } else await db.run('DELETE FROM mg_team_mem WHERE user_id = ?', [uid]);
    send(res, 200, Object.assign({ ok: true, disband: t.leader === uid }, await teamView(uid, Date.now())));
  });

  // ═════════ 4 정화의 노래 ═════════
  route('POST', '/api/mg/song/start', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now();
    if (await taintNow(uid) <= 0) return fail(res, 409, 'clean');
    await ensureDay(uid, now);
    const w = await db.run('UPDATE mg_day SET song = song + 1 WHERE user_id = ? AND day = ? AND song < ?', [uid, dayKey(now), SONG_DAY]);      // 시작할 때 1회 차감 (다시 하기로 점수를 고르지 못하게)
    if (w.changes !== 1) return fail(res, 429, 'no_plays');
    const seed = (hash(uid + ':' + now) ^ Math.floor(Math.random() * 1e9)) >>> 0;
    await db.run('INSERT INTO mg_song (user_id, seed, at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET seed = excluded.seed, at = excluded.at', [uid, seed, now]);
    const ch = songChart(seed), dr = await dayRow(uid, now);
    send(res, 200, { ok: true, notes: ch.notes, len: ch.len, left: Math.max(0, SONG_DAY - Number(dr.song)) });
  });
  route('POST', '/api/mg/song/end', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), row = await db.get('SELECT seed, at FROM mg_song WHERE user_id = ?', [uid]);
    if (!row) return fail(res, 409, 'no_song');
    const ch = songChart(Number(row.seed));
    if (now - Number(row.at) < ch.len - 1500) return fail(res, 409, 'too_fast');
    await db.run('DELETE FROM mg_song WHERE user_id = ? AND at = ?', [uid, row.at]);
    if (now - Number(row.at) > ch.len + 5 * MIN) return fail(res, 409, 'expired');
    const j = String(ctx.body.judge || '').slice(0, SONG_N).padEnd(SONG_N, 'm');
    let p = 0, g = 0; for (const c of j) { if (c === 'p') p++; else if (c === 'g') g++; }
    const acc = Math.round((p + g * 0.6) / SONG_N * 100) / 100, amt = Math.round(SONG_MAX * acc);
    const before = await taintNow(uid);
    if (amt > 0) await applyItemEffect(uid, 'taint', -amt, now);
    await act(uid, 'song');
    const after = await taintNow(uid);
    send(res, 200, { ok: true, acc, perfect: p, good: g, miss: SONG_N - p - g, purge: Math.round((before - after) * 10) / 10, taint: after });
  });

  // ═════════ 5 별자리 잇기 ═════════
  route('POST', '/api/mg/star', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    if (await limited('mgst:' + ctx.user.id, 30, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), st = starToday(now), dr = await dayRow(uid, now);
    if (dr.star === st.C.k) return fail(res, 409, 'done');
    const got = Array.isArray(ctx.body.edges) ? ctx.body.edges.slice(0, 40).filter(e => Array.isArray(e) && e.length === 2).map(e => edgeKey([Number(e[0]) | 0, Number(e[1]) | 0])) : [];
    const need = new Set(st.edges.map(edgeKey)), have = new Set(got);
    const ok = have.size === need.size && [...need].every(k => have.has(k));
    if (!ok) return send(res, 200, { ok: false, right: [...have].filter(k => need.has(k)).length, need: need.size });
    await ensureDay(uid, now);
    await db.run('UPDATE mg_day SET star = ? WHERE user_id = ? AND day = ?', [st.C.k, uid, dayKey(now)]);
    await act(uid, 'star');
    send(res, 200, { ok: true, ko: st.C.ko, txt: st.C.txt });
  });

  // ═════════════════════ 2차 묶음 ═════════════════════
  const dayStart = day => Date.parse(day + 'T00:00:00Z') - 9 * HOUR;      // 한국 시간 그날 0시
  const addDay = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 24 * HOUR).toISOString().slice(0, 10);
  const bumpDay = async (uid, now, col, n) => { await ensureDay(uid, now); await db.run('UPDATE mg_day SET ' + col + ' = ' + col + ' + ? WHERE user_id = ? AND day = ?', [n, uid, dayKey(now)]); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pickOne = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

  // ═════════ 6 요정의 편지 ═════════
  const fairyRow = async uid => db.get('SELECT kind, mood, bond, at FROM mg_fairy WHERE user_id = ?', [uid]);
  const fairyView = f => f ? { kind: f.kind, ko: FAIRIES[f.kind].ko, kindKo: FAIRIES[f.kind].kind, mood: Number(f.mood), moodKo: moodKo(Number(f.mood)), bond: Number(f.bond), bonusMin: moodBonus(Number(f.mood)) } : null;
  const fill = (t, o) => t.replace(/\{(\w+)\}/g, (_, k) => (o[k] != null ? o[k] : ''));
  async function hintText(uid, kind, now, r) {
    const H = HINT[kind], taint = await taintNow(uid);
    if (taint >= 40) return H.taint;
    const mon = await db.get('SELECT region, COUNT(*) AS c FROM monsters WHERE owner_id = ? AND spawned_at > ? GROUP BY region ORDER BY c DESC LIMIT 1', [uid, now - 2 * HOUR]).catch(() => null);
    if (mon && Number(mon.c) >= 2 && r < 0.6) return fill(H.mon, { r: placeName(mon.region) });
    const st = starToday(now);
    return r < 0.85 ? fill(H.star, { ko: st.C.ko, txt: st.C.txt }) : H.calm;
  }
  // 편지 배달 (상태를 확인할 때마다 조용히): 오전 10~13시 1통(힌트), 저녁 18~22시 1통(대화, 친밀도가 높을수록 자주)
  const fairyChecked = new Map();
  async function fairyTick(uid, now) {
    const last = fairyChecked.get(uid) || 0;
    if (now - last < 50000) return;
    fairyChecked.set(uid, now);
    const f = await fairyRow(uid);
    if (!f) return;
    const day = dayKey(now), t0 = dayStart(day), bond = Number(f.bond);
    // 어제까지 답장하지 않은 편지: 기분 -4 (한 번만)
    const miss = await db.all('SELECT id FROM mg_letter WHERE user_id = ? AND day < ? AND pick = -1', [uid, day]);
    for (const m of miss) { const w = await db.run('UPDATE mg_letter SET pick = -2 WHERE id = ? AND pick = -1', [m.id]); if (w.changes === 1) await db.run('UPDATE mg_fairy SET mood = MAX(0, mood - 4) WHERE user_id = ?', [uid]); }
    const slots = [[0, t0 + 10 * HOUR + (hash(uid + ':' + day + ':0') % 180) * MIN, true],
      [1, t0 + 18 * HOUR + (hash(uid + ':' + day + ':1') % 240) * MIN, (hash(uid + ':' + day + ':1y') % 100) < (bond >= 25 ? 85 : 55)]];
    for (const [slot, at, yes] of slots) {
      if (!yes || now < at || at < Number(f.at)) continue;      // 계약하기 전 시각의 편지는 보내지 않음
      if (await db.get('SELECT 1 AS x FROM mg_letter WHERE user_id = ? AND day = ? AND slot = ?', [uid, day, slot])) continue;
      const r = rng(hash(uid + ':' + day + ':' + slot + ':t'));
      let text, opts;
      if (slot === 0) { text = await hintText(uid, f.kind, now, r()); opts = HINT_OPTS; }
      else { const c = pickOne(CHAT[f.kind][bondTier(bond)], r()); text = c[0]; opts = c[1]; }
      await db.run('INSERT INTO mg_letter (user_id, day, slot, text, opts, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, day, slot) DO NOTHING', [uid, day, slot, text, JSON.stringify(opts), at]);
    }
  }
  const letterView = l => { let o = []; try { o = JSON.parse(l.opts); } catch (_) {} return { id: l.id, day: l.day, text: l.text, opts: o.map(x => x[0]), pick: Number(l.pick), react: l.react || '', at: Number(l.at) }; };
  route('GET', '/api/mg/fairy', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now();
    fairyChecked.delete(uid); await fairyTick(uid, now);
    const f = await fairyRow(uid);
    const rows = f ? await db.all('SELECT id, day, text, opts, pick, react, at FROM (SELECT id, day, text, opts, pick, react, at FROM mg_letter WHERE user_id = ? ORDER BY at DESC, id DESC LIMIT 40) ORDER BY at, id', [uid]) : [];
    if (f && url(req).searchParams.get('read')) await db.run('UPDATE mg_letter SET seen = 1 WHERE user_id = ? AND seen = 0', [uid]);
    send(res, 200, { fairy: fairyView(f), letters: rows.map(letterView), kinds: Object.keys(FAIRIES).map(k => Object.assign({ k }, FAIRIES[k])), moodSteps: [[60, 5], [80, 10]] });
  });
  route('POST', '/api/mg/fairy/contract', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), kind = String(ctx.body.kind || '');
    if (!FAIRIES[kind]) return fail(res, 400, 'bad_kind');
    const w = await db.run('INSERT INTO mg_fairy (user_id, kind, mood, bond, at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(user_id) DO NOTHING', [uid, kind, MOOD0, now]);
    if (w.changes !== 1) return fail(res, 409, 'has_fairy');
    await db.run('INSERT INTO mg_letter (user_id, day, slot, text, opts, at) VALUES (?, ?, 9, ?, ?, ?) ON CONFLICT(user_id, day, slot) DO NOTHING', [uid, dayKey(now), HINT[kind].hello, JSON.stringify(HELLO_OPTS), now]);
    send(res, 200, { ok: true, fairy: fairyView(await fairyRow(uid)) });
  });
  route('POST', '/api/mg/fairy/reply', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, id = Number(ctx.body.id) || 0, pick = Number(ctx.body.pick);
    if (![0, 1, 2].includes(pick)) return fail(res, 400, 'bad_pick');
    const f = await fairyRow(uid), l = await db.get('SELECT id, opts, pick FROM mg_letter WHERE id = ? AND user_id = ?', [id, uid]);
    if (!f || !l) return fail(res, 404, 'not_found');
    if (Number(l.pick) !== -1) return fail(res, 409, Number(l.pick) === -2 ? 'too_late' : 'replied');
    let o = []; try { o = JSON.parse(l.opts); } catch (_) {}
    const op = o[pick]; if (!op) return fail(res, 400, 'bad_pick');
    const react = REACT[f.kind][op[1] >= 5 ? 0 : op[1] >= 0 ? 1 : 2];
    const w = await db.run('UPDATE mg_letter SET pick = ?, react = ?, seen = 1 WHERE id = ? AND pick = -1', [pick, react, id]);
    if (w.changes !== 1) return fail(res, 409, 'replied');
    await act(uid, 'letter');
    await db.run('UPDATE mg_fairy SET mood = ?, bond = ? WHERE user_id = ?', [clamp(Number(f.mood) + op[1], 0, 100), clamp(Number(f.bond) + op[2], 0, FBOND_MAX), uid]);
    send(res, 200, { ok: true, react, delta: op[1], fairy: fairyView(await fairyRow(uid)) });
  });
  const url = req => new URL(req.url, 'http://x');

  // ═════════ 7 마법 일기장 ═════════
  async function dayPage(uid, day) {
    const a = dayStart(day), b = a + 24 * HOUR;
    const kills = await db.all("SELECT mon, COUNT(*) AS c FROM hunt_log WHERE user_id = ? AND result = 'success' AND at >= ? AND at < ? GROUP BY mon ORDER BY c DESC", [uid, a, b]);
    const d = (await db.get('SELECT tf, song, star, wish, duel, pet FROM mg_day WHERE user_id = ? AND day = ?', [uid, day])) || {};
    const fr = await db.all('SELECT DISTINCT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS f FROM messages WHERE (from_id = ? OR to_id = ?) AND ts >= ? AND ts < ?', [uid, uid, uid, a, b]);
    const names = [];
    for (const r of fr.slice(0, 3)) names.push(await nameOf(r.f));
    const lt = await db.get('SELECT COUNT(*) AS c FROM mg_letter WHERE user_id = ? AND day = ? AND pick >= 0', [uid, day]);
    const st = d.star ? STARS.find(x => x.k === d.star) : null, pet = d.pet ? PETS.find(p => p.k === d.pet) : null;
    const p = { day, kill: kills.reduce((s, k) => s + Number(k.c), 0), mons: kills.slice(0, 3).map(k => k.mon), tf: Number(d.tf) || 0, song: Number(d.song) || 0, star: st ? st.ko : '',
      wish: Number(d.wish) || 0, duel: Number(d.duel) || 0, pet: pet ? pet.ko : '', friends: fr.length, fnames: names, letters: Number(lt.c) || 0 };
    p.filled = !!(p.kill || p.tf || p.song || p.star || p.wish || p.duel || p.pet || p.friends || p.letters);
    return p;
  }
  async function diaryOf(uid, now) {
    const today = dayKey(now), ep = Number(await epoch()) || now;
    let start = dayKey(Math.max(ep, now - (DIARY_DAYS - 1) * 24 * HOUR));
    const saved = new Map((await db.all('SELECT day, data FROM mg_diary WHERE user_id = ? AND day >= ?', [uid, start])).map(r => [r.day, r.data]));
    const pages = [];
    for (let day = start, i = 0; day <= today && i < DIARY_DAYS + 1; day = addDay(day, 1), i++) {
      let p = null;
      if (day < today && saved.has(day)) { try { p = JSON.parse(saved.get(day)); } catch (_) {} }
      if (!p) { p = await dayPage(uid, day); if (day < today) await db.run('INSERT INTO mg_diary (user_id, day, data) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET data = excluded.data', [uid, day, JSON.stringify(p)]); }      // 지난 날은 한 번 정리하면 그대로 보관
      p.today = day === today; pages.push(p);
    }
    const filled = pages.filter(p => p.filled).length;
    return { pages: pages.filter(p => p.filled || p.today).reverse(), filled, stamps: Math.floor(filled / STAMP_DAYS), next: STAMP_DAYS - (filled % STAMP_DAYS), per: STAMP_DAYS };
  }
  route('GET', '/api/mg/diary', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), code = url(req).searchParams.get('code');
    if (code) {      // 친구의 일기장 (친구가 공개했을 때만)
      const f = await userByCode(normCode(code));
      if (!f || !(await isFriend(uid, f.id))) return fail(res, 404, 'not_found');
      const s = await db.get('SELECT diary_pub FROM mg_state WHERE user_id = ?', [f.id]);
      if (!s || !Number(s.diary_pub)) return fail(res, 403, 'private');
      return send(res, 200, Object.assign({ owner: f.hunter_name, mine: false }, await diaryOf(f.id, now)));
    }
    const s = await db.get('SELECT diary_pub FROM mg_state WHERE user_id = ?', [uid]);
    send(res, 200, Object.assign({ owner: await nameOf(uid), mine: true, pub: !!(s && Number(s.diary_pub)) }, await diaryOf(uid, now)));
  });
  route('POST', '/api/mg/diary/pub', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    await ensure(ctx.user.id);
    await db.run('UPDATE mg_state SET diary_pub = ? WHERE user_id = ?', [ctx.body.on ? 1 : 0, ctx.user.id]);
    send(res, 200, { ok: true, pub: !!ctx.body.on });
  });

  // ═════════ 8 소원 별똥별 ═════════
  // 그날의 별똥별 시각 (같은 날·같은 회차면 모두에게 같음) + 관리자가 바로 띄운 별똥별
  function shootsOf(day, ep) {
    const t0 = dayStart(day) + 9 * HOUR, span = (14.5 * HOUR) / SHOOT_N, out = [];
    for (let i = 0; i < SHOOT_N; i++) out.push({ id: day + '-' + i, start: Math.round(t0 + i * span + 10 * MIN + (hash(ep + ':' + day + ':s' + i) % Math.floor((span - 20 * MIN) / 1000)) * 1000) });
    return out;
  }
  async function shootStart(sid) {
    if (/^f\d+$/.test(sid)) return Number(sid.slice(1));
    const m = /^(\d{4}-\d{2}-\d{2})-(\d)$/.exec(sid); if (!m) return 0;
    const s = shootsOf(m[1], await epoch()).find(x => x.id === sid);
    return s ? s.start : 0;
  }
  async function shootLive(now) {
    const ep = await epoch(), list = shootsOf(dayKey(now), ep);
    const fo = await db.get("SELECT value FROM settings WHERE key = 'mg_shoot_force'");
    if (fo && Number(fo.value)) list.push({ id: 'f' + Number(fo.value), start: Number(fo.value) });
    return list.find(s => now >= s.start - SHOOT_EARLY && now < s.start + SHOOT_DUR) || null;
  }
  async function wishSettle(uid, now) {      // 끝난 별똥별 보상 (누른 사람 수가 정해진 뒤 지급)
    const rows = await db.all('SELECT sid FROM mg_wish WHERE user_id = ? AND paid = 0', [uid]);
    const out = [];
    for (const r of rows) {
      const st = await shootStart(r.sid);
      if (st && now < st + SHOOT_DUR + SHOOT_GRACE + 1000) continue;
      const w = await db.run('UPDATE mg_wish SET paid = 1 WHERE sid = ? AND user_id = ? AND paid = 0', [r.sid, uid]);
      if (w.changes !== 1) continue;
      const n = Number((await db.get('SELECT COUNT(*) AS c FROM mg_wish WHERE sid = ?', [r.sid])).c) || 1, rw = shootReward(n);
      await grantGold(uid, rw.gold); await grantExp(uid, rw.exp);
      await logAcquire(uid, 'gold', '골드', rw.gold, '소원 별똥별', now); await logAcquire(uid, 'exp', '경험치', rw.exp, '소원 별똥별', now);
      out.push({ n, gold: rw.gold, exp: rw.exp });
    }
    return out;
  }
  route('POST', '/api/mg/wish', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), sid = String(ctx.body.id || '');
    const st = await shootStart(sid);
    if (!st || now < st - 1000 || now > st + SHOOT_DUR + SHOOT_GRACE) return fail(res, 410, 'gone');
    const w = await db.run('INSERT INTO mg_wish (sid, user_id, at) VALUES (?, ?, ?) ON CONFLICT(sid, user_id) DO NOTHING', [sid, uid, now]);
    if (w.changes === 1) await bumpDay(uid, now, 'wish', 1);
    const n = Number((await db.get('SELECT COUNT(*) AS c FROM mg_wish WHERE sid = ?', [sid])).c) || 1;
    send(res, 200, { ok: true, again: w.changes !== 1, n, reward: shootReward(n), end: st + SHOOT_DUR });
  });
  route('POST', '/api/admin/mg/shoot', async (req, res) => {      // 관리자: 지금 바로 별똥별 띄우기 (5초 뒤 시작)
    const at = Date.now() + 5000;
    await db.run("INSERT INTO settings (key, value) VALUES ('mg_shoot_force', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(at)]);
    send(res, 200, { ok: true, start: at, on: await on() });
  }, { auth: false, admin: true });

  // ═════════ 9 마물을 친구로 ═════════
  async function onPurify(uid, m, now) {      // 토벌 성공(정화) 때 _app.js 의 huntWin 에서 부릅니다
    if (!(await on())) return null;
    await ensure(uid);
    await act(uid, 'hunt');      // 마법 학교: 토벌 성공
    const own = new Set((await db.all('SELECT kind FROM mg_pet WHERE user_id = ?', [uid])).map(r => r.kind));
    const left = PETS.filter(p => !own.has(p.k));
    if (!left.length) return null;
    const dr = await db.get('SELECT pet FROM mg_day WHERE user_id = ? AND day = ?', [uid, dayKey(now)]);
    const todayN = dr && dr.pet ? dr.pet.split(',').length : 0;
    if (todayN >= PET_DAY) return null;
    const s = await db.get('SELECT pet_pity FROM mg_state WHERE user_id = ?', [uid]), pity = Number(s && s.pet_pity) || 0;
    if (pity + 1 < PET_PITY && Math.random() >= PET_CHANCE) { await db.run('UPDATE mg_state SET pet_pity = pet_pity + 1 WHERE user_id = ?', [uid]); return null; }
    const p = left[Math.floor(Math.random() * left.length)];
    const w = await db.run('INSERT INTO mg_pet (user_id, kind, happy, at) VALUES (?, ?, 0, ?) ON CONFLICT(user_id, kind) DO NOTHING', [uid, p.k, now]);
    if (w.changes !== 1) return null;
    await db.run('UPDATE mg_state SET pet_pity = 0 WHERE user_id = ?', [uid]);
    await ensureDay(uid, now);
    await db.run('UPDATE mg_day SET pet = ? WHERE user_id = ? AND day = ?', [(dr && dr.pet ? dr.pet + ',' : '') + p.k, uid, dayKey(now)]);
    return { k: p.k, ko: p.ko, from: m.name };
  }
  const petView = (r, now) => { const P = PETS.find(p => p.k === r.kind), h = Number(r.happy), st = petStage(h);
    return { k: r.kind, ko: P.ko, happy: h, stage: st, line: P.s[st], done: !!Number(r.done), got: Number(r.at),
      petIn: Math.max(0, Number(r.pet_at) + PET_ACT.pet.cd - now), playIn: Math.max(0, Number(r.play_at) + PET_ACT.play.cd - now) }; };
  route('GET', '/api/mg/pets', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const now = Date.now(), rows = await db.all('SELECT kind, happy, pet_at, play_at, done, at FROM mg_pet WHERE user_id = ? ORDER BY at', [ctx.user.id]);
    send(res, 200, { now, pets: rows.filter(r => PETS.some(p => p.k === r.kind)).map(r => petView(r, now)), total: PETS.length, act: { pet: { add: PET_ACT.pet.add, cdMin: 60 }, play: { add: PET_ACT.play.add, cdMin: 180 } }, doneGold: PET_DONE_GOLD, chance: PET_CHANCE, pity: PET_PITY });
  });
  route('POST', '/api/mg/pet/act', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), k = String(ctx.body.k || ''), act = String(ctx.body.act || ''), A = PET_ACT[act];
    if (!A) return fail(res, 400, 'bad_act');
    const r = await db.get('SELECT kind, happy, pet_at, play_at, done, at FROM mg_pet WHERE user_id = ? AND kind = ?', [uid, k]);
    if (!r) return fail(res, 404, 'not_found');
    if (Number(r.done)) return fail(res, 409, 'done');
    const col = act === 'pet' ? 'pet_at' : 'play_at';
    const w = await db.run('UPDATE mg_pet SET happy = MIN(100, happy + ?), ' + col + ' = ? WHERE user_id = ? AND kind = ? AND ' + col + ' <= ? AND done = 0', [A.add, now, uid, k, now - A.cd]);
    if (w.changes !== 1) return fail(res, 429, 'cooldown');
    await act(uid, 'pet');
    let reward = 0;
    const r2 = await db.get('SELECT kind, happy, pet_at, play_at, done, at FROM mg_pet WHERE user_id = ? AND kind = ?', [uid, k]);
    if (Number(r2.happy) >= 100) {
      const d = await db.run('UPDATE mg_pet SET done = 1 WHERE user_id = ? AND kind = ? AND done = 0', [uid, k]);
      if (d.changes === 1) { reward = PET_DONE_GOLD; await grantGold(uid, reward); await logAcquire(uid, 'gold', '골드', reward, '마물 친구 · ' + PETS.find(p => p.k === k).ko, now); r2.done = 1; }
    }
    send(res, 200, { ok: true, pet: petView(r2, now), reward, before: petStage(Number(r.happy)) });
  });

  // ═════════ 10 마법소녀 연출 대결 ═════════
  async function duelResolve(d, bp, now) {
    let sa = 0, sb = 0;
    for (let i = 0; i < 3; i++) { const x = d.ap[i], y = bp[i]; if (DUEL_BEAT[x] === y) sa++; else if (DUEL_BEAT[y] === x) sb++; }
    const win = sa > sb ? d.a : sb > sa ? d.b : -1;
    let card = '';
    if (win > 0) {
      const lose = win === d.a ? d.b : d.a;
      const ls = await db.get('SELECT cos FROM mg_state WHERE user_id = ?', [lose]), c = (ls && cosParse(ls.cos)) || { r: 'bow', s: 'puff', c: 'sakura', w: 'star' };
      const k = COS_KEYS[Math.floor(Math.random() * 4)], ln = await nameOf(lose);
      card = JSON.stringify({ k, v: c[k], from: ln });
      await db.run('INSERT INTO mg_card (user_id, from_name, k, v, at) VALUES (?, ?, ?, ?, ?)', [win, ln, k, c[k], now]);
      await bumpDay(win, now, 'duel', 1);
    }
    return { win, card, sa, sb };
  }
  async function duelDayLeft(uid, now) { const r = await db.get('SELECT dn FROM mg_day WHERE user_id = ? AND day = ?', [uid, dayKey(now)]); return Math.max(0, DUEL_DAY - (Number(r && r.dn) || 0)); }
  const partKo = (k, v) => { const p = (COS[k] || []).find(x => x[0] === v); return p ? p[1] : v; };
  async function duelView(uid, now) {
    const open = await db.get("SELECT d.id, d.st, d.b, d.ap, d.at, u.hunter_name AS bn FROM mg_duel d LEFT JOIN users u ON u.id = d.b WHERE d.a = ? AND d.st IN ('wait', 'invite') ORDER BY d.id DESC LIMIT 1", [uid]);
    if (open && open.st === 'wait' && now - Number(open.at) > DUEL_WAIT) { await db.run("UPDATE mg_duel SET st = 'cancel' WHERE id = ? AND st = 'wait'", [open.id]); }
    const inv = await db.all("SELECT d.id, u.hunter_name AS an, d.at FROM mg_duel d JOIN users u ON u.id = d.a WHERE d.b = ? AND d.st = 'invite' ORDER BY d.id DESC LIMIT 10", [uid]);
    const rec = await db.all("SELECT d.id, d.a, d.b, d.ap, d.bp, d.win, d.card, d.seen_a, d.seen_b, d.done_at, d.st, ua.hunter_name AS an, ub.hunter_name AS bn FROM mg_duel d JOIN users ua ON ua.id = d.a LEFT JOIN users ub ON ub.id = d.b WHERE (d.a = ? OR d.b = ?) AND d.st IN ('done', 'decline') ORDER BY d.done_at DESC, d.id DESC LIMIT 12", [uid, uid]);
    const fresh = [];
    const recent = rec.map(r => { const meA = Number(r.a) === uid, seen = meA ? Number(r.seen_a) : Number(r.seen_b);
      let card = null; try { card = r.card ? JSON.parse(r.card) : null; } catch (_) {}
      if (!seen) fresh.push(r.id);
      return { id: r.id, st: r.st, vs: meA ? (r.bn || '(헌터)') : r.an, mine: meA ? r.ap : r.bp, theirs: meA ? r.bp : r.ap, res: r.st === 'decline' ? 'decline' : Number(r.win) === -1 ? 'draw' : Number(r.win) === uid ? 'win' : 'lose',
        card: card && Number(r.win) === uid ? { k: card.k, v: card.v, ko: partKo(card.k, card.v), from: card.from } : null, fresh: !seen, at: Number(r.done_at) }; });
    for (const id of fresh) { await db.run('UPDATE mg_duel SET seen_a = CASE WHEN a = ? THEN 1 ELSE seen_a END, seen_b = CASE WHEN b = ? THEN 1 ELSE seen_b END WHERE id = ?', [uid, uid, id]); }
    const cards = await db.all('SELECT id, from_name, k, v, at FROM mg_card WHERE user_id = ? ORDER BY id DESC LIMIT 30', [uid]);
    const o2 = open && !(open.st === 'wait' && now - Number(open.at) > DUEL_WAIT) ? open : null;
    return { open: o2 ? { id: o2.id, st: o2.st, to: o2.bn || '', picks: o2.ap, at: Number(o2.at) } : null, invites: inv.map(i => ({ id: i.id, from: i.an, at: Number(i.at) })), recent,
      cards: cards.map(c => ({ id: c.id, from: c.from_name, k: c.k, v: c.v, ko: partKo(c.k, c.v), at: Number(c.at) })), left: await duelDayLeft(uid, now), max: DUEL_DAY, cos: await cosOfRaw(uid), ko: DUEL_KO };
  }
  async function cosOfRaw(uid) { const s = await db.get('SELECT cos FROM mg_state WHERE user_id = ?', [uid]); return s ? cosParse(s.cos) : null; }
  route('GET', '/api/mg/duel', async (req, res, ctx) => { if (!(await on())) return off(res); send(res, 200, await duelView(ctx.user.id, Date.now())); });
  async function duelBusy(uid) { return db.get("SELECT id FROM mg_duel WHERE a = ? AND st IN ('wait', 'invite')", [uid]); }
  route('POST', '/api/mg/duel/queue', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    if (await limited('mgdq:' + ctx.user.id, 20, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), picks = String(ctx.body.picks || '');
    if (!picksOk(picks)) return fail(res, 400, 'bad_picks');
    if (await duelBusy(uid)) return fail(res, 409, 'busy');
    if ((await duelDayLeft(uid, now)) <= 0) return fail(res, 429, 'no_plays');
    const waits = await db.all("SELECT id, a, ap FROM mg_duel WHERE st = 'wait' AND b = 0 AND a <> ? AND at > ? ORDER BY id LIMIT 5", [uid, now - DUEL_WAIT]);
    for (const d of waits) {
      const w = await db.run("UPDATE mg_duel SET st = 'busy', b = ? WHERE id = ? AND st = 'wait'", [uid, d.id]);
      if (w.changes !== 1) continue;
      const rs = await duelResolve({ a: Number(d.a), b: uid, ap: d.ap }, picks, now);
      await db.run("UPDATE mg_duel SET st = 'done', bp = ?, win = ?, card = ?, seen_b = 1, done_at = ? WHERE id = ?", [picks, rs.win, rs.card, now, d.id]);
      await bumpDay(uid, now, 'dn', 1);
      const v = await duelView(uid, now);
      return send(res, 200, Object.assign({ ok: true, matched: true, duel: Object.assign({ id: d.id, vs: await nameOf(Number(d.a)), mine: picks, theirs: d.ap, res: rs.win === -1 ? 'draw' : rs.win === uid ? 'win' : 'lose' }, rs.card && rs.win === uid ? { card: (c => ({ k: c.k, v: c.v, ko: partKo(c.k, c.v), from: c.from }))(JSON.parse(rs.card)) } : {}) }, v));
    }
    await db.run("INSERT INTO mg_duel (a, b, ap, st, at) VALUES (?, 0, ?, 'wait', ?)", [uid, picks, now]);
    await bumpDay(uid, now, 'dn', 1);
    send(res, 200, Object.assign({ ok: true, matched: false }, await duelView(uid, now)));
  });
  route('POST', '/api/mg/duel/invite', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    if (await limited('mgdi:' + ctx.user.id, 20, HOUR)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), picks = String(ctx.body.picks || ''), raw = String(ctx.body.target || '').trim();
    if (!picksOk(picks)) return fail(res, 400, 'bad_picks');
    if (await duelBusy(uid)) return fail(res, 409, 'busy');
    if ((await duelDayLeft(uid, now)) <= 0) return fail(res, 429, 'no_plays');
    let f = raw ? await userByCode(normCode(raw)) : null;
    if (!f && raw) { const rs = await db.all('SELECT u.id FROM friends fr JOIN users u ON u.id = fr.friend_id WHERE fr.user_id = ? AND u.hunter_name = ?', [uid, raw]); if (rs.length === 1) f = await userById(rs[0].id); }
    if (!f) return fail(res, 404, 'no_user');
    if (f.id === uid) return fail(res, 400, 'self');
    if (!(await isFriend(uid, f.id))) return fail(res, 403, 'not_friend');
    await db.run("INSERT INTO mg_duel (a, b, ap, st, at) VALUES (?, ?, ?, 'invite', ?)", [uid, f.id, picks, now]);
    await bumpDay(uid, now, 'dn', 1);
    send(res, 200, Object.assign({ ok: true, to: f.hunter_name }, await duelView(uid, now)));
  });
  route('POST', '/api/mg/duel/answer', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), id = Number(ctx.body.id) || 0, picks = String(ctx.body.picks || '');
    const d = await db.get("SELECT id, a, b, ap FROM mg_duel WHERE id = ? AND b = ? AND st = 'invite'", [id, uid]);
    if (!d) return fail(res, 404, 'gone');
    if (ctx.body.decline) { await db.run("UPDATE mg_duel SET st = 'decline', done_at = ?, seen_b = 1 WHERE id = ? AND st = 'invite'", [now, id]); return send(res, 200, Object.assign({ ok: true }, await duelView(uid, now))); }
    if (!picksOk(picks)) return fail(res, 400, 'bad_picks');
    const w = await db.run("UPDATE mg_duel SET st = 'busy' WHERE id = ? AND st = 'invite'", [id]);
    if (w.changes !== 1) return fail(res, 404, 'gone');
    const rs = await duelResolve({ a: Number(d.a), b: uid, ap: d.ap }, picks, now);
    await db.run("UPDATE mg_duel SET st = 'done', bp = ?, win = ?, card = ?, seen_b = 1, done_at = ? WHERE id = ?", [picks, rs.win, rs.card, now, id]);
    const v = await duelView(uid, now);
    send(res, 200, Object.assign({ ok: true, matched: true, duel: Object.assign({ id, vs: await nameOf(Number(d.a)), mine: picks, theirs: d.ap, res: rs.win === -1 ? 'draw' : rs.win === uid ? 'win' : 'lose' }, rs.card && rs.win === uid ? { card: (c => ({ k: c.k, v: c.v, ko: partKo(c.k, c.v), from: c.from }))(JSON.parse(rs.card)) } : {}) }, v));
  });
  route('POST', '/api/mg/duel/cancel', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now();
    const w = await db.run("UPDATE mg_duel SET st = 'cancel' WHERE a = ? AND st IN ('wait', 'invite')", [uid]);
    if (w.changes > 0) { await ensureDay(uid, now); await db.run('UPDATE mg_day SET dn = MAX(0, dn - 1) WHERE user_id = ? AND day = ?', [uid, dayKey(now)]); }      // 취소하면 오늘 횟수를 돌려줌
    send(res, 200, Object.assign({ ok: true }, await duelView(uid, now)));
  });

  // ═════════════════════ 3차 묶음 ═════════════════════
  // ═════════ 11 마법 학교 수업 ═════════
  async function act(uid, k, n) {      // 활동 기록 (이번 주): _app.js(토벌·이동·조합·육성)와 이 파일에서 부릅니다
    if (!(await on())) return;
    await db.run('INSERT INTO mg_act (user_id, week, k, n) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, week, k) DO UPDATE SET n = mg_act.n + excluded.n', [uid, weekKey(Date.now()), k, n || 1]);
  }
  const weekIdx = async now => { const ep = Number(await epoch()) || now; return Math.max(0, Math.round((Date.parse(weekKey(now)) - Date.parse(weekKey(ep))) / (7 * 24 * HOUR))); };
  async function schoolView(uid, now) {
    const wi = await weekIdx(now), wk = weekKey(now), S = SUBJ[wi % SUBJ.length];
    const acts = new Map((await db.all('SELECT k, n FROM mg_act WHERE user_id = ? AND week = ?', [uid, wk])).map(r => [r.k, Number(r.n)]));
    const tasks = S.t.map(t => ({ k: t[0], ko: t[1], need: t[2], n: Math.min(t[2], acts.get(t[0]) || 0) }));
    let certs = new Map((await db.all('SELECT subj, week, at FROM mg_cert WHERE user_id = ?', [uid])).map(r => [r.subj, r]));
    let fresh = false, grad = false;
    if (tasks.every(t => t.n >= t.need) && !certs.has(S.k)) {
      const w = await db.run('INSERT INTO mg_cert (user_id, subj, week, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, subj) DO NOTHING', [uid, S.k, wk, now]);
      fresh = w.changes === 1;
      certs = new Map((await db.all('SELECT subj, week, at FROM mg_cert WHERE user_id = ?', [uid])).map(r => [r.subj, r]));
      if (fresh && certs.size >= SUBJ.length) { try { grad = await CT.grantTitle(uid, 'mg_grad'); } catch (_) {} }
    }
    const weekEnd = Date.parse(addDay(wk, 7) + 'T00:00:00Z') - 9 * HOUR;
    return { week: wi + 1, now, weekEnd, subj: { k: S.k, ko: S.ko, desc: S.desc, tasks, done: certs.has(S.k) }, fresh, grad,
      subjects: SUBJ.map((x, i) => { const c = certs.get(x.k); return { k: x.k, ko: x.ko, desc: x.desc, cert: c ? { week: c.week, at: Number(c.at) } : null, now: x.k === S.k, order: i + 1, tasks: x.t.map(t => t[1] + ' ' + t[2] + '번') }; }),
      certs: certs.size, total: SUBJ.length, graduated: certs.size >= SUBJ.length };
  }
  route('GET', '/api/mg/school', async (req, res, ctx) => { if (!(await on())) return off(res); send(res, 200, await schoolView(ctx.user.id, Date.now())); });

  // ═════════ 12 거울 나라의 나 ═════════
  async function shopView(uid) {
    const own = new Set((await db.all('SELECT k, v FROM mg_cos_own WHERE user_id = ?', [uid])).map(r => r.k + ':' + r.v));
    return COS_SHOP.map(p => ({ k: p[0], v: p[1], ko: p[2], cost: p[3], own: own.has(p[0] + ':' + p[1]) }));
  }
  const flip = a => a.map(v => G.PVP_MIN + G.PVP_MAX - v);
  async function mirrorView(uid, now) {
    const wk = weekKey(now), m = await pvpMine(uid, now), r = (await db.get('SELECT tries, win FROM mg_mirror WHERE user_id = ? AND week = ?', [uid, wk])) || { tries: 0, win: 0 };
    const s = await db.get('SELECT shards, mirror_wins FROM mg_state WHERE user_id = ?', [uid]);
    return { set: !!m.u.pvp_set, me: m.a, mirror: flip(m.a), keys: G.PVP_KEYS, ko: G.PVP_KO, tries: Number(r.tries), max: MIRROR_TRIES, won: !!Number(r.win), shards: Number(s && s.shards) || 0, wins: Number(s && s.mirror_wins) || 0,
      reward: SHARD_WIN, weekEnd: Date.parse(addDay(wk, 7) + 'T00:00:00Z') - 9 * HOUR, shop: await shopView(uid), titleNeed: MIRROR_TITLE };
  }
  route('GET', '/api/mg/mirror', async (req, res, ctx) => { if (!(await on())) return off(res); send(res, 200, await mirrorView(ctx.user.id, Date.now())); });
  route('POST', '/api/mg/mirror/fight', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    if (await limited('mgmr:' + ctx.user.id, 10, 60000)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), wk = weekKey(now), m = await pvpMine(uid, now);
    if (!m.u.pvp_set) return fail(res, 409, 'no_stats');
    await db.run('INSERT INTO mg_mirror (user_id, week) VALUES (?, ?) ON CONFLICT(user_id, week) DO NOTHING', [uid, wk]);
    const w = await db.run('UPDATE mg_mirror SET tries = tries + 1 WHERE user_id = ? AND week = ? AND tries < ? AND win = 0', [uid, wk, MIRROR_TRIES]);
    if (w.changes !== 1) { const r = await db.get('SELECT win FROM mg_mirror WHERE user_id = ? AND week = ?', [uid, wk]); return fail(res, 409, Number(r && r.win) ? 'won' : 'no_tries'); }
    const mir = flip(m.a), rnd = G.mulberry32((hash(uid + ':' + now) ^ Math.floor(Math.random() * 1e9)) >>> 0);
    const bt = G.pvpBattle(m.a, compFx(m.comp), mir, null, rnd), win = bt.winner === 0;
    let title = false;
    if (win) {
      await db.run('UPDATE mg_mirror SET win = 1 WHERE user_id = ? AND week = ?', [uid, wk]);
      await ensure(uid);
      await db.run('UPDATE mg_state SET shards = shards + ?, mirror_wins = mirror_wins + 1 WHERE user_id = ?', [SHARD_WIN, uid]);
      const s = await db.get('SELECT mirror_wins FROM mg_state WHERE user_id = ?', [uid]);
      if (Number(s.mirror_wins) >= MIRROR_TITLE) { try { title = await CT.grantTitle(uid, 'mg_mirror'); } catch (_) {} }
    }
    send(res, 200, Object.assign({ ok: true, win, title, battle: { log: bt.log, hp: bt.hp, turns: bt.turns, max: G.PVP.HP } }, await mirrorView(uid, now)));
  });
  route('POST', '/api/mg/mirror/buy', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), k = String(ctx.body.k || ''), v = String(ctx.body.v || ''), P = COS_SHOP.find(p => p[0] === k && p[1] === v);
    if (!P) return fail(res, 404, 'not_found');
    if (await db.get('SELECT 1 AS x FROM mg_cos_own WHERE user_id = ? AND k = ? AND v = ?', [uid, k, v])) return fail(res, 409, 'owned');
    await ensure(uid);
    const w = await db.run('UPDATE mg_state SET shards = shards - ? WHERE user_id = ? AND shards >= ?', [P[3], uid, P[3]]);
    if (w.changes !== 1) return fail(res, 409, 'no_shards');
    await db.run('INSERT INTO mg_cos_own (user_id, k, v, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, k, v) DO NOTHING', [uid, k, v, now]);
    send(res, 200, Object.assign({ ok: true, bought: P[2] }, await mirrorView(uid, now)));
  });

  // ═════════ 13 반짝 우체통 ═════════
  async function mailView(uid, now) {
    const inb = await db.all('SELECT id, text, taint, at, seen, heart FROM mg_mail WHERE to_id = ? ORDER BY id DESC LIMIT 60', [uid]);
    const out = await db.all('SELECT m.id, m.text, m.at, m.seen, m.heart, u.hunter_name AS tn FROM mg_mail m JOIN users u ON u.id = m.to_id WHERE m.from_id = ? ORDER BY m.id DESC LIMIT 20', [uid]);
    const sent = await db.get('SELECT COUNT(*) AS c FROM mg_mail WHERE from_id = ? AND at >= ?', [uid, dayStart(dayKey(now))]);
    return { inbox: inb.map(m => ({ id: m.id, text: G.garble(m.text, m.taint, m.id), at: Number(m.at), fresh: !Number(m.seen), heart: !!Number(m.heart) })),
      sent: out.map(m => ({ id: m.id, text: m.text, to: m.tn, at: Number(m.at), seen: !!Number(m.seen), heart: !!Number(m.heart) })), left: Math.max(0, MAIL_DAY - Number(sent.c)), max: MAIL_DAY, len: MAIL_MAX };
  }
  route('GET', '/api/mg/mail', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const v = await mailView(ctx.user.id, Date.now());
    if (url(req).searchParams.get('read')) await db.run('UPDATE mg_mail SET seen = 1 WHERE to_id = ? AND seen = 0', [ctx.user.id]);
    send(res, 200, v);
  });
  route('POST', '/api/mg/mail', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const u = ctx.user, now = Date.now();
    if (u.block_flags & 8) return fail(res, 403, 'blocked');      // 메신저와 같은 검열: 운영자가 메시지를 막은 헌터는 보낼 수 없음
    if (await limited('mgml:' + u.id, 10, 60000)) return fail(res, 429, 'rate_limited');
    const text = String(ctx.body.text || '').replace(/\s+/g, ' ').trim();
    if (!text || cp(text) > MAIL_MAX) return fail(res, 400, 'bad_text');
    const sent = await db.get('SELECT COUNT(*) AS c FROM mg_mail WHERE from_id = ? AND at >= ?', [u.id, dayStart(dayKey(now))]);
    if (Number(sent.c) >= MAIL_DAY) return fail(res, 429, 'no_mail');
    let to = null;
    const raw = String(ctx.body.target || '').trim();
    if (ctx.body.random) {
      const rs = await db.all('SELECT id FROM users WHERE id <> ? ORDER BY RANDOM() LIMIT 1', [u.id]);
      if (rs.length) to = await userById(rs[0].id);
    } else if (raw) {
      to = await userByCode(normCode(raw));
      if (!to) { const rs = await db.all('SELECT id FROM users WHERE hunter_name = ? LIMIT 2', [raw]); if (rs.length > 1) return fail(res, 409, 'ambiguous'); if (rs.length) to = await userById(rs[0].id); }
    }
    if (!to) return fail(res, 404, 'no_user');
    if (to.id === u.id) return fail(res, 400, 'self');
    const tn = Number(JSON.parse((await db.get('SELECT stats FROM users WHERE id = ?', [u.id])).stats).taint) || 0;
    await db.run('INSERT INTO mg_mail (from_id, to_id, text, taint, at) VALUES (?, ?, ?, ?, ?)', [u.id, to.id, text, tn, now]);
    send(res, 200, Object.assign({ ok: true, to: ctx.body.random ? '' : to.hunter_name }, await mailView(u.id, now)));
  });
  route('POST', '/api/mg/mail/heart', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const w = await db.run('UPDATE mg_mail SET heart = 1, seen = 1 WHERE id = ? AND to_id = ? AND heart = 0', [Number(ctx.body.id) || 0, ctx.user.id]);
    send(res, 200, { ok: w.changes === 1 });
  });


  // ── 관리자: 유저끼리 주고받은 반짝 우체통 편지 보기·지우기 (이벤트가 꺼져 있어도 기록은 볼 수 있음) ──
  route('GET', '/api/admin/mg/mail', async (req, res) => {
    const u = url(req), q = String(u.searchParams.get('q') || '').trim(), before = Number(u.searchParams.get('before')) || 0;
    const where = [], args = [];
    if (before) { where.push('m.id < ?'); args.push(before); }
    if (q) { where.push('(uf.hunter_name LIKE ? OR ut.hunter_name LIKE ? OR uf.code = ? OR ut.code = ? OR m.text LIKE ?)'); const lk = '%' + q + '%'; args.push(lk, lk, normCode(q), normCode(q), lk); }
    const rows = await db.all('SELECT m.id, m.text, m.taint, m.at, m.seen, m.heart, uf.hunter_name AS fn, uf.code AS fc, ut.hunter_name AS tn, ut.code AS tc FROM mg_mail m LEFT JOIN users uf ON uf.id = m.from_id LEFT JOIN users ut ON ut.id = m.to_id' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY m.id DESC LIMIT 50', args);
    const tot = await db.get('SELECT COUNT(*) AS c FROM mg_mail');
    const today = await db.get('SELECT COUNT(*) AS c FROM mg_mail WHERE at >= ?', [dayStart(dayKey(Date.now()))]);
    send(res, 200, { total: Number(tot.c) || 0, today: Number(today.c) || 0, more: rows.length === 50,
      list: rows.map(r => ({ id: r.id, text: r.text, shown: G.garble(r.text, r.taint, r.id), taint: Number(r.taint) || 0, at: Number(r.at), seen: !!Number(r.seen), heart: !!Number(r.heart), from: { name: r.fn || '(삭제된 헌터)', code: r.fc || '' }, to: { name: r.tn || '(삭제된 헌터)', code: r.tc || '' } })) });
  }, { auth: false, admin: true });
  route('POST', '/api/admin/mg/mail/delete', async (req, res, ctx) => {
    const w = await db.run('DELETE FROM mg_mail WHERE id = ?', [Number(ctx.body.id) || 0]);
    send(res, 200, { ok: w.changes === 1 });
  }, { auth: false, admin: true });
  // ═════════ 14 리본 묶기 ═════════
  async function ribOf(uid) { const r = await db.get('SELECT r.partner, r.color, r.at, u.hunter_name, u.code, u.region FROM mg_rib r JOIN users u ON u.id = r.partner WHERE r.user_id = ?', [uid]); return r || null; }
  async function ribView(uid) {
    const r = await ribOf(uid), me = await db.get('SELECT region FROM users WHERE id = ?', [uid]);
    const inc = await db.all('SELECT o.from_id, o.color, o.at, u.hunter_name FROM mg_rib_off o JOIN users u ON u.id = o.from_id WHERE o.to_id = ? ORDER BY o.at DESC', [uid]);
    const out = await db.get('SELECT o.to_id, o.color, u.hunter_name FROM mg_rib_off o JOIN users u ON u.id = o.to_id WHERE o.from_id = ?', [uid]);
    return { rib: r ? { with: r.hunter_name, code: r.code, color: r.color, at: Number(r.at), same: !!(me && r.region === me.region), where: placeName(r.region) } : null,
      incoming: inc.map(i => ({ from: i.from_id, name: i.hunter_name, color: i.color })), outgoing: out ? { name: out.hunter_name, color: out.color } : null, colors: RIB_COLORS, ko: RIB_KO, fx: RIB_FX };
  }
  route('GET', '/api/mg/ribbon', async (req, res, ctx) => { if (!(await on())) return off(res); send(res, 200, await ribView(ctx.user.id)); });
  route('POST', '/api/mg/ribbon/offer', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    if (await limited('mgrb:' + ctx.user.id, 20, HOUR)) return fail(res, 429, 'rate_limited');
    const uid = ctx.user.id, now = Date.now(), color = String(ctx.body.color || ''), raw = String(ctx.body.target || '').trim();
    if (!RIB_COLORS.includes(color)) return fail(res, 400, 'bad_color');
    if (await ribOf(uid)) return fail(res, 409, 'tied');
    let f = raw ? await userByCode(normCode(raw)) : null;
    if (!f && raw) { const rs = await db.all('SELECT u.id FROM friends fr JOIN users u ON u.id = fr.friend_id WHERE fr.user_id = ? AND u.hunter_name = ?', [uid, raw]); if (rs.length === 1) f = await userById(rs[0].id); }
    if (!f) return fail(res, 404, 'no_user');
    if (f.id === uid) return fail(res, 400, 'self');
    if (!(await isFriend(uid, f.id))) return fail(res, 403, 'not_friend');
    if (await ribOf(f.id)) return fail(res, 409, 'target_tied');
    await db.run('DELETE FROM mg_rib_off WHERE from_id = ?', [uid]);      // 리본은 한 번에 한 명에게만: 보낸 리본은 하나
    await db.run('INSERT INTO mg_rib_off (from_id, to_id, color, at) VALUES (?, ?, ?, ?)', [uid, f.id, color, now]);
    send(res, 200, Object.assign({ ok: true, to: f.hunter_name }, await ribView(uid)));
  });
  route('POST', '/api/mg/ribbon/answer', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, now = Date.now(), from = Number(ctx.body.from) || 0;
    const o = await db.get('SELECT color FROM mg_rib_off WHERE from_id = ? AND to_id = ?', [from, uid]);
    if (!o) return fail(res, 404, 'gone');
    await db.run('DELETE FROM mg_rib_off WHERE from_id = ? AND to_id = ?', [from, uid]);
    if (ctx.body.yes) {
      if (await ribOf(uid)) return fail(res, 409, 'tied');
      if (await ribOf(from)) return fail(res, 409, 'target_tied');
      if (!(await isFriend(uid, from))) return fail(res, 403, 'not_friend');
      const a = await db.run('INSERT INTO mg_rib (user_id, partner, color, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING', [uid, from, o.color, now]);
      const b = await db.run('INSERT INTO mg_rib (user_id, partner, color, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING', [from, uid, o.color, now]);
      if (a.changes !== 1 || b.changes !== 1) { await db.run('DELETE FROM mg_rib WHERE (user_id = ? AND partner = ?) OR (user_id = ? AND partner = ?)', [uid, from, from, uid]); return fail(res, 409, 'tied'); }
      await db.run('DELETE FROM mg_rib_off WHERE from_id IN (?, ?) OR to_id IN (?, ?)', [uid, from, uid, from]);      // 둘에게 걸린 다른 리본 신청은 정리
    }
    send(res, 200, Object.assign({ ok: true }, await ribView(uid)));
  });
  route('POST', '/api/mg/ribbon/untie', async (req, res, ctx) => {
    if (!(await on())) return off(res);
    const uid = ctx.user.id, r = await ribOf(uid);
    await db.run('DELETE FROM mg_rib_off WHERE from_id = ?', [uid]);
    if (r) await db.run('DELETE FROM mg_rib WHERE (user_id = ? AND partner = ?) OR (user_id = ? AND partner = ?)', [uid, r.partner, r.partner, uid]);
    send(res, 200, Object.assign({ ok: true }, await ribView(uid)));
  });
  async function stateExtra(uid, now) {      // /api/state 의 mg 에 더할 2차 묶음 정보
    await fairyTick(uid, now);
    const lt = await db.get('SELECT COUNT(*) AS c FROM mg_letter WHERE user_id = ? AND seen = 0', [uid]);
    const sh = await shootLive(now);
    let shoot = null;
    if (sh) { const me = await db.get('SELECT 1 AS x FROM mg_wish WHERE sid = ? AND user_id = ?', [sh.id, uid]); shoot = { id: sh.id, start: sh.start, end: sh.start + SHOOT_DUR, done: !!me }; }
    const dv = await db.get("SELECT COUNT(*) AS c FROM mg_duel WHERE (a = ? AND st = 'done' AND seen_a = 0) OR (b = ? AND st = 'invite')", [uid, uid]);
    const ml = await db.get('SELECT COUNT(*) AS c FROM mg_mail WHERE to_id = ? AND seen = 0', [uid]), ro = await db.get('SELECT COUNT(*) AS c FROM mg_rib_off WHERE to_id = ?', [uid]);
    return { letters: Number(lt.c) || 0, shoot, wishPaid: await wishSettle(uid, now), duel: Number(dv.c) || 0, fairy: fairyView(await fairyRow(uid)), mail: Number(ml.c) || 0, ribReq: Number(ro.c) || 0 };
  }

  return { stateOf, cosOf, profileExtra, oathNeed, newEpoch, onPurify, act, OATH, SQL };
}

module.exports = { install, SQL, COS, STARS, PETS, FAIRIES, TF_BUFF, TF_CD };
