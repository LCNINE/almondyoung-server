import { ChannelAggregatesService } from './channel-aggregates.service';

/**
 * `sql\`${col} + ${value}\`` fragments are `SQL` objects whose `queryChunks` array
 * interleaves `StringChunk`s (the literal text between interpolations, e.g. `" + "`)
 * with the interpolated values themselves. A `Column` interpolation stays an object
 * reference; a plain JS primitive (number/string) interpolation is pushed in as-is
 * (drizzle only wraps it in a `Param` at query-build time, not at template-construction
 * time). These two helpers let a pure unit test — no database, no `toQuery()` — pin down
 * both "what value got bound" and "which literal operator/function wraps it", which is
 * exactly what distinguishes `col + 0` (safe) from `col - cancelledAmount` (the gross
 * revenue regression this suite guards against).
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

describe('ChannelAggregatesService', () => {
  function makeService() {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const executor = { insert: jest.fn().mockReturnValue({ values }) };
    const run = jest.fn((fn: (e: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : fn(executor)));
    const dbService = { run };
    return { service: new ChannelAggregatesService(dbService as never), values, onConflictDoUpdate };
  }

  function conflictSet(onConflictDoUpdate: jest.Mock) {
    return (onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> }).set;
  }

  it('주문 생성 시 매출과 주문수를 올린다', async () => {
    const { service, values, onConflictDoUpdate } = makeService();

    await service.applyOrderCreated({
      salesChannel: 'naver',
      occurredDate: '2026-07-14',
      ordersCount: 1,
      grossRevenue: 5000,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ aggDate: '2026-07-14', salesChannel: 'naver', ordersCount: 1, grossRevenue: 5000 }),
    );

    const set = conflictSet(onConflictDoUpdate);
    expect(literalText(set.grossRevenue)).toContain('+');
    expect(boundParams(set.grossRevenue)).toEqual([5000]);
    expect(literalText(set.ordersCount)).toContain('+');
    expect(boundParams(set.ordersCount)).toEqual([1]);
  });

  it('취소는 cancelledAmount 를 올린다 (grossRevenue 를 깎지 않는다)', async () => {
    const { service, values, onConflictDoUpdate } = makeService();

    await service.applyCancellation('2026-07-14', 'naver', 3000);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ cancelledAmount: 3000, grossRevenue: 0, ordersCount: 0 }),
    );

    // The regression this guards: someone rewiring the grossRevenue conflict clause to
    // subtract cancelledAmount instead of adding zero. The insert-payload assertion above
    // (`grossRevenue: 0`) would stay green under that regression — only inspecting the
    // onConflictDoUpdate branch catches it.
    const set = conflictSet(onConflictDoUpdate);
    expect(literalText(set.grossRevenue)).toContain('+');
    expect(boundParams(set.grossRevenue)).toEqual([0]);
    expect(literalText(set.cancelledAmount)).toContain('+');
    expect(boundParams(set.cancelledAmount)).toEqual([3000]);
  });

  it('환불은 refundedAmount 를 올린다 (grossRevenue 를 깎지 않는다)', async () => {
    const { service, values, onConflictDoUpdate } = makeService();

    await service.applyRefund('2026-07-16', 'coupang', 1500);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ refundedAmount: 1500, grossRevenue: 0, ordersCount: 0 }),
    );

    // Same regression class as applyCancellation above: refundedAmount must be added, and
    // grossRevenue must be added with zero rather than subtracted. Only the onConflictDoUpdate
    // branch — not the values() insert payload — catches an overwrite/subtraction regression.
    const set = conflictSet(onConflictDoUpdate);
    expect(literalText(set.grossRevenue)).toContain('+');
    expect(boundParams(set.grossRevenue)).toEqual([0]);
    expect(literalText(set.refundedAmount)).toContain('+');
    expect(boundParams(set.refundedAmount)).toEqual([1500]);
  });
});
