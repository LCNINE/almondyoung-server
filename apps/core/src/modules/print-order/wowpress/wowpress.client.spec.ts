import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WowpressApiError, WowpressClient } from './wowpress.client';
import { type WowpressLineSpec, type WowpressRequest, type WowpressResponse } from './wowpress.types';

const API = 'https://api.wowpress.co.kr';
const ENV = {
  WOWPRESS_AUTH_UID: 'uid',
  WOWPRESS_AUTH_PW: 'pw',
  WOWPRESS_SENDER_NAME: '아몬드영',
  WOWPRESS_SENDER_TEL: '010-0000-0000',
  WOWPRESS_SENDER_ZIPCODE: '06236',
  WOWPRESS_SENDER_ADDR1: '서울특별시 강남구 테헤란로 152',
  WOWPRESS_SENDER_ADDR2: '10층',
};

const SPEC: WowpressLineSpec = {
  prodno: 40026,
  jobpresetno: '3',
  prsjob: [{ jobno: 1 }],
  awkjob: [{ jobno: 2 }],
  qtyPerUnit: 100,
  file: { format: 'jpg', dpi: 350 },
  confirmed: false,
};

type Handler = (req: WowpressRequest) => WowpressResponse;

function fakeTransport(routes: Record<string, Handler[]>) {
  const calls: WowpressRequest[] = [];
  const transport = (req: WowpressRequest): Promise<WowpressResponse> => {
    calls.push(req);
    const queue = routes[req.url];
    if (!queue || queue.length === 0) throw new Error(`unexpected call ${req.method} ${req.url}`);
    const handler = queue.length > 1 ? queue.shift() : queue[0];
    if (!handler) throw new Error('no handler');
    return Promise.resolve(handler(req));
  };
  return { transport, calls };
}

const ok =
  (extra: Record<string, unknown> = {}): Handler =>
  () => ({ status: 200, body: { resultCode: '200', ...extra } });
const tokenOk = (token: string): Handler => ok({ token });
const orderOk = ok({ resultMap: { cjson_order: { ordinfo: [{ ordnum: 'WP_SAMPLE_0001' }] } } });
const orderOkTwo = ok({
  resultMap: {
    cjson_order: {
      ordinfo: [
        { ordnum: 'WP1', dboxno: 4343784, prodno: 40008 },
        { ordnum: 'WP2', dboxno: 4343784, prodno: 40073 },
      ],
      dlvinfo: [{ dboxno: 4343784, dboxnum: '4-1-4343784', dlvcost_bill: 0 }],
    },
  },
});

function makeClient(routes: Record<string, Handler[]>, env: Record<string, string> = ENV) {
  const fake = fakeTransport(routes);
  return { client: new WowpressClient(new ConfigService(env), fake.transport), calls: fake.calls };
}

const RECEIVER = {
  name: '홍길동',
  tel: '010-1111-2222',
  zipcode: '13529',
  addr1: '경기도 성남시 분당구 판교역로 235',
  addr2: '101호',
  dlvymsg: '문 앞',
};

const ORDER_INPUT = {
  items: [
    {
      spec: SPEC,
      qty: 2,
      ordbody: '테스트 시안입니다. 혹시 이 시안대로 출력이 되나요?',
      ordkey: '0190f1d2-0000-7000-8000-000000000001',
    },
  ],
  ordtitle: '아몬드영 SO-1',
  receiver: RECEIVER,
};

const BUNDLE_INPUT = {
  items: [
    { spec: SPEC, qty: 2, ordbody: '<TEST 메모>', ordkey: 'line-a' },
    { spec: { ...SPEC, prodno: 40073 }, qty: 3, ordbody: '<TEST 메모2>', ordkey: 'line-b' },
  ],
  ordtitle: '아몬드영 SO-1',
  receiver: RECEIVER,
};

function orderBody() {
  return {
    ordinfo: [
      { ordnum: 'WP1', dboxno: 4343784, prodno: 40008 },
      { ordnum: 'WP2', dboxno: 4343784, prodno: 40073 },
    ],
    dlvinfo: [{ dboxno: 4343784, dboxnum: '4-1-4343784', dlvcost_bill: 0 }],
  };
}

