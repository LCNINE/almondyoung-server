import { Logger } from '@nestjs/common';
import { OrderFactsService } from './order-facts.service';

const envelope = {
  messageId: '01J00000000000000000000020',
  messageType: 'OrderCancelled',
  messageVersion: 1,
  messageKind: 'event',
  correlationId: '01J00000000000000000000021',
  timestamp: '2026-07-15T01:00:00.000Z',
  source: { service: 'channel-adapter', aggregateType: 'Order', aggregateId: 'order-20' },
  payload: {},
};

const payload = {
  orderId: 'order-20',
  reason: 'CUSTOMER_REQUEST',
  cancelledBy: 'admin',
  cancelledAt: '2026-07-15T01:00:00.000Z',
  refundRequired: false,
};

function makeService(originalRows: unknown[], claimed = true) {
  const executor = {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue(claimed ? [{ messageId: envelope.messageId }] : []),
        }),
      }),
    }),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(originalRows),
      }),
    }),
  };
  const dbService = { db: { transaction: jest.fn((fn: (e: unknown) => unknown) => fn(executor)) } };
  return new OrderFactsService(dbService as never);
}

describe('OrderFactsService.recordOrderCancelled', () => {
  it('원본이 없으면 orphan 으로 표시하고 차감액을 만들지 않는다', async () => {
    const service = makeService([]);

    const result = await service.recordOrderCancelled(envelope as never, payload as never);

    expect(result.orphan).toBe(true);
    expect(result.totalAmount).toBe(0);
    expect(result.masterAmounts).toEqual([]);
  });

  it('원본 라인 금액을 상품별로 합쳐 차감액을 만든다', async () => {
    const service = makeService([
      { masterId: 'm1', salesChannel: 'naver', orderItemId: 'line-1', quantity: 1, totalPrice: 2000 },
      { masterId: 'm1', salesChannel: 'naver', orderItemId: 'line-2', quantity: 1, totalPrice: 1000 },
      { masterId: 'm2', salesChannel: 'naver', orderItemId: 'line-3', quantity: 1, totalPrice: 500 },
    ]);

    const result = await service.recordOrderCancelled(envelope as never, payload as never);

    expect(result.orphan).toBe(false);
    expect(result.salesChannel).toBe('naver');
    expect(result.totalAmount).toBe(3500);
    expect(result.masterAmounts).toContainEqual({ masterId: 'm1', amount: 3000 });
    expect(result.masterAmounts).toContainEqual({ masterId: 'm2', amount: 500 });
  });

  it('취소 일자도 KST 기준이다 — UTC 로 전날 15:30 인 취소는 다음 날 버킷에 들어간다', async () => {
    // Same KST boundary as the OrderCreated path (order-facts.service.spec.ts). Both
    // writers must agree: a cancellation bucketed a day off from its aggregate siblings
    // would make the daily net-revenue series wrong on both days.
    const service = makeService([{ masterId: 'm1', salesChannel: 'naver', totalPrice: 2000 }]);

    const result = await service.recordOrderCancelled(
      envelope as never,
      {
        ...payload,
        cancelledAt: '2026-07-31T15:30:00.000Z',
      } as never,
    );

    expect(result.occurredDate).toBe('2026-08-01');
  });

  it('중복 메시지면 claimed=false 이고 조회하지 않는다', async () => {
    const service = makeService(
      [{ masterId: 'm1', salesChannel: 'naver', orderItemId: 'line-1', quantity: 1, totalPrice: 2000 }],
      false,
    );

    const result = await service.recordOrderCancelled(envelope as never, payload as never);

    expect(result.claimed).toBe(false);
    expect(result.totalAmount).toBe(0);
  });
});

