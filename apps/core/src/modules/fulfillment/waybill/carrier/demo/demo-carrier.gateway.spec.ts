import { CarrierError, type WaybillRequest } from '../carrier-gateway.interface';
import { DemoCarrierGateway, type DemoCarrierStore } from './demo-carrier.gateway';

const request: WaybillRequest = {
  custOrdNo: 'DEMO-ORDER-001',
  recipient: {
    name: '데모 고객',
    zip: '04532',
    baseAddress: '서울특별시 중구 세종대로 110',
    detailAddress: '1층',
    mobile: '010-0000-0000',
  },
  sender: { name: '아몬드영 데모 물류센터', zip: '14548', baseAddress: '경기도 부천시', detailAddress: 'A동' },
  items: [{ name: '데모 물류 상품 01', code: 'DEMO-SKU-001', quantity: 2 }],
  commodityName: '데모 물류 상품 01',
  boxType: 'A',
  payType: 'PP',
};

class MemoryStore implements DemoCarrierStore {
  records = new Map<
    string,
    { requestHash: string; waybillNo: string; labelData: Record<string, unknown>; status: string }
  >();

  allocate(input: { requestKey: string; requestHash: string; waybillNo: string; labelData: Record<string, unknown> }) {
    const current = this.records.get(input.requestKey);
    if (current) return Promise.resolve(current);
    const created = { ...input, status: 'allocated' };
    this.records.set(input.requestKey, created);
    return Promise.resolve(created);
  }

  register(waybillNo: string) {
    const found = [...this.records.values()].find((record) => record.waybillNo === waybillNo);
    if (!found) return Promise.resolve('missing' as const);
    if (found.status === 'registered') return Promise.resolve('already_registered' as const);
    found.status = 'registered';
    return Promise.resolve('registered' as const);
  }

  cancel(waybillNo: string) {
    const found = [...this.records.values()].find((record) => record.waybillNo === waybillNo);
    if (!found) return Promise.resolve(false);
    found.status = 'canceled';
    return Promise.resolve(true);
  }

  track(waybillNo: string) {
    const found = [...this.records.values()].find((record) => record.waybillNo === waybillNo);
    return Promise.resolve(found ? { status: found.status, updatedAt: new Date('2026-09-16T00:00:00.000Z') } : null);
  }
}

describe('DemoCarrierGateway', () => {
  it('replays allocation with the same printable numeric waybill and Hanjin-compatible label fields', async () => {
    const gateway = new DemoCarrierGateway(new MemoryStore(), () => new Date('2026-09-16T00:00:00.000Z'));

    const first = await gateway.allocate(request);
    const replay = await gateway.allocate(request);

    expect(replay).toEqual(first);
    expect(first.waybillNo).toMatch(/^9\d{11}$/);
    expect(first.labelData).toMatchObject({
      tml_cod: 'DEMO',
      cen_cod: 'DEMO01',
      es_nam: '시연용',
      prt_add: '서울특별시 중구 세종대로 110 1층',
      demo: true,
    });
  });

  it('rejects reuse of the same order key with a different request', async () => {
    const gateway = new DemoCarrierGateway(new MemoryStore());
    await gateway.allocate(request);

    await expect(
      gateway.allocate({ ...request, recipient: { ...request.recipient, zip: '06000' } }),
    ).rejects.toMatchObject<Partial<CarrierError>>({ outcome: 'definitive_rejection' });
  });

  it('persists register replay, tracking, and cancellation outcomes', async () => {
    const gateway = new DemoCarrierGateway(new MemoryStore(), () => new Date('2026-09-16T00:00:00.000Z'));
    const allocated = await gateway.allocate(request);

    expect(await gateway.register(allocated.waybillNo)).toEqual({ kind: 'registered' });
    expect(await gateway.register(allocated.waybillNo)).toEqual({ kind: 'already_registered' });
    expect(await gateway.track?.(allocated.waybillNo)).toEqual([
      expect.objectContaining({ statusCode: '11', status: 'in_transit', description: '시연용 택배 접수' }),
    ]);

    await gateway.cancel?.(allocated.waybillNo);
    expect(await gateway.track?.(allocated.waybillNo)).toEqual([
      expect.objectContaining({ statusCode: '03', status: 'canceled', description: '시연용 택배 취소' }),
    ]);
  });
});
