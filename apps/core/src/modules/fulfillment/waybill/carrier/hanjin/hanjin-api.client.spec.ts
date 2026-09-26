import { HanjinApiClient } from './hanjin-api.client';
import { HanjinHmacSigner } from './hanjin-hmac.signer';
import type { HanjinConfig } from './hanjin.config';

const config = {
  clientId: 'HANJIN',
  apiKey: 'k',
  secretKey: 's',
  contractNo: '9117159',
  orderBaseUrl: 'https://api-stg.hanjin.com',
  printBaseUrl: 'https://ebbapd.hjt.co.kr',
  timeoutMs: 15000,
  sender: { name: 'wh', zip: '08588', baseAddress: 'a', detailAddress: 'b', tel: '02-1' },
  boxType: 'A',
  payType: 'PP',
} as HanjinConfig;

function client() {
  return new HanjinApiClient(config, new HanjinHmacSigner(config, () => new Date('2023-10-09T06:28:39Z')));
}

describe('HanjinApiClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('post: order 호스트 URL·서명 헤더로 호출하고 200 JSON 반환', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ resultCode: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const body: unknown = await client().post('order', '/parcel-delivery/v1/order/insert-order', { custOrdNo: 'X' });
    expect(body).toEqual({ resultCode: 'OK' });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://api-stg.hanjin.com/parcel-delivery/v1/order/insert-order');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(headers.Authorization).toContain('client_id=HANJIN timestamp=20231009152839 signature=');
  });

  it('get: print 호스트 라우팅 + 쿼리 직렬화(서명은 쿼리 포함 URL로)', async () => {
    const spy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ resultCode: 'OK' }), { status: 200 }));
    await client().get('print', '/v1/wbl/HANJIN/x', { a: '1', b: '2' });
    expect(spy.mock.calls[0][0]).toBe('https://ebbapd.hjt.co.kr/v1/wbl/HANJIN/x?a=1&b=2');
  });

  it('get: order 호스트 라우팅', async () => {
    const spy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ resultCode: 'OK' }), { status: 200 }));
    await client().get('order', '/parcel-delivery/v1/customer/customer-check', { cntractNo: '9117159' });
    expect(spy.mock.calls[0][0]).toBe(
      'https://api-stg.hanjin.com/parcel-delivery/v1/customer/customer-check?cntractNo=9117159',
    );
  });

  it('타임아웃(fetch reject) → CarrierError unknown_outcome', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    await expect(client().post('order', '/x', {})).rejects.toMatchObject({ outcome: 'unknown_outcome' });
  });

  it('HTTP 500 → unknown_outcome, HTTP 400 → definitive_rejection', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('err', { status: 500 }));
    await expect(client().post('order', '/x', {})).rejects.toMatchObject({ outcome: 'unknown_outcome' });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('bad', { status: 400 }));
    await expect(client().post('order', '/x', {})).rejects.toMatchObject({ outcome: 'definitive_rejection' });
  });

  // -103(10 TPS SpikeArrest, 정본 §5) 의 HTTP 상태는 미상이다 — DEV 는 초당 ~100건에도 재현되지 않았다(#916).
  // 그래서 상태코드가 아니라 바디의 errorCode 로 판별하고, 200·429 두 형태를 모두 막는다.
  describe('-103 Too many request', () => {
    const tooMany = (status: number, errorCode: number | string = -103) =>
      new Response(JSON.stringify({ errorCode, message: 'Too many request' }), { status });

    it.each([200, 429])('HTTP %i + errorCode -103 → transient_rejection, 1초 뒤 재시도 힌트', async (status) => {
      jest.spyOn(global, 'fetch').mockResolvedValue(tooMany(status));
      await expect(client().post('order', '/x', {})).rejects.toMatchObject({
        outcome: 'transient_rejection',
        details: { carrier: 'hanjin', code: '-103', retryAfter: { kind: 'after_ms', ms: 1000 } },
      });
    });

    it('errorCode 가 문자열 "-103" 이어도 같다', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(tooMany(200, '-103'));
      await expect(client().post('order', '/x', {})).rejects.toMatchObject({ outcome: 'transient_rejection' });
    });

    it('바디가 -103 이 아닌 HTTP 429 → 지금처럼 unknown_outcome', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(new Response('slow down', { status: 429 }));
      await expect(client().post('order', '/x', {})).rejects.toMatchObject({ outcome: 'unknown_outcome' });
    });

    it('다른 errorCode 는 가로채지 않고 그대로 반환한다', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(tooMany(200, -999));
      await expect(client().post('order', '/x', {})).resolves.toEqual({ errorCode: -999, message: 'Too many request' });
    });
  });
});
