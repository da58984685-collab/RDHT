# 적월 헌터 — Vercel 배포판

Vercel 서버리스 함수 + Turso(무료 SQLite 호스팅) 데이터베이스로 동작합니다. 게임 규칙은 이전 서버와 동일합니다.

## 구조
- `public/index.html` 게임 화면 (정적 파일)
- `api/index.js` 모든 `/api/*` 요청을 처리하는 함수 (`vercel.json` 의 rewrites)
- `lib/app.js` API 본체 · `lib/game.js` 게임 규칙 · `lib/db.js` DB 연결
- `dev.js` 내 컴퓨터 시험 실행 (`node dev.js`, 환경변수 없으면 `data/hunter.db` 파일 사용)

## 배포 순서
1. **Turso 가입** (turso.tech, 무료) → 데이터베이스 생성 → `Database URL` 과 `Auth Token` 복사
   (CLI: `turso db create hunter` / `turso db show hunter --url` / `turso db tokens create hunter`)
2. 이 폴더를 GitHub 저장소에 올립니다. (이전 저장소를 이 내용으로 교체)
3. Vercel → 해당 저장소 Import → **Settings → Environment Variables** 에 추가:

| 이름 | 값 |
|---|---|
| `TURSO_DATABASE_URL` | 1번의 URL (`libsql://...`) |
| `TURSO_AUTH_TOKEN` | 1번의 토큰 |
| `ADMIN_TOKEN` | 관리자 알림용 비밀 문자열 (긴 무작위 값) |
| `CRON_SECRET` | 아무 긴 무작위 문자열 (Vercel Cron 인증용) |

4. Deploy. 표는 처음 요청 때 자동 생성됩니다. `https://내주소/api/healthz` 가 `{"ok":true}` 면 성공입니다.

## 동작 방식 (이전과 달라진 점)
- 몬스터 출몰과 S급 결과 처리는 **누군가 접속해 요청할 때마다 시간을 따라잡아 처리**합니다(출몰 시각은 원래 예정 시각으로 기록). 아무도 없던 동안의 출몰은 최근 24시간까지만 반영됩니다.
- `vercel.json` 의 Cron 은 하루 1회(Hobby 요금제 제한)로 정리·보정만 합니다. Pro 요금제라면 `"* * * * *"` 로 바꿀 수 있습니다.
- 횟수 제한은 DB에 저장되어 여러 함수 사이에서 공유됩니다.
- 쿠키는 Vercel(HTTPS)에서 자동으로 Secure 입니다.

## 관리자 알림 보내기
```
curl -X POST https://내주소/api/admin/notice -H "Authorization: Bearer ADMIN_TOKEN값" -H "Content-Type: application/json" -d '{"text":"점검 안내입니다."}'
```

## 시험
`npm test` (Node 22.13+, 임시 파일 DB 사용).
