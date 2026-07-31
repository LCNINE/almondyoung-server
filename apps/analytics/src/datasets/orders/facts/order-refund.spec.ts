import { Logger } from '@nestjs/common';
import { factOrderEvents, factOrderItems } from '../../../schema';
import { OrderFactsService } from './order-facts.service';

const envelope = {
  messageId: '01J00000000000000000000030',
  messageType: 'OrderRefundCreated',
  messageVersion: 1,
  messageKind: 'event',
  correlationId: '01J00000000000000000000031',
  timestamp: '2026-07-16T01:00:00.000Z',
  source: { service: 'wallet', aggregateType: 'Order', aggregateId: 'order-30' },
  payload: {},
};

const payload = {
  orderId: 'order-30',
  refundId: 'refund-1',
  paymentId: 'payment-1',
  amount: 1500,
  currency: 'KRW',
  reason: 'CUSTOMER_REQUEST',
  createdBy: 'admin',
  createdAt: '2026-07-16T01:00:00.000Z',
};

/**
 * `recordOrderRefund` issues up to two SELECTs against *different* tables — the
 * `fact_order_events` cancellation probe first, then the `fact_order_items` original lookup.
 * The mock therefore dispatches on the table handed to `.from()` rather than on call order,
 * so a test can vary one without disturbing the other (and so a regression that swaps the
 * two queries' targets shows up as the wrong rows coming back, not as a silent pass).
 */
function makeService(
  options: {
    originalRows?: unknown[];
    cancellationRows?: unknown[];
    claimed?: boolean;
  } = {},
) {
  const {
    originalRows = [{ masterId: 'm1', salesChannel: 'coupang', totalPrice: 1500 }],
    cancellationRows = [],
    claimed = true,
  } = options;

  const executor = {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue(claimed ? [{ messageId: envelope.messageId }] : []),
        }),
      }),
    }),
    select: jest.fn().mockReturnValue({
      from: jest.fn((table: unknown) => {
        if (table === factOrderEvents) {
          return { where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(cancellationRows) }) };
        }
        if (table === factOrderItems) {
          return { where: jest.fn().mockResolvedValue(originalRows) };
        }
        throw new Error('Unexpected analytics table');
      }),
    }),
  };
  const dbService = { db: { transaction: jest.fn((fn: (e: unknown) => unknown) => fn(executor)) } };
  return { service: new OrderFactsService(dbService as never), executor };
}

let warnSpy: jest.SpyInstance;
let debugSpy: jest.SpyInstance;

beforeEach(() => {
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  debugSpy.mockRestore();
});

describe('OrderFactsService.recordOrderRefund', () => {
  it('원본에서 채널을 찾아 반환한다', async () => {
    const { service } = makeService();

    const result = await service.recordOrderRefund(envelope as never, payload as never);

    expect(result.claimed).toBe(true);
    expect(result.orphan).toBe(false);
    expect(result.supersededByCancellation).toBe(false);
    expect(result.salesChannel).toBe('coupang');
    expect(result.occurredDate).toBe('2026-07-16');
  });

  it('원본이 없으면 orphan 이다', async () => {
    const { service } = makeService({ originalRows: [] });

    const result = await service.recordOrderRefund(envelope as never, payload as never);

    expect(result.orphan).toBe(true);
    expect(result.salesChannel).toBeNull();
  });

  it('중복 메시지면 claimed=false 이고 조회하지 않는다', async () => {
    // originalRows/cancellationRows are deliberately left at values that would change the
    // outcome if the SELECTs ran (mirroring order-cancellation.spec.ts's equivalent test):
    // proving `select` was never touched is the only way to pin the gate order —
    // insert-then-check-then-select, never select-before-check.
    const { service, executor } = makeService({ claimed: false });

    const result = await service.recordOrderRefund(envelope as never, payload as never);

    expect(result.claimed).toBe(false);
    expect(result.orphan).toBe(false);
    expect(result.supersededByCancellation).toBe(false);
    expect(result.salesChannel).toBeNull();
    expect(executor.select).not.toHaveBeenCalled();
  });

  it('환불 일자도 KST 기준이다', async () => {
    const { service } = makeService();

    const result = await service.recordOrderRefund(
      envelope as never,
      {
        ...payload,
        createdAt: '2026-07-31T15:30:00.000Z',
      } as never,
    );

    expect(result.occurredDate).toBe('2026-08-01');
  });
});

describe('OrderFactsService.recordOrderRefund — 취소 봉투 선점 시 건너뛰기', () => {
  it('같은 주문의 OrderCancelled 봉투가 이미 있으면 집계 반영을 건너뛴다', async () => {
    // The double-deduction this guards: Medusa emits OrderCancelled *and* a per-refund
    // OrderRefundCreated for the same order. The cancellation path reads the full original
    // line total into cancelledAmount; the refund path adds payload.amount into
    // refundedAmount. For a fully-refunded cancellation both are the same money, making
    // net = gross - cancelled - refunded = gross - 2×gross.
    //
    // originalRows is deliberately non-empty so this isolates the supersession guard from
    // the orphan guard — with a live salesChannel available, nothing else would stop the
    // aggregate write if the guard were removed.
    const { service } = makeService({
      cancellationRows: [{ messageId: '01J00000000000000000000020' }],
      originalRows: [{ masterId: 'm1', salesChannel: 'coupang', totalPrice: 1500 }],
    });

    const result = await service.recordOrderRefund(envelope as never, payload as never);

    expect(result.claimed).toBe(true);
    expect(result.supersededByCancellation).toBe(true);
    expect(result.salesChannel).toBeNull();
    expect(result.orphan).toBe(false);
  });

  it('건너뛸 때 조용히 지나가지 않고 warn 을 남긴다', async () => {
    const { service } = makeService({ cancellationRows: [{ messageId: '01J00000000000000000000020' }] });

    await service.recordOrderRefund(envelope as never, payload as never);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('취소된 주문의 환불'));
  });

  it('취소 봉투가 없으면 정상 처리한다 (가드가 상시 참이 아님)', async () => {
    const { service } = makeService({ cancellationRows: [] });

    const result = await service.recordOrderRefund(envelope as never, payload as never);

    expect(result.supersededByCancellation).toBe(false);
    expect(result.salesChannel).toBe('coupang');
  });
});

