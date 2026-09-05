// 리허설 전용 로컬 SMS 스텁 — notification 서비스의 /internal/sms/send 만 흉내낸다.
// 외부로 아무것도 보내지 않는다. 받은 내용(=인증번호)을 stdout 에 찍는다.
const http = require('http');
const PORT = Number(process.env.SMS_STUB_PORT || 3099);
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/internal/sms/send') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let to = '?', content = '?';
      try { const j = JSON.parse(body); to = j.to; content = j.content; } catch {}
      console.log(`[SMS-STUB] ${new Date().toISOString()} to=${to} content=${content}`);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, provider: 'local-stub' }));
    });
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, '127.0.0.1', () => console.log(`[SMS-STUB] listening on :${PORT}`));
