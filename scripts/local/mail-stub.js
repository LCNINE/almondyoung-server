// 리허설 전용 로컬 메일 스텁 — Resend 의 POST /emails 만 흉내낸다.
// 외부로 아무것도 보내지 않는다. 받은 메일을 stdout 에 찍고 HTML 을 파일로 떨군다.
//
// 왜 있어야 하나: notification 의 RESEND_BASE_URL 은 여기를 가리키지만, 받는 쪽이 없으면
// 발송이 ECONNREFUSED 로 끝나 본문을 눈으로 볼 수 없다.
// 🔴 DB 의 notification_providers.config.baseUrl 이 env 를 «이긴다»(resend.provider.ts).
//    라이브 복제 DB 를 물면 그 행이 api.resend.com 을 가리키므로, 이 스텁을 쓰기 전에
//    그 행부터 localhost 로 돌려놓을 것.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.MAIL_STUB_PORT || 9999);
const OUT = process.env.MAIL_STUB_DIR || path.join(require('os').tmpdir(), 'almondyoung-mail-stub');
fs.mkdirSync(OUT, { recursive: true });

let seq = 0;

http
  .createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith('/emails')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let mail = {};
      try {
        mail = JSON.parse(body);
      } catch {}
      const id = `stub-${Date.now()}-${++seq}`;
      const file = path.join(OUT, `${String(seq).padStart(3, '0')}-${(mail.subject || 'no-subject').slice(0, 40).replace(/[^\w가-힣-]+/g, '_')}.html`);
      fs.writeFileSync(file, mail.html || mail.text || '');
      console.log(`[MAIL-STUB] to=${JSON.stringify(mail.to)} subject=${mail.subject}`);
      console.log(`[MAIL-STUB]   → ${file}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id }));
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[MAIL-STUB] listening on :${PORT} → ${OUT}`));
