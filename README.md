적월협인 (Vercel). 구조: 맨 위에 index.html / package.json / vercel.json, 그리고 api 폴더 하나.
환경변수: DATABASE_URL (Neon·Supabase 등 PostgreSQL 접속 주소), ADMIN_TOKEN, CRON_SECRET
확인: /api/healthz

관리자 창: /admin  (환경변수 ADMIN_ID, ADMIN_PASSWORD 필요)
