적월협인 (Vercel). 구조: 맨 위에 index.html / package.json / vercel.json, 그리고 api 폴더 하나.
환경변수: DATABASE_URL (Neon·Supabase 등 PostgreSQL 접속 주소), ADMIN_TOKEN, CRON_SECRET
확인: /api/healthz

관리자 창: /admin  (환경변수 ADMIN_ID, ADMIN_PASSWORD 필요)

── 할로윈 이벤트 · 화면 테마 (되돌리기) ──
- 가장 쉬운 방법: 관리자 창 '할로윈 이벤트' 카드에서 [끄기]. 이벤트 기능과 할로윈 화면 테마가 함께 꺼집니다. ('자동'은 api/_event.js 의 START~END 기간에만 켜짐)
- 할로윈 화면 테마 파일: halloween.js, halloween.css (+ 만드는 도구 tools/gen-halloween-css.py, halloween_sprites.py, halloween_decor.css)
  · index.html 에서 [THEME:HALLOWEEN] 표시 아래의 <script src="/halloween.js"></script> 한 줄만 지우면 테마가 완전히 사라집니다.
  · 미리 보기: 주소 끝에 ?hlw=1 (해제 ?hlw=0)
- 이벤트 규칙·데이터 파일: api/_event.js (다른 파일에서 'EVENT:HALLOWEEN' 으로 검색)

## DB 전송량(egress) 최적화 메모

- 목록·상태 조회는 필요한 컬럼만 가져옵니다. 사진(base64)·성격·특성 같은 긴 값은 평소 조회에서 제외됩니다.
- 사진은 `/api/img?k=...&v=...` 주소로 제공되며 브라우저/CDN에 1년간 캐시됩니다. 사진을 바꾸면 `v` 값(users.img_ver)이 바뀌어 새 주소가 됩니다. 서명 키는 `IMG_SECRET`(없으면 관리자 비밀번호 기반)입니다.
- 화면이 숨겨진 탭에서는 상태/알림/메신저/지도 확인을 멈추고, 탭으로 돌아오면 한 번 바로 확인합니다.
- `DATABASE_URL` 은 Neon의 **Pooled connection**(호스트에 `-pooler` 포함) 주소를 쓰세요. 아니면 서버 로그에 경고가 찍힙니다.
- 되돌리려면 이전 버전의 `api/_app.js`, `api/_db.js`, `index.html` 으로 교체하세요. (추가된 `users.img_ver` 열은 남아 있어도 무해합니다.)

