import { createHmac } from 'crypto';
import { HanjinHmacSigner } from './hanjin-hmac.signer';

describe('HanjinHmacSigner', () => {
  const creds = {
    clientId: 'HANJIN',
    apiKey: 'test-key',
    secretKey: 'RAXGVUWSBvmnARzoYsylxcBLvdVm1GUzWRslNYKGKdadStnCnAJFGPUbyvHNcVmD',
  };
  // 공식 가이드 실행결과: message "20231009152839GET" + query + secret → 아래 서명
  // 20231009152839 KST = 2023-10-09T06:28:39Z
  const fixedNow = () => new Date('2023-10-09T06:28:39.000Z');

  it('GET+쿼리 서명이 공식 골든 벡터와 일치(소문자 hex)', () => {
    const signer = new HanjinHmacSigner(creds, fixedNow);
    const headers = signer.sign(
      'GET',
      'https://api-stg.hanjin.com/parcel-delivery/v1/customer/customer-check?cntractNo=9771759',
    );
    expect(headers.Authorization).toBe(
      'client_id=HANJIN timestamp=20231009152839 signature=576f6c59d7f60872c94c05b2e2d69ab056ff1e1ff9fee110a6ebadf3d96664bf',
    );
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('POST(쿼리 없음)는 message에 queryString이 빈 문자열', () => {
    const signer = new HanjinHmacSigner(creds, fixedNow);
    const headers = signer.sign('POST', 'https://api-stg.hanjin.com/parcel-delivery/v1/order/insert-order');
    // 수동 재현: HMAC_SHA256("20231009152839POST" + secret, key=secret) 의 hex 소문자
    const expected = createHmac('sha256', creds.secretKey)
      .update('20231009152839POST' + creds.secretKey, 'utf8')
      .digest('hex');
    expect(headers.Authorization).toBe(`client_id=HANJIN timestamp=20231009152839 signature=${expected}`);
  });

  it('KST 포맷: UTC 15:00 → 익일 00시대 (h23)', () => {
    const signer = new HanjinHmacSigner(creds, () => new Date('2023-10-09T15:00:05.000Z'));
    const headers = signer.sign('POST', 'https://x/y');
    expect(headers.Authorization).toContain('timestamp=20231010000005');
  });
});
