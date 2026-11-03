import { CONSOLIDATION_RECOVERY_CODE } from './consolidation-recovery';
import { foConsolidationState, loadFoConsolidations } from './fo-consolidation-labels';

const box = (patch: Partial<{ status: string; recoveryCode: string | null; orderNos: string[] }> = {}) => ({
  status: 'draft',
  recoveryCode: null,
  orderNos: ['A-1'],
  ...patch,
});

describe('foConsolidationState', () => {
  it('아무 단서도 없으면 none 이다', () => {
    expect(foConsolidationState({ ownOrderNos: ['A-1'], boxes: [box()], mergeableOrderNos: [] })).toEqual({
      state: 'none',
      partnerOrderNos: [],
    });
  });

  it('합칠 수 있는 주문이 있으면 mergeable 이고 파트너 3건을 전부 담는다', () => {
    expect(
      foConsolidationState({
        ownOrderNos: ['A-1'],
        boxes: [box()],
        mergeableOrderNos: ['A-1', 'B-2', 'C-3', 'D-4'],
      }),
    ).toEqual({ state: 'mergeable', partnerOrderNos: ['B-2', 'C-3', 'D-4'] });
  });

  it('열린 상자에 주문이 2건 이상이면 merged 이고 mergeable 보다 앞선다', () => {
    expect(
      foConsolidationState({
        ownOrderNos: ['A-1'],
        boxes: [box({ orderNos: ['A-1', 'B-2'] })],
        mergeableOrderNos: ['C-3'],
      }),
    ).toEqual({ state: 'merged', partnerOrderNos: ['B-2'] });
  });

  it('합치는 중 복구 코드는 merged 보다 앞선다', () => {
    expect(
      foConsolidationState({
        ownOrderNos: ['A-1'],
        boxes: [
          box({ orderNos: ['A-1', 'B-2'] }),
          box({ status: 'recovery_required', recoveryCode: CONSOLIDATION_RECOVERY_CODE, orderNos: ['A-1', 'C-3'] }),
        ],
        mergeableOrderNos: [],
      }),
    ).toEqual({ state: 'merging', partnerOrderNos: ['C-3'] });
  });

  it('회수 대기 복구 코드는 merging 이 아니다', () => {
    expect(
      foConsolidationState({
        ownOrderNos: ['A-1'],
        boxes: [box({ status: 'recovery_required', recoveryCode: 'DISPATCH_RECALL_PENDING' })],
        mergeableOrderNos: [],
      }).state,
    ).toBe('none');
  });

  it('superseded 상자는 무시한다', () => {
    expect(
      foConsolidationState({
        ownOrderNos: ['A-1'],
        boxes: [
          box({ status: 'superseded', recoveryCode: CONSOLIDATION_RECOVERY_CODE, orderNos: ['A-1', 'B-2'] }),
          box({ status: 'superseded', orderNos: ['A-1', 'C-3'] }),
        ],
        mergeableOrderNos: [],
      }),
    ).toEqual({ state: 'none', partnerOrderNos: [] });
  });
});

