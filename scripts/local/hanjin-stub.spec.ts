import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { hanjinStubServer, trackingNumbers } from './hanjin-stub';
import { HanjinApiClient } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-api.client';
import { HanjinCarrierGateway } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway';
import { HanjinHmacSigner } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-hmac.signer';
import { loadHanjinConfig } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin.config';
import type { WaybillRequest } from '../../apps/core/src/modules/fulfillment/waybill/carrier/carrier-gateway.interface';

let server: Server;
let base: string;

beforeEach(async () => {
  server = hanjinStubServer(trackingNumbers(Date.UTC(2026, 10, 18, 0, 0, 0)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const PRINT = '/v1/wbl/LOCALSTUB/print-wbl';
const INSERT = '/parcel-delivery/v1/order/insert-order';

describe('가짜 한진 HTTP', () => {
  it('print-wbl 은 12자리 91… 번호와 분류 칸을 준다', async () => {
    const { json } = await post(PRINT, { msg_key: 'SO-1', rcv_zip: '04524', address: '서울 중구 세종대로 110' });
    expect(json.result_code).toBe('OK');
    expect(String(json.wbl_num)).toMatch(/^91\d{10}$/);
    expect(json.tml_cod).toBe('421');
    expect(json.zip_cod).toBe('04524');
  });

  it('같은 msg_key 로 다시 받으면 같은 번호를 준다', async () => {
    const a = await post(PRINT, { msg_key: 'SO-1' });
    const b = await post(PRINT, { msg_key: 'SO-1' });
    expect(b.json.wbl_num).toBe(a.json.wbl_num);
  });

  it('다른 msg_key 면 다른 번호를 준다', async () => {
    const a = await post(PRINT, { msg_key: 'SO-1' });
    const b = await post(PRINT, { msg_key: 'SO-2' });
    expect(b.json.wbl_num).not.toBe(a.json.wbl_num);
  });

  it('insert-order 출고는 첫 번째 OK, 같은 custOrdNo 두 번째는 ERROR-09', async () => {
    const first = await post(INSERT, { svcCatCd: 'S', custOrdNo: 'SO-1', wblNo: '910000000001' });
    const second = await post(INSERT, { svcCatCd: 'S', custOrdNo: 'SO-1', wblNo: '910000000001' });
    expect(first.json.resultCode).toBe('OK');
    expect(second.json.resultCode).toBe('ERROR-09');
  });

  it('insert-order 회수(svcCatCd R)는 OK + wblNo', async () => {
    const { json } = await post(INSERT, { svcCatCd: 'R', custOrdNo: 'RT-1' });
    expect(json.resultCode).toBe('OK');
    expect(String(json.wblNo)).toMatch(/^91\d{10}$/);
  });

  it('tracking-wbl 은 ERROR-01', async () => {
    const { json } = await post('/parcel-delivery/v1/tracking/tracking-wbl', { wblNo: '910000000001' });
    expect(json.resultCode).toBe('ERROR-01');
  });

  it('모르는 경로는 404', async () => {
    const { status } = await post('/nope', {});
    expect(status).toBe(404);
  });
});

describe('HanjinCarrierGateway 가 스텁을 읽는다', () => {
  function gateway(): HanjinCarrierGateway {
    const config = loadHanjinConfig({
      HANJIN_CLIENT_ID: 'LOCALSTUB',
      HANJIN_API_KEY: 'local-stub',
      HANJIN_SECRET_KEY: 'local-stub',
      HANJIN_CONTRACT_NO: '0000000',
      HANJIN_ORDER_BASE_URL: base,
      HANJIN_PRINT_BASE_URL: base,
      HANJIN_SENDER_NAME: '로컬 발송인',
      HANJIN_SENDER_ZIP: '00000',
      HANJIN_SENDER_BASE_ADDR: '로컬 발송 주소',
      HANJIN_SENDER_DTL_ADDR: '1층',
      HANJIN_SENDER_TEL: '01000000000',
      HANJIN_BOX_TYPE: 'A',
      HANJIN_PAY_TYPE: 'PP',
    });
    const signer = new HanjinHmacSigner({
      clientId: config.clientId,
      apiKey: config.apiKey,
      secretKey: config.secretKey,
    });
    return new HanjinCarrierGateway(config, new HanjinApiClient(config, signer), () => new Date(), {
      acquire: () => Promise.resolve(),
    });
  }

  const req: WaybillRequest = {
    custOrdNo: 'SO-1',
    recipient: {
      name: '김택배',
      zip: '04524',
      baseAddress: '서울 중구 세종대로 110',
      detailAddress: 'E2E 1',
      tel: '01000000001',
      mobile: '01000000001',
    },
    sender: {
      name: '로컬 발송인',
      zip: '00000',
      baseAddress: '로컬 발송 주소',
      detailAddress: '1층',
      tel: '01000000000',
    },
    items: [{ name: '[E2E] 상품', code: 'P00001', quantity: 1 }],
    commodityName: '[E2E] 상품',
    boxType: 'A',
    payType: 'PP',
  };

  it('allocate → waybillNo 12자리, labelData.tml_cod 421', async () => {
    const { waybillNo, labelData } = await gateway().allocate(req);
    expect(waybillNo).toMatch(/^91\d{10}$/);
    expect(labelData.tml_cod).toBe('421');
  });

  it('register 두 번 → registered 다음 already_registered', async () => {
    const g = gateway();
    expect(await g.register('910000000001', req)).toEqual({ kind: 'registered' });
    expect(await g.register('910000000001', req)).toEqual({ kind: 'already_registered' });
  });

  it('track → 빈 이력', async () => {
    expect(await gateway().track('910000000001')).toEqual([]);
  });
});
