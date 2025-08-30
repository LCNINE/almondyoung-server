// src/controllers/checkout.controller.ts
import { Controller, Get, Param, Query, Res, Response } from '@nestjs/common';
import { FastifyReply } from 'fastify';

@Controller('wallet/checkout')
export class CheckoutController {
  @Get(':sessionId')
  renderCheckout(
    @Param('sessionId') sessionId: string,
    @Query('returnUrl') returnUrl: string,
    @Res() res: FastifyReply,
  ): void {
    const html = `
<!doctype html><html><head><meta charset="utf-8" />
<title>Wallet Checkout</title></head>
<body>
  <h2>Wallet Checkout</h2>
  <p>Session: <code>${sessionId}</code></p>
  <label>Payment Method ID: <input id="pm" value="pm_abc123" /></label>
  <button id="approve">Approve</button>
  <pre id="log"></pre>
<script>
const log = (m) => document.getElementById('log').textContent += m + '\\n';
document.getElementById('approve').onclick = async () => {
  const paymentMethodId = document.getElementById('pm').value.trim();
  try {
    const resp = await fetch('/payments/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem_approve_' + Date.now()
      },
      body: JSON.stringify({
        sessionId: '${sessionId}',
        paymentMethodId,
        // paymentKey는 MVP stub이면 생략 가능
        metadata: { ui: 'wallet-checkout' }
      })
    });
    const data = await resp.json();
    log('Approved: ' + JSON.stringify(data));
    if (resp.ok) {
      const q = new URLSearchParams({
        authorizedEventId: data.paymentId
      }).toString();
      const back = '${returnUrl || ''}';
      if (!back) {
        log('returnUrl 미지정. 이 페이지에 머무릅니다.');
        return;
      }
      location.href = back + (back.includes('?') ? '&' : '?') + q;
    } else {
      alert('Approve failed: ' + data.message);
    }
  } catch (e) {
    alert('Error: ' + e);
  }
};
</script>
</body></html>`;
    res.header('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
}