describe('loadFoConsolidations 조회 횟수', () => {
  function countingDb(pairCount: number, later: unknown[][] = []) {
    let queries = 0;
    const answers: unknown[][] = [
      Array.from({ length: pairCount }, (_, index) => ({ foId: `fo-${index}`, shipmentId: `sh-${index}` })),
      ...later,
    ];

    const query = () => {
      const result = answers[queries] ?? [];

      queries += 1;

      const chain: Record<string, unknown> = {};

      for (const name of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) {
        chain[name] = jest.fn(() => chain);
      }

      chain.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve);

      return chain;
    };

    const db: any = { select: jest.fn(query) };

    return { db, count: () => queries };
  }

  const targets = (size: number) =>
    Array.from({ length: size }, (_, index) => ({
      id: `fo-${index}`,
      salesOrderId: `so-${index}`,
      warehouseId: 'wh-1',
    }));

  it('행이 1개든 20개든 조회 횟수가 같다', async () => {
    const one = countingDb(1);
    const many = countingDb(20);

    await loadFoConsolidations(one.db, targets(1));
    await loadFoConsolidations(many.db, targets(20));

    expect(many.count()).toBe(one.count());
    expect(many.count()).toBeLessThanOrEqual(6);
  });

  it('행이 없으면 조회하지 않는다', async () => {
    const empty = countingDb(0);

    await expect(loadFoConsolidations(empty.db, [])).resolves.toEqual(new Map());
    expect(empty.count()).toBe(0);
  });

  it('같은 고객 같은 주소의 다른 주문 상자를 mergeable 로 판정하고 수령인은 싣지 않는다', async () => {
    const recipient = {
      recipientName: '김알몬',
      phone: '010-1234-5678',
      postalCode: '14500',
      roadAddress: '경기 부천시 원미로 12',
      detailAddress: '101호',
    };
    const shipment = (id: string, warehouseId = 'wh-1') => ({
      id,
      warehouseId,
      shippingProfileId: 'profile-1',
      status: 'draft',
      supplierId: null,
      recoveryCode: null,
      recipientSnapshot: recipient,
      manifestVersion: 1,
      reservationVersion: 1,
      createdAt: new Date('2026-11-01T00:00:00Z'),
    });
    const line = (shipmentId: string, salesOrderId: string, displayOrderNo: string) => ({
      shipmentId,
      qty: 1,
      salesOrderId,
      fulfillmentMode: 'in_house',
      skuStockType: 'stocked',
      skuName: '상품',
      customerId: 'c1',
      customerName: '김알몬',
      customerPhone: '01012345678',
      displayOrderNo,
      channelOrderId: null,
      salesChannel: 'medusa',
      salesOrderCreatedAt: new Date('2026-11-01T00:00:00Z'),
    });
    const fake = countingDb(1, [
      [{ customerId: 'c1', phone: '01012345678' }],
      [{ shipmentId: 'sh-other' }],
      [shipment('sh-0'), shipment('sh-other')],
      [line('sh-0', 'so-0', 'A-1'), line('sh-other', 'so-x', 'B-2')],
      [],
      [],
    ]);

    const result = await loadFoConsolidations(fake.db, targets(1));

    expect(result.get('fo-0')).toEqual({ state: 'mergeable', partnerOrderNos: ['B-2'] });
    expect(JSON.stringify([...result.values()])).not.toContain('김알몬');
  });

  it('다른 창고의 같은 고객 같은 주소 상자는 mergeable 이 아니다', async () => {
    const recipient = {
      recipientName: '김알몬',
      phone: '010-1234-5678',
      postalCode: '14500',
      roadAddress: '경기 부천시 원미로 12',
      detailAddress: '101호',
    };
    const shipment = (id: string, warehouseId: string) => ({
      id,
      warehouseId,
      shippingProfileId: 'profile-1',
      status: 'draft',
      supplierId: null,
      recoveryCode: null,
      recipientSnapshot: recipient,
      manifestVersion: 1,
      reservationVersion: 1,
      createdAt: new Date('2026-11-01T00:00:00Z'),
    });
    const line = (shipmentId: string, salesOrderId: string, displayOrderNo: string) => ({
      shipmentId,
      qty: 1,
      salesOrderId,
      fulfillmentMode: 'in_house',
      skuStockType: 'stocked',
      skuName: '상품',
      customerId: 'c1',
      customerName: '김알몬',
      customerPhone: '01012345678',
      displayOrderNo,
      channelOrderId: null,
      salesChannel: 'medusa',
      salesOrderCreatedAt: new Date('2026-11-01T00:00:00Z'),
    });
    const fake = countingDb(1, [
      [{ customerId: 'c1', phone: '01012345678' }],
      [{ shipmentId: 'sh-other' }],
      [shipment('sh-0', 'wh-1'), shipment('sh-other', 'wh-2')],
      [line('sh-0', 'so-0', 'A-1'), line('sh-other', 'so-x', 'B-2')],
    ]);

    const result = await loadFoConsolidations(fake.db, targets(1));

    expect(result.get('fo-0')).toEqual({ state: 'none', partnerOrderNos: [] });
  });
});