describe('OrderFactsService.recordOrderCancelled — 부분 취소 (stockRestorationResults)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // A 3-line order. Only `line-2` is cancelled in the partial cases below.
  const threeLines = [
    { masterId: 'm1', salesChannel: 'naver', orderItemId: 'line-1', quantity: 2, totalPrice: 2000 },
    { masterId: 'm2', salesChannel: 'naver', orderItemId: 'line-2', quantity: 3, totalPrice: 3000 },
    { masterId: 'm3', salesChannel: 'naver', orderItemId: 'line-3', quantity: 1, totalPrice: 500 },
  ];

  it('복원된 라인만 차감한다 — 나머지 라인은 손대지 않는다', async () => {
    // The regression this guards: summing every fact row for the order regardless of what
    // was actually cancelled. Under that behaviour totalAmount would be 5500 (the whole
    // order) instead of 3000, overstating cancellations by the two untouched lines and
    // dragging that day's net revenue below the truth.
    const service = makeService(threeLines);

    const result = await service.recordOrderCancelled(
      envelope as never,
      {
        ...payload,
        stockRestorationResults: [{ orderItemId: 'line-2', skuId: 'sku-2', restoredQty: 3 }],
      } as never,
    );

    expect(result.totalAmount).toBe(3000);
    expect(result.masterAmounts).toEqual([{ masterId: 'm2', amount: 3000 }]);
  });

  it('라인 일부 수량만 복원되면 수량 비례로 깎는다', async () => {
    // line-2 is 3 units for 3000; restoring 1 unit cancels 1000, not 3000.
    const service = makeService(threeLines);

    const result = await service.recordOrderCancelled(
      envelope as never,
      {
        ...payload,
        stockRestorationResults: [{ orderItemId: 'line-2', skuId: 'sku-2', restoredQty: 1 }],
      } as never,
    );

    expect(result.totalAmount).toBe(1000);
    expect(result.masterAmounts).toEqual([{ masterId: 'm2', amount: 1000 }]);
  });

  it('복원수량이 주문수량보다 크면 라인 금액까지만 깎는다 (클램프)', async () => {
    // Duplicate/over-reported restoration must not deduct more than the line was worth.
    const service = makeService(threeLines);

    const result = await service.recordOrderCancelled(
      envelope as never,
      {
        ...payload,
        stockRestorationResults: [{ orderItemId: 'line-2', skuId: 'sku-2', restoredQty: 99 }],
      } as never,
    );

    expect(result.totalAmount).toBe(3000);
  });

  it('모든 라인이 복원되면 전량 차감과 같아진다', async () => {
    const service = makeService(threeLines);

    const result = await service.recordOrderCancelled(
      envelope as never,
      {
        ...payload,
        stockRestorationResults: [
          { orderItemId: 'line-1', skuId: 'sku-1', restoredQty: 2 },
          { orderItemId: 'line-2', skuId: 'sku-2', restoredQty: 3 },
          { orderItemId: 'line-3', skuId: 'sku-3', restoredQty: 1 },
        ],
      } as never,
    );

    expect(result.totalAmount).toBe(5500);
    expect(result.masterAmounts).toHaveLength(3);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('stockRestorationResults 가 없으면 예전대로 전량 차감한다 (외부 채널 이벤트)', async () => {
    // Naver/Coupang cancellations carry no line detail. Falling back to the full sum keeps
    // the previous behaviour rather than silently deducting nothing.
    const service = makeService(threeLines);

    const result = await service.recordOrderCancelled(envelope as never, payload as never);

    expect(result.totalAmount).toBe(5500);
    expect(result.masterAmounts).toHaveLength(3);
  });

  it('빈 배열도 정보 없음으로 보고 전량 차감한다', async () => {
    const service = makeService(threeLines);

    const result = await service.recordOrderCancelled(
      envelope as never,
      {
        ...payload,
        stockRestorationResults: [],
      } as never,
    );

    expect(result.totalAmount).toBe(5500);
  });

  it('라인 수가 다르면 경고를 남긴다 (조용히 넘어가지 않는다)', async () => {
    const service = makeService(threeLines);

    await service.recordOrderCancelled(
      envelope as never,
      {
        ...payload,
        stockRestorationResults: [{ orderItemId: 'line-2', skuId: 'sku-2', restoredQty: 3 }],
      } as never,
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('취소 라인 수가 fact 라인 수와 다르다'));
  });

  it('한 라인도 매칭되지 않으면 전량 차감으로 되돌리고 경고한다', async () => {
    // `OrderItem.orderItemId` is optional in the contract, so an order ingested without it
    // has null orderItemId on every fact row. Scoping would then match nothing and deduct
    // 0 — the cancellation would vanish. Falling back to the full sum is the safe read of
    // "we have line detail but cannot line it up".
    const service = makeService([
      { masterId: 'm1', salesChannel: 'naver', orderItemId: null, quantity: 2, totalPrice: 2000 },
      { masterId: 'm2', salesChannel: 'naver', orderItemId: null, quantity: 1, totalPrice: 500 },
    ]);

    const result = await service.recordOrderCancelled(
      envelope as never,
      {
        ...payload,
        stockRestorationResults: [{ orderItemId: 'line-2', skuId: 'sku-2', restoredQty: 3 }],
      } as never,
    );

    expect(result.totalAmount).toBe(2500);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('하나도 매칭되지 않아 전량 차감으로 대체'));
  });
});
