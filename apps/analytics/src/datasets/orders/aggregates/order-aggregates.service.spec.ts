import { OrderAggregatesService } from './order-aggregates.service';

/**
 * See `channel-aggregates.service.spec.ts` for the full rationale. In short: a plain
 * `values()` assertion only proves what the *insert* payload looks like, not what the
 * conflict branch does on a real collision. These helpers pin down both the bound
 * parameter (`boundParams`) and the literal SQL text around it (`literalText`) so a test
 * can distinguish `cancelledAmount + amount` (safe, accumulates) from a regressed
 * `cancelledAmount` overwrite (silently drops the earlier cancellation on the same
 * `(aggDate, masterId, salesChannel)` key).
 */
type SqlFragment = { queryChunks: unknown[] };

function boundParams(fragment: unknown): Array<number | string> {
  return (fragment as SqlFragment).queryChunks.filter(
    (chunk): chunk is number | string => typeof chunk === 'number' || typeof chunk === 'string',
  );
}

function literalText(fragment: unknown): string {
  return (fragment as SqlFragment).queryChunks
    .filter(
      (chunk): chunk is { value: string[] } =>
        typeof chunk === 'object' && chunk !== null && Array.isArray((chunk as { value?: unknown }).value),
    )
    .map((chunk) => chunk.value.join(''))
    .join('');
}