describe('OrderFactsService.recordOrderRefund — 상품별 환불 배분', () => {
  it('환불액을 라인 금액 비례로 배분하고 합이 payload.amount 와 정확히 같다', async () => {
    // Order: m1 = 6000, m2 = 4000 (total 10000). A 1000 refund splits 600 / 400.
    // Getting the *sum* right is the point: agg_channel_daily receives payload.amount
    // verbatim, so any allocation whose sum differs makes the product-level and
    // channel-level refund totals disagree — the exact discrepancy this writer removes.
    const { service } = makeService({
      originalRows: [
        { masterId: 'm1', salesChannel: 'coupang', totalPrice: 6000 },
        { masterId: 'm2', salesChannel: 'coupang', totalPrice: 4000 },
      ],
    });

    const result = await service.recordOrderRefund(envelope as never, { ...payload, amount: 1000 } as never);

    expect(result.masterAmounts).toEqual([
      { masterId: 'm1', amount: 600 },
      { masterId: 'm2', amount: 400 },
    ]);
    expect(result.masterAmounts.reduce((sum, a) => sum + a.amount, 0)).toBe(1000);
  });

  it('같은 master 의 여러 라인은 합쳐서 한 몫으로 배분한다', async () => {
    const { service } = makeService({
      originalRows: [
        { masterId: 'm1', salesChannel: 'coupang', totalPrice: 3000 },
        { masterId: 'm1', salesChannel: 'coupang', totalPrice: 3000 },
        { masterId: 'm2', salesChannel: 'coupang', totalPrice: 4000 },
      ],
    });

    const result = await service.recordOrderRefund(envelope as never, { ...payload, amount: 1000 } as never);

    expect(result.masterAmounts).toEqual([
      { masterId: 'm1', amount: 600 },
      { masterId: 'm2', amount: 400 },
    ]);
  });

  it('나누어떨어지지 않아도 합이 정확히 보존된다 (나머지 배분)', async () => {
    // 3 equal masters, 100 won: 33.33 each. Floor gives 33/33/33 = 99, and the leftover 1
    // goes to the largest remainder (a tie here, broken deterministically by masterId).
    // A naive Math.round per master would give 33+33+33 = 99 and lose a won every time.
    const { service } = makeService({
      originalRows: [
        { masterId: 'm-a', salesChannel: 'coupang', totalPrice: 1000 },
        { masterId: 'm-b', salesChannel: 'coupang', totalPrice: 1000 },
        { masterId: 'm-c', salesChannel: 'coupang', totalPrice: 1000 },
      ],
    });

    const result = await service.recordOrderRefund(envelope as never, { ...payload, amount: 100 } as never);

    expect(result.masterAmounts.reduce((sum, a) => sum + a.amount, 0)).toBe(100);
    expect(result.masterAmounts).toEqual([
      { masterId: 'm-a', amount: 34 },
      { masterId: 'm-b', amount: 33 },
      { masterId: 'm-c', amount: 33 },
    ]);
  });

  it('배분 결과가 0 인 master 는 행을 만들지 않는다', async () => {
    // m2's share of a 1-won refund rounds to 0 — writing a zero row would create an
    // agg_product_order_daily row that says nothing.
    const { service } = makeService({
      originalRows: [
        { masterId: 'm1', salesChannel: 'coupang', totalPrice: 999_000 },
        { masterId: 'm2', salesChannel: 'coupang', totalPrice: 1_000 },
      ],
    });

    const result = await service.recordOrderRefund(envelope as never, { ...payload, amount: 1 } as never);

    expect(result.masterAmounts).toEqual([{ masterId: 'm1', amount: 1 }]);
  });

  it('라인 금액이 전부 0 이면 상품 배분을 건너뛰고 경고한다', async () => {
    // No proportional basis exists. Channel-level still records the refund, so the gap is
    // logged rather than left to be discovered as a silent table-to-table mismatch.
    const { service } = makeService({
      originalRows: [{ masterId: 'm1', salesChannel: 'coupang', totalPrice: 0 }],
    });

    const result = await service.recordOrderRefund(envelope as never, payload as never);

    expect(result.masterAmounts).toEqual([]);
    expect(result.salesChannel).toBe('coupang');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('환불 배분 기준'));
  });

  it('건너뛴 환불(취소 선점)은 배분도 만들지 않는다', async () => {
    const { service } = makeService({ cancellationRows: [{ messageId: '01J00000000000000000000020' }] });

    const result = await service.recordOrderRefund(envelope as never, payload as never);

    expect(result.masterAmounts).toEqual([]);
  });

  it('취소 조회는 claim 이후에 일어난다 (게이트 순서)', async () => {
    // If the cancellation probe ran before the claim, a redelivered refund would be
    // classified before the idempotency gate had its say, inverting the invariant
    // "insert fact → check claimed → early-return → aggregate".
    const { service, executor } = makeService({
      claimed: false,
      cancellationRows: [{ messageId: '01J00000000000000000000020' }],
    });

    const result = await service.recordOrderRefund(envelope as never, payload as never);

    expect(result.claimed).toBe(false);
    expect(result.supersededByCancellation).toBe(false);
    expect(executor.select).not.toHaveBeenCalled();
  });
});
