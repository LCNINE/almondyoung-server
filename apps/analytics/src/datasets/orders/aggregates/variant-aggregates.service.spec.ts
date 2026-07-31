import { VariantAggregatesService } from './variant-aggregates.service';

/**
 * See `channel-aggregates.service.spec.ts` for the full rationale. In short: a plain
 * `values()` assertion only proves what the *insert* payload looks like, not what the
 * conflict branch does on a real collision. These helpers pin down both the bound parameter
 * (`boundParams`) and the literal SQL text around it (`literalText`) so a test can
 * distinguish `quantitySold + n` (safe, accumulates) from a regressed `quantitySold`
 * overwrite (silently drops the earlier order on the same
 * `(aggDate, variantId, salesChannel)` key).
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

describe('VariantAggregatesService', () => {
  function makeService() {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = jest.fn().mockReturnValue({ values });
    const executor = { insert };
    const run = jest.fn((fn: (e: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : fn(executor)));
    const dbService = { run };
    return { service: new VariantAggregatesService(dbService as never), insert, values, onConflictDoUpdate, run };
  }

  function conflictSets(onConflictDoUpdate: jest.Mock): Array<Record<string, unknown>> {
    return onConflictDoUpdate.mock.calls.map((call) => (call[0] as { set: Record<string, unknown> }).set);
  }

  const seed = {
    variantId: 'variant-1',
    masterId: 'master-1',
    salesChannel: 'naver',
    occurredDate: '2026-07-14',
    quantitySold: 2,
    revenue: 2000,
  };

  it('seed 를 옵션 단위 행으로 삽입한다', async () => {
    const { service, values } = makeService();

    await service.applyOrderCreated([seed]);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        aggDate: '2026-07-14',
        variantId: 'variant-1',
        masterId: 'master-1',
        salesChannel: 'naver',
        quantitySold: 2,
        grossRevenue: 2000,
      }),
    );
  });

  it('충돌 시 수량·매출을 덮어쓰지 않고 더한다', async () => {
    // The regression this guards, and the reason this suite exists at all: this service had
    // no direct tests, so its `+` accumulation was unverified. Two orders for the same
    // option on the same day collide on (aggDate, variantId, salesChannel) — an overwrite
    // would report only the later order, understating both option sales and option revenue.
    const { service, onConflictDoUpdate } = makeService();

    await service.applyOrderCreated([seed]);

    const [set] = conflictSets(onConflictDoUpdate);
    expect(literalText(set.quantitySold)).toContain('+');
    expect(boundParams(set.quantitySold)).toEqual([2]);
    expect(literalText(set.grossRevenue)).toContain('+');
    expect(boundParams(set.grossRevenue)).toEqual([2000]);
  });

  it('seed 마다 한 번씩 upsert 한다 (옵션별로 행이 갈린다)', async () => {
    const { service, values, onConflictDoUpdate } = makeService();

    await service.applyOrderCreated([seed, { ...seed, variantId: 'variant-2', quantitySold: 1, revenue: 3000 }]);

    expect(values).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenNthCalledWith(2, expect.objectContaining({ variantId: 'variant-2', grossRevenue: 3000 }));

    const sets = conflictSets(onConflictDoUpdate);
    expect(boundParams(sets[1].grossRevenue)).toEqual([3000]);
    expect(boundParams(sets[1].quantitySold)).toEqual([1]);
  });

  it('seed 가 비면 트랜잭션도 열지 않는다', async () => {
    const { service, insert, run } = makeService();

    await service.applyOrderCreated([]);

    expect(insert).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('tx 가 주어지면 새 트랜잭션을 열지 않고 그대로 쓴다', async () => {
    // Propagation matters here: the consumer runs the claim, the item facts, and every
    // aggregate in one transaction. A service that opened its own would break the
    // all-or-nothing guarantee the idempotency gate depends on.
    const { service, run, insert: ownInsert } = makeService();
    const outerInsert = jest
      .fn()
      .mockReturnValue({ values: jest.fn().mockReturnValue({ onConflictDoUpdate: jest.fn() }) });
    const tx = { insert: outerInsert };

    await service.applyOrderCreated([seed], tx as never);

    expect(run).toHaveBeenCalledWith(expect.any(Function), tx);
    // The write landed on the caller's transaction, not on a fresh one this service opened.
    expect(outerInsert).toHaveBeenCalledTimes(1);
    expect(ownInsert).not.toHaveBeenCalled();
  });
});