describe('WowpressClient', () => {
  it('issues a token once and sends Bearer on order', async () => {
    const { client, calls } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok-1')],
      [`${API}/api/v1/ord/cjson_order`]: [orderOk],
    });

    await expect(client.order(ORDER_INPUT)).resolves.toEqual({
      orders: [{ ordnum: 'WP_SAMPLE_0001', dboxno: null, prodno: null }],
      boxes: [],
    });
    await client.order(ORDER_INPUT);

    const issues = calls.filter((c) => c.url.endsWith('/api/login/issue'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ method: 'GET', json: { authUid: 'uid', authPw: 'pw' } });
    const orders = calls.filter((c) => c.url.endsWith('/cjson_order'));
    expect(orders.map((c) => c.token)).toEqual(['tok-1', 'tok-1']);
  });

  it('builds cjson_order with ordbody, ordkey, dlvymcd "4", dlvyfr from env and dlvyto', async () => {
    const { client, calls } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/cjson_order`]: [orderOk],
    });

    await client.order(ORDER_INPUT);

    const req = calls.find((c) => c.url.endsWith('/cjson_order'));
    expect(req?.method).toBe('POST');
    const body = req?.json;
    expect(body).toMatchObject({ action: 'ord', dlvymcd: '4' });
    expect(body).toHaveProperty('ordreq', [
      [
        {
          prodno: 40026,
          ordqty: '200',
          ordcnt: '1',
          ordtitle: '아몬드영 SO-1',
          ordbody: '테스트 시안입니다. 혹시 이 시안대로 출력이 되나요?',
          ordkey: '0190f1d2-0000-7000-8000-000000000001',
          jobpresetno: '3',
          prsjob: [{ jobno: 1 }],
          awkjob: [{ jobno: 2 }],
        },
      ],
    ]);
    expect(body).toHaveProperty('dlvyfr', {
      name: '아몬드영',
      tel: '010-0000-0000',
      zipcode: '06236',
      sd: '서울',
      sgg: '강남구',
      umd: '테헤란로',
      addr1: '서울특별시 강남구 테헤란로 152',
      addr2: '10층',
    });
    expect(body).toHaveProperty('dlvyto', {
      name: '홍길동',
      tel: '010-1111-2222',
      zipcode: '13529',
      sd: '경기',
      sgg: '성남시 분당구',
      umd: '판교역로',
      addr1: '경기도 성남시 분당구 판교역로 235',
      addr2: '101호',
      dlvymsg: '문 앞',
    });
  });

  it('treats HTTP 200 with resultCode "400" as WowpressApiError carrying errMsg', async () => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/ord_cancel`]: [
        () => ({ status: 200, body: { resultCode: '400', errMsg: '취소 불가 상태' } }),
      ],
    });

    const err = await client.cancel('WP1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WowpressApiError);
    expect(err).toHaveProperty('message', '취소 불가 상태');
  });

  it('treats a non-2xx status as WowpressApiError', async () => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/ord_cancel`]: [() => ({ status: 500, body: 'oops' })],
    });

    await expect(client.cancel('WP1')).rejects.toBeInstanceOf(WowpressApiError);
  });

  it('reissues the token once on 401 then retries a read-only detail call', async () => {
    const { client, calls } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('old'), tokenOk('new')],
      [`${API}/api/v1/ord/order/WP1`]: [() => ({ status: 401, body: {} }), ok({ resultMap: { ordstat: 1 } })],
    });

    await expect(client.detail('WP1')).resolves.toMatchObject({ ordstat: 1 });

    const details = calls.filter((c) => c.url.endsWith('/order/WP1'));
    expect(details.map((c) => c.token)).toEqual(['old', 'new']);
  });

  it('reissues the token once on 401 then retries a quote', async () => {
    const { client, calls } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('old'), tokenOk('new')],
      [`${API}/api/v1/ord/cjson_jobcost`]: [() => ({ status: 401, body: {} }), ok({ resultMap: {} })],
    });

    await client.quote(SPEC, 2);

    expect(calls.filter((c) => c.url.endsWith('/cjson_jobcost')).map((c) => c.token)).toEqual(['old', 'new']);
  });

  it('does not loop when 401 persists after reissue', async () => {
    const { client, calls } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('a'), tokenOk('b')],
      [`${API}/api/v1/ord/order/WP1`]: [() => ({ status: 401, body: {} })],
    });

    await expect(client.detail('WP1')).rejects.toBeInstanceOf(WowpressApiError);
    expect(calls.filter((c) => c.url.endsWith('/order/WP1'))).toHaveLength(2);
  });

  it('sends cjson_order exactly once on 401 and the next call uses a fresh token', async () => {
    const { client, calls } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('old'), tokenOk('new')],
      [`${API}/api/v1/ord/cjson_order`]: [() => ({ status: 401, body: {} }), orderOk],
      [`${API}/api/v1/ord/order/WP1`]: [ok({ resultMap: { ordstat: 1 } })],
    });

    await expect(client.order(ORDER_INPUT)).rejects.toThrow('unauthorized');
    expect(calls.filter((c) => c.url.endsWith('/cjson_order'))).toHaveLength(1);

    await client.detail('WP1');
    expect(calls.find((c) => c.url.endsWith('/order/WP1'))?.token).toBe('new');
  });

  it.each([
    [
      'uploadFileUrl',
      'https://file.wowpress.co.kr/api/v1/file/uploadurl',
      (c: WowpressClient) => c.uploadFileUrl('WP1', 'a.jpg', 'https://s3/a.jpg'),
    ],
    ['cancel', `${API}/api/v1/ord/ord_cancel`, (c: WowpressClient) => c.cancel('WP1')],
  ])('does not resend %s on 401', async (_name, url, run) => {
    const { client, calls } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('old'), tokenOk('new')],
      [url]: [() => ({ status: 401, body: {} }), ok()],
    });

    await expect(run(client)).rejects.toThrow('unauthorized');
    expect(calls.filter((c) => c.url === url)).toHaveLength(1);
  });

  it('posts uploadurl as form-data with ordnum, filename, fileurl', async () => {
    const { client, calls } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      ['https://file.wowpress.co.kr/api/v1/file/uploadurl']: [ok()],
    });

    await client.uploadFileUrl('WP1', 'a.jpg', 'https://s3/a.jpg');

    const req = calls.find((c) => c.url.endsWith('/uploadurl'));
    expect(req).toMatchObject({
      method: 'POST',
      token: 'tok',
      form: { ordnum: 'WP1', filename: 'a.jpg', fileurl: 'https://s3/a.jpg' },
    });
    expect(req?.json).toBeUndefined();
  });

  it('quotes via cjson_jobcost', async () => {
    const { client, calls } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/cjson_jobcost`]: [ok({ resultMap: {} })],
    });

    await client.quote(SPEC, 3);

    expect(calls.find((c) => c.url.endsWith('/cjson_jobcost'))?.json).toMatchObject({
      prodno: 40026,
      ordqty: '300',
      ordcnt: '1',
      prsjob: [{ jobno: 1 }],
      awkjob: [{ jobno: 2 }],
    });
  });

  it('sends one ordreq element per item with its own ordkey and ordbody', async () => {
    const { client, calls } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/cjson_order`]: [orderOkTwo],
    });
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await client.order(BUNDLE_INPUT);

    const json = calls.find((c) => c.url.endsWith('/cjson_order'))?.json;
    expect(json).toHaveProperty('ordreq', [
      [expect.objectContaining({ ordkey: 'line-a', ordbody: '<TEST 메모>', ordqty: '200', prodno: 40026 })],
      [expect.objectContaining({ ordkey: 'line-b', ordbody: '<TEST 메모2>', ordqty: '300', prodno: 40073 })],
    ]);
    expect(json).toHaveProperty('dlvymcd', '4');
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('ordkey=line-a,line-b');
    logSpy.mockRestore();
  });

  it.each([
    ['nested in cjson_order', { cjson_order: orderBody() }],
    ['directly under resultMap', orderBody()],
  ])('parses ordinfo and dlvinfo into orders and boxes (%s)', async (_label, resultMap) => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/cjson_order`]: [ok({ resultMap })],
    });

    await expect(client.order(BUNDLE_INPUT)).resolves.toEqual({
      orders: [
        { ordnum: 'WP1', dboxno: 4343784, prodno: 40008 },
        { ordnum: 'WP2', dboxno: 4343784, prodno: 40073 },
      ],
      boxes: [{ dboxno: 4343784, dboxnum: '4-1-4343784', shippingFee: 0 }],
    });
  });

  it('throws when ordinfo count differs from items', async () => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/cjson_order`]: [ok({ resultMap: { cjson_order: { ordinfo: [{ ordnum: 'WP1' }] } } })],
    });

    await expect(client.order(BUNDLE_INPUT)).rejects.toBeInstanceOf(WowpressApiError);
  });

  it('does not fall back to root ordinfo when cjson_order lacks ordinfo', async () => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/cjson_order`]: [
        ok({ resultMap: { cjson_order: { dlvinfo: [{ dboxno: 1 }] }, ordinfo: [{ ordnum: 'WP1' }] } }),
      ],
    });

    await expect(client.order(ORDER_INPUT)).rejects.toBeInstanceOf(WowpressApiError);
  });

  it.each([[[]], ['bad']])('throws when cjson_order is not an object (%j)', async (bad) => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/cjson_order`]: [ok({ resultMap: { cjson_order: bad, ordinfo: [{ ordnum: 'WP1' }] } })],
    });

    await expect(client.order(ORDER_INPUT)).rejects.toBeInstanceOf(WowpressApiError);
  });

  it('throws when an ordinfo entry has no ordnum', async () => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/cjson_order`]: [ok({ resultMap: { cjson_order: { ordinfo: [{ ordnum: '' }] } } })],
    });

    await expect(client.order(ORDER_INPUT)).rejects.toThrow('ordnum missing in cjson_order response');
  });

  it('refuses to call when credentials are not configured', async () => {
    const { client, calls } = makeClient({}, {});

    await expect(client.cancel('WP1')).rejects.toBeInstanceOf(WowpressApiError);
    expect(calls).toHaveLength(0);
  });

  it('finds an order by ordkey in ord_list', async () => {
    const { client, calls } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/ord_list`]: [
        ok({
          resultMap: {
            ord_list: [
              { ordkey: 'other', ordnum: 'WP0' },
              { ordkey: 'k1', ordnum: 'WP1' },
            ],
          },
        }),
      ],
    });

    await expect(client.findByOrdkey('k1', new Date('2026-10-13T16:00:00Z'))).resolves.toEqual({
      ordnum: 'WP1',
      dboxnum: null,
    });
    expect(calls.find((c) => c.url.endsWith('/ord_list'))?.json).toMatchObject({
      stdt: '2026-10-14',
      ordkey: 'k1',
      validord: 'N',
      recordCountPerPage: 100,
    });
  });

  it('returns dboxnum from ord_list row', async () => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/ord_list`]: [
        ok({ resultMap: { ord_list: [{ ordkey: 'line-a', ordnum: 'WP1', dboxnum: '4-156-9410333' }] } }),
      ],
    });

    await expect(client.findByOrdkey('line-a', new Date())).resolves.toEqual({
      ordnum: 'WP1',
      dboxnum: '4-156-9410333',
    });
  });

  it('throws instead of returning null when the matching row has no readable ordnum', async () => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/ord_list`]: [ok({ resultMap: { ord_list: [{ ordkey: 'k1', ordnum: '' }] } })],
    });

    await expect(client.findByOrdkey('k1', new Date())).rejects.toThrow('ordnum missing for matching ordkey');
  });

  it('returns null when ord_list has no matching row', async () => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/ord_list`]: [ok({ resultMap: { list: [{ ordkey: 'other', ordnum: 'WP0' }] } })],
    });

    await expect(client.findByOrdkey('k1', new Date())).resolves.toBeNull();
  });

  it('treats a null or numeric ordkey as a present non-matching key', async () => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/ord_list`]: [
        ok({
          resultMap: {
            ord_list: [
              { ordkey: null, ordnum: 'WP0' },
              { ordkey: 7, ordnum: 'WP7' },
            ],
          },
        }),
      ],
    });

    await expect(client.findByOrdkey('k1', new Date())).resolves.toBeNull();
  });

  it('returns null for an empty recognized list', async () => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/ord_list`]: [ok({ resultMap: { ord_list: [] } })],
    });

    await expect(client.findByOrdkey('k1', new Date())).resolves.toBeNull();
  });

  it.each([
    ['no resultMap', {}],
    ['resultMap not an object', { resultMap: 'oops' }],
    ['neither ord_list nor list', { resultMap: { rows: [{ ordkey: 'k1', ordnum: 'WP1' }] } }],
    ['list not an array', { resultMap: { ord_list: { ordkey: 'k1', ordnum: 'WP1' } } }],
    ['row not an object', { resultMap: { list: ['k1'] } }],
    ['row without ordkey', { resultMap: { ord_list: [{ orderKey: 'k1', ordnum: 'WP1' }] } }],
    ['ordkey of another type', { resultMap: { ord_list: [{ ordkey: { v: 'k1' }, ordnum: 'WP1' }] } }],
    [
      'one bad row among good ones',
      { resultMap: { ord_list: [{ ordkey: 'other', ordnum: 'WP0' }, { ordnum: 'WP1' }] } },
    ],
  ])('throws on an unrecognized ord_list shape (%s)', async (_label, body) => {
    const { client } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/ord_list`]: [ok(body)],
    });

    await expect(client.findByOrdkey('k1', new Date())).rejects.toThrow('unrecognized ord_list');
  });

  describe('ordnum logging before validation', () => {
    let logSpy: jest.SpyInstance;
    beforeEach(() => {
      logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    });
    afterEach(() => logSpy.mockRestore());
    const logged = (): string => logSpy.mock.calls.map((c) => String(c[0])).join('\n');

    it('logs ordnums of a valid match and still throws on a malformed row', async () => {
      const { client } = makeClient({
        [`${API}/api/login/issue`]: [tokenOk('tok')],
        [`${API}/api/v1/ord/ord_list`]: [
          ok({ resultMap: { ord_list: [{ ordkey: 'k1', ordnum: 'WP-MATCH', name: '홍길동' }, { ordnum: 'WP-BAD' }] } }),
        ],
      });

      await expect(client.findByOrdkey('k1', new Date())).rejects.toThrow('unrecognized ord_list row');
      expect(logged()).toContain('WP-MATCH');
      expect(logged()).toContain('WP-BAD');
      expect(logged()).toContain('k1');
      expect(logged()).not.toContain('홍길동');
    });

    it('throws with both numbers when two different ordnums match the ordkey', async () => {
      const { client } = makeClient({
        [`${API}/api/login/issue`]: [tokenOk('tok')],
        [`${API}/api/v1/ord/ord_list`]: [
          ok({
            resultMap: {
              ord_list: [
                { ordkey: 'k1', ordnum: 'WP-A' },
                { ordkey: 'k1', ordnum: 'WP-B' },
              ],
            },
          }),
        ],
      });

      await expect(client.findByOrdkey('k1', new Date())).rejects.toThrow('multiple ordnums for ordkey: WP-A, WP-B');
    });

    it('logs the ordnum of a 401 body for cjson_order and for ord_list before any retry', async () => {
      const unauthorized =
        (ordnum: string): Handler =>
        () => ({
          status: 401,
          body: {
            resultCode: '401',
            resultMap: { ord_list: [{ ordkey: 'k1', ordnum }], cjson_order: { ordinfo: [{ ordnum }] } },
          },
        });
      const order = makeClient({
        [`${API}/api/login/issue`]: [tokenOk('tok')],
        [`${API}/api/v1/ord/cjson_order`]: [unauthorized('WP-401-ORDER')],
      });
      await expect(order.client.order(ORDER_INPUT)).rejects.toThrow('unauthorized');
      expect(logged()).toContain('WP-401-ORDER');

      const list = makeClient({
        [`${API}/api/login/issue`]: [tokenOk('tok')],
        [`${API}/api/v1/ord/ord_list`]: [unauthorized('WP-401-FIRST'), ok({ resultMap: { ord_list: [] } })],
      });
      await expect(list.client.findByOrdkey('k1', new Date())).resolves.toBeNull();
      expect(logged()).toContain('WP-401-FIRST');
    });

    it('logs the ordnum of a resultCode 500 cjson_order body before throwing', async () => {
      const { client } = makeClient({
        [`${API}/api/login/issue`]: [tokenOk('tok')],
        [`${API}/api/v1/ord/cjson_order`]: [
          () => ({
            status: 200,
            body: {
              resultCode: '500',
              errMsg: 'boom',
              resultMap: { cjson_order: { ordinfo: [{ ordnum: 'WP-LOST' }] } },
            },
          }),
        ],
      });

      await expect(client.order(ORDER_INPUT)).rejects.toThrow('boom');
      expect(logged()).toContain('WP-LOST');
      expect(logged()).toContain(ORDER_INPUT.items[0].ordkey);
    });
  });

  const detailOf = async (resultMap: unknown) => {
    const { client, calls } = makeClient({
      [`${API}/api/login/issue`]: [tokenOk('tok')],
      [`${API}/api/v1/ord/order/WP1`]: [ok({ resultMap })],
    });
    const detail = await client.detail('WP1');
    return { detail, calls };
  };

  it('reads tracking from ordinfo.dlvybox', async () => {
    const { detail, calls } = await detailOf({
      ordinfo: {
        ordstat: 80,
        jobstat: null,
        dlvybox: { dboxnum: '4-156-9410333', dlvyname: 'CJ대한통운', shipnum: '123456789012' },
      },
    });

    expect(detail).toEqual({
      ordstat: 80,
      jobstat: null,
      carrierCode: 156,
      trackingNumber: '123456789012',
      boxNumber: '4-156-9410333',
    });
    expect(calls.find((c) => c.url.endsWith('/order/WP1'))?.method).toBe('GET');
  });

  it.each([
    ['롯데택배', 109],
    ['CJ대한통운', 156],
    ['한진택배', null],
  ])('falls back to dlvyname when dboxnum has no carrier code (%s)', async (dlvyname, expected) => {
    const { detail } = await detailOf({
      ordinfo: { ordstat: 80, dlvybox: { dboxnum: null, dlvyname, shipnum: '1' } },
    });

    expect(detail.carrierCode).toBe(expected);
  });

  it.each([
    ['missing dlvybox', { ordinfo: { ordstat: 80 } }],
    ['null shipnum', { ordinfo: { ordstat: 80, dlvybox: { dboxnum: '4-156-1', shipnum: null } } }],
  ])('treats %s as no tracking', async (_label, resultMap) => {
    const { detail } = await detailOf(resultMap);

    expect(detail.trackingNumber).toBeNull();
  });

  it('accepts ordinfo as an array in detail', async () => {
    const { detail } = await detailOf({
      ordinfo: [{ ordstat: '80', jobstat: 30.0, dlvybox: { dboxnum: '4-109-5', shipnum: '999' } }],
    });

    expect(detail).toEqual({ ordstat: 80, jobstat: 30, carrierCode: 109, trackingNumber: '999', boxNumber: '4-109-5' });
  });

  it('parses detail from resultMap root with no delivery', async () => {
    const { detail } = await detailOf({ ordstat: 1 });

    expect(detail).toEqual({ ordstat: 1, jobstat: null, carrierCode: null, trackingNumber: null, boxNumber: null });
  });
});
