'use strict';
// 내 컴퓨터에서 시험용으로 실행: node dev.js  (TURSO_* 가 없으면 data/hunter.db 파일을 사용, Node 22.13 이상)
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { handle, catchUp } = require('./lib/app');
const PUB = path.join(__dirname, 'public');
const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p.startsWith('/api/')) return handle(req, res);
  const f = path.join(PUB, p === '/' ? 'index.html' : path.normalize(p));
  if (!f.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    res.end(b);
  });
});
function start(port) { return new Promise(r => server.listen(port, '127.0.0.1', () => r(server))); }
if (require.main === module) start(Number(process.env.PORT) || 3000).then(() => console.log('http://localhost:' + (process.env.PORT || 3000)));
module.exports = { start, server, resolveDue: require('./lib/app').resolveDue, catchUp };
