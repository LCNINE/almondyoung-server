import { judgeBox, pickExistingMaster, recipientFor, stockTopUpDelta, type ShipmentView } from './plan';

const BUCHEON = '019d0001-0001-7000-a000-000000000001';

describe('pickExistingMaster', () => {
  const row = (name: string, status: string, n: string) => ({
    masterId: `m${n}`,
    versionId: `v${n}`,
    name,
    status,
  });

  it('부분일치하는 다른 이름은 고르지 않는다', () => {
    expect(pickExistingMaster([row('[E2E] 주문 경로 옵션 2', 'active', '1')], '[E2E] 주문 경로 옵션')).toBeNull();
  });

  it('같은 이름의 초안과 발행본이 있으면 발행본을 고른다', () => {
    const picked = pickExistingMaster(
      [row('[E2E] 주문 경로 단일', 'draft', '1'), row('[E2E] 주문 경로 단일', 'active', '2')],
      '[E2E] 주문 경로 단일',
    );
    expect(picked).toEqual({ masterId: 'm2', versionId: 'v2', published: true });
  });

  it('초안만 있으면 그 초안을 이어서 쓴다', () => {
    expect(pickExistingMaster([row('[E2E] 주문 경로 단일', 'draft', '1')], '[E2E] 주문 경로 단일')).toEqual({
      masterId: 'm1',
      versionId: 'v1',
      published: false,
    });
  });
});

describe('stockTopUpDelta', () => {
  it.each([
    [100, 100, 0],
    [37, 100, 63],
    [120, 100, 0],
    [null, 100, 100],
  ])('가용 %p, 목표 %p → %p', (available, target, expected) => {
    expect(stockTopUpDelta(available, target)).toBe(expected);
  });
});

describe('recipientFor', () => {
  it('같은 실행의 다른 순번은 상세주소가 다르다', () => {
    expect(recipientFor('s1', 1).address2).not.toBe(recipientFor('s1', 2).address2);
  });

  it('다른 실행의 같은 순번도 상세주소가 다르다', () => {
    expect(recipientFor('s1', 1).address2).not.toBe(recipientFor('s2', 1).address2);
  });

  it('우편번호는 다섯 자리다', () => {
    expect(recipientFor('s1', 1).postalCode).toMatch(/^\d{5}$/);
  });
});

describe('judgeBox', () => {
  const box = (over: Partial<ShipmentView> = {}): ShipmentView => ({
    id: 'sh1',
    status: 'draft',
    warehouseId: BUCHEON,
    totalQty: 1,
    reservedQty: 1,
    ...over,
  });
  const base = { salesOrderId: 'so1', quarantined: false, unmatchedLines: 0, fulfillmentOrderId: 'fo1' };

  it('주문이 없고 격리돼 있으면 quarantined', () => {
    expect(
      judgeBox({ ...base, salesOrderId: null, quarantined: true, fulfillmentOrderId: null, shipments: [] }, BUCHEON),
    ).toEqual({ kind: 'waiting', stage: 'quarantined' });
  });

  it('주문이 없고 격리도 아니면 no_sales_order', () => {
    expect(judgeBox({ ...base, salesOrderId: null, fulfillmentOrderId: null, shipments: [] }, BUCHEON)).toEqual({
      kind: 'waiting',
      stage: 'no_sales_order',
    });
  });

  it('매칭 안 된 라인이 있으면 matching_pending', () => {
    expect(judgeBox({ ...base, unmatchedLines: 1, fulfillmentOrderId: null, shipments: [] }, BUCHEON)).toEqual({
      kind: 'waiting',
      stage: 'matching_pending',
    });
  });

  it('출고 주문이 없으면 no_fulfillment_order', () => {
    expect(judgeBox({ ...base, fulfillmentOrderId: null, shipments: [] }, BUCHEON)).toEqual({
      kind: 'waiting',
      stage: 'no_fulfillment_order',
    });
  });

  it('상자가 없으면 no_shipment', () => {
    expect(judgeBox({ ...base, shipments: [] }, BUCHEON)).toEqual({ kind: 'waiting', stage: 'no_shipment' });
  });

  it('상자 둘이 모두 부천 draft 이고 다 예약됐으면 ready', () => {
    expect(judgeBox({ ...base, shipments: [box(), box({ id: 'sh2', totalQty: 2, reservedQty: 2 })] }, BUCHEON)).toEqual(
      { kind: 'ready', shipmentIds: ['sh1', 'sh2'] },
    );
  });

  it('하나라도 덜 예약됐으면 not_reserved', () => {
    expect(judgeBox({ ...base, shipments: [box(), box({ id: 'sh2', totalQty: 2, reservedQty: 1 })] }, BUCHEON)).toEqual(
      { kind: 'waiting', stage: 'not_reserved' },
    );
  });

  it('다른 창고 상자면 wrong_warehouse', () => {
    expect(judgeBox({ ...base, shipments: [box({ warehouseId: 'other' })] }, BUCHEON)).toEqual({
      kind: 'waiting',
      stage: 'wrong_warehouse',
    });
  });
});
