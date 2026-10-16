# 적월 헌터 — 게임 서버

사이트 화면(`public/index.html`)과 서버(`server.js`)를 한 폴더로 묶은 프로젝트입니다.
외부 패키지 없이 **Node.js 22.13 이상**의 내장 기능(HTTP, SQLite, 암호화)만 사용하므로 `npm install`이 필요 없습니다.

## 실행

```bash
node server.js            # http://localhost:3000
```

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `DATA_DIR` | `./data` | 데이터베이스 폴더 (`hunter.db`가 생깁니다) |
| `ADMIN_TOKEN` | (없음) | 관리자 알림 API용 비밀 값. **길고 무작위인 문자열**로 설정하세요. 없으면 관리자 API가 꺼집니다 |
| `COOKIE_SECURE` | `0` | HTTPS로 운영하면 `1` (로그인 쿠키에 Secure 속성 추가) |
| `TRUST_PROXY` | `0` | 리버스 프록시 뒤에서 운영하면 `1` (접속자 IP를 `X-Forwarded-For`에서 읽음) |
| `S_RESULT_DELAY_MS` | `86400000` | S급 토벌 결과 공개까지 걸리는 시간(테스트용으로만 줄이세요) |

점검: `node test/smoke.js` — 임시 DB로 가입·로그인·토벌·S급·친구·메시지·관리자 알림을 자동 확인합니다.

## 배포할 때

1. 서버(VPS 등)에 폴더를 올리고 `ADMIN_TOKEN=... COOKIE_SECURE=1 TRUST_PROXY=1 node server.js`로 실행합니다.
   계속 켜 두려면 systemd, pm2, Docker 등으로 감싸세요.
2. **반드시 HTTPS로 서비스하세요.** 비밀번호가 서버로 전송되므로, Caddy나 nginx 같은 리버스 프록시에서 HTTPS를 처리하고 이 서버로 전달하면 됩니다.
   (Caddy 예: `example.com { reverse_proxy localhost:3000 }`)
3. 백업은 `data/hunter.db` 파일(과 같은 폴더의 `-wal`, `-shm` 파일)을 서버를 잠깐 멈춘 뒤 복사하면 됩니다.

## 서버가 맡는 일

- **가입/로그인:** 비밀번호는 scrypt로 해시해 저장하고, 헌터 등급과 스탯은 서버가 정합니다. 로그인하면 30일짜리 세션 쿠키(HttpOnly)가 발급됩니다. 로그인 시도 횟수를 제한합니다.
- **몬스터 출몰:** 모든 헌터에게 같은 몬스터가 같은 시각에 출몰합니다(F~D 5분, C~B 30분, A 1~2시간, S 하루 3번).
- **토벌:** 성공 여부, 경험치, 재토벌 대기 시간, S급 횟수 제한(1시간 3회)을 모두 서버가 계산합니다.
- **S급:** 도전하면 24시간 뒤에 결과가 정해지며, 그 시점에 **그 몬스터에 도전한 서버 전체 인원 수**로 성공 확률이 정해집니다(10명 이상이면 최대).
- **친구/메신저:** 고유 코드로 친구를 추가하면 서로의 목록에 들어가고, 메시지는 서버에 저장되어 상대에게 전달됩니다(화면은 3초마다 새 메시지를 확인).
- **시스템 알림:** 관리자가 보낸 알림이 서버의 모든 헌터에게 전달됩니다.

## 관리자 알림 보내기

관리자 전용 화면은 아직 없고, 아래 요청으로 서버의 모든 헌터에게 시스템 알림을 보낼 수 있습니다.
화면을 만들 때는 같은 API를 사용하면 됩니다.

```bash
curl -X POST https://example.com/api/admin/notice \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"오늘 밤 12시에 점검이 있습니다."}'
```

## 파일 구성

```
server.js         HTTP 서버, API, 몬스터 출몰·S급 결과 처리
game.js           게임 규칙(확률, 경험치, 출몰 주기 …) — 밸런스는 여기서 조정
db.js             SQLite 테이블 정의
public/index.html 게임 화면
test/smoke.js     자동 점검
```

## API 요약

`POST /api/signup` · `POST /api/login` · `POST /api/logout` · `GET /api/me` · `GET /api/state` ·
`POST /api/move` · `POST /api/hunt` · `POST /api/results/ack` ·
`GET|POST /api/friends` · `GET|POST /api/messages` · `GET /api/notices` · `POST /api/notices/seen` ·
`POST /api/admin/notice` · `GET /healthz`

## 알아둘 점

- 서버 한 대(프로세스 하나)에서 돌리는 구조입니다. 접속자가 아주 많아지면 데이터베이스와 실시간 전달 방식(지금은 주기적 확인)을 바꿔야 합니다.
- Node 내장 SQLite는 아직 "실험 기능" 표시가 붙어 있어 실행 시 경고가 한 줄 나옵니다. 동작에는 문제가 없습니다.
- 캐릭터 이미지는 데이터베이스에 그대로 저장됩니다(최대 약 512KB).
- 가입 정보 수정, 비밀번호 찾기, 계정 삭제, 관리자 화면은 아직 없습니다.
- 헌터 커뮤니티, 업적, 상점, 인벤토리는 화면만 있고 서버 기능은 아직 연결되지 않았습니다.
#RedmoonHunter
#RDHT
