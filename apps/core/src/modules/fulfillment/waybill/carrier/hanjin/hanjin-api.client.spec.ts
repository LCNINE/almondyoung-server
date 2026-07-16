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

  it('get: print 호스트 + 쿼리 직렬화(서명은 쿼리 포함 URL로)', async () => {
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
});