describe('OrderAggregatesService', () => {
  function makeService() {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = jest.fn().mockReturnValue({ values });
    const executor = { insert };
    const dbService = { db: { transaction: jest.fn((fn: (e: unknown) => unknown) => fn(executor)) } };
    const service = new OrderAggregatesService(dbService as never);
    return { service, insert, values, onConflictDoUpdate };
  }

  function conflictSets(onConflictDoUpdate: jest.Mock): Array<Record<string, unknown>> {
    return onConflictDoUpdate.mock.calls.map((call) => (call[0] as { set: Record<string, unknown> }).set);
  }

  it('같은 날짜·상품·채널 seed 를 합쳐 한 번만 upsert 한다', async () => {
    const { service, values, onConflictDoUpdate } = makeService();

    await service.applyOrderCreated([
      {
        masterId: 'm1',
        salesChannel: 'naver',
        occurredDate: '2026-07-14',
        orderCount: 1,
        quantitySold: 2,
        revenue: 2000,
      },
      {
        masterId: 'm1',
        salesChannel: 'naver',
        occurredDate: '2026-07-14',
        orderCount: 1,
        quantitySold: 3,
        revenue: 3000,
      },
    ]);

    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ ordersCount: 2, quantitySold: 5, grossRevenue: 5000 }),
    );

    // The gap this closes: the in-memory merge above only covers seeds *within one event*.
    // Two separate orders for the same product on the same day arrive as two calls and
    // collide on the (aggDate, masterId, salesChannel) key, so it is the conflict branch —
    // not `values()` — that decides whether the second order adds to the first or replaces
    // it. `grossRevenue` on agg_product_order_daily is the most-read money column in this
    // branch; an overwrite regression there silently reports only the day's last order.
    const [set] = conflictSets(onConflictDoUpdate);
    expect(literalText(set.grossRevenue)).toContain('+');
    expect(boundParams(set.grossRevenue)).toEqual([5000]);
    expect(literalText(set.ordersCount)).toContain('+');
    expect(boundParams(set.ordersCount)).toEqual([2]);
    expect(literalText(set.quantitySold)).toContain('+');
    expect(boundParams(set.quantitySold)).toEqual([5]);
  });

  it('seed 가 비면 아무것도 쓰지 않는다', async () => {
    const { service, values } = makeService();

    await service.applyOrderCreated([]);

    expect(values).not.toHaveBeenCalled();
  });

  describe('applyCancellation', () => {
    it('masterId 별로 cancelledAmount 를 더한다 (덮어쓰지 않는다)', async () => {
      const { service, values, onConflictDoUpdate } = makeService();

      await service.applyCancellation('2026-07-15', 'naver', [
        { masterId: 'm1', amount: 3000 },
        { masterId: 'm2', amount: 500 },
      ]);

      expect(values).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          aggDate: '2026-07-15',
          masterId: 'm1',
          salesChannel: 'naver',
          ordersCount: 0,
          quantitySold: 0,
          cancelledAmount: 3000,
        }),
      );
      expect(values).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          aggDate: '2026-07-15',
          masterId: 'm2',
          salesChannel: 'naver',
          ordersCount: 0,
          quantitySold: 0,
          cancelledAmount: 500,
        }),
      );

      // The regression this guards: someone rewiring the conflict clause to a plain
      // overwrite (`cancelledAmount: amount`) instead of an addition. Two orders for the
      // same product cancelled on the same day collide on the same
      // (aggDate, masterId, salesChannel) key — an overwrite silently drops the first
      // cancellation's amount, understating cancelledAmount and overstating net revenue.
      const sets = conflictSets(onConflictDoUpdate);
      expect(literalText(sets[0].cancelledAmount)).toContain('+');
      expect(boundParams(sets[0].cancelledAmount)).toEqual([3000]);
      expect(literalText(sets[1].cancelledAmount)).toContain('+');
      expect(boundParams(sets[1].cancelledAmount)).toEqual([500]);
    });

    it('grossRevenue 는 insert 값에도 conflict set 에도 나타나지 않는다', async () => {
      const { service, values, onConflictDoUpdate } = makeService();

      await service.applyCancellation('2026-07-15', 'naver', [{ masterId: 'm1', amount: 3000 }]);

      const insertPayload = values.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(insertPayload, 'grossRevenue')).toBe(false);

      const [set] = conflictSets(onConflictDoUpdate);
      expect(Object.prototype.hasOwnProperty.call(set, 'grossRevenue')).toBe(false);
    });

    it('masterAmounts 가 비면 아무것도 쓰지 않는다', async () => {
      const { service, insert, values } = makeService();

      await service.applyCancellation('2026-07-15', 'naver', []);

      expect(insert).not.toHaveBeenCalled();
      expect(values).not.toHaveBeenCalled();
    });
  });

  describe('applyRefund', () => {
    it('masterId 별로 refundedAmount 를 더한다 (덮어쓰지 않는다)', async () => {
      const { service, values, onConflictDoUpdate } = makeService();

      await service.applyRefund('2026-07-16', 'coupang', [
        { masterId: 'm1', amount: 900 },
        { masterId: 'm2', amount: 600 },
      ]);

      expect(values).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          aggDate: '2026-07-16',
          masterId: 'm1',
          salesChannel: 'coupang',
          ordersCount: 0,
          quantitySold: 0,
          refundedAmount: 900,
        }),
      );

      // The regression this guards: an overwrite (`refundedAmount: amount`) instead of an
      // addition. Two refunds against the same product on the same day collide on the same
      // (aggDate, masterId, salesChannel) key — an overwrite silently drops the first,
      // understating refunds and overstating product-level net revenue. The insert-payload
      // assertion above stays green under that regression; only this does not.
      const sets = conflictSets(onConflictDoUpdate);
      expect(literalText(sets[0].refundedAmount)).toContain('+');
      expect(boundParams(sets[0].refundedAmount)).toEqual([900]);
      expect(literalText(sets[1].refundedAmount)).toContain('+');
      expect(boundParams(sets[1].refundedAmount)).toEqual([600]);
    });

    it('grossRevenue 는 insert 값에도 conflict set 에도 나타나지 않는다', async () => {
      // Same invariant as applyCancellation: gross is never decremented, refunds accumulate
      // in their own column and net is derived at query time.
      const { service, values, onConflictDoUpdate } = makeService();

      await service.applyRefund('2026-07-16', 'coupang', [{ masterId: 'm1', amount: 900 }]);

      const insertPayload = values.mock.calls[0][0] as Record<string, unknown>;
      expect(Object.prototype.hasOwnProperty.call(insertPayload, 'grossRevenue')).toBe(false);

      const [set] = conflictSets(onConflictDoUpdate);
      expect(Object.prototype.hasOwnProperty.call(set, 'grossRevenue')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(set, 'cancelledAmount')).toBe(false);
    });

    it('masterAmounts 가 비면 아무것도 쓰지 않는다', async () => {
      const { service, insert, values } = makeService();

      await service.applyRefund('2026-07-16', 'coupang', []);

      expect(insert).not.toHaveBeenCalled();
      expect(values).not.toHaveBeenCalled();
    });
  });
});
