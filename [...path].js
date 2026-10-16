'use strict';
// 모든 /api/* 요청을 처리하는 Vercel 함수 (vercel.json 의 rewrites 참고)
module.exports = require('../lib/app').handle;
