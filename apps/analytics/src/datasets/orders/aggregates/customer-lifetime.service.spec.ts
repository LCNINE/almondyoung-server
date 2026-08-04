import { CustomerLifetimeService } from './customer-lifetime.service';

/**
 * Same rationale as channel-aggregates.service.spec.ts: `sql` template fragments push
 * interpolated primitives into `queryChunks` as-is (no `Param` wrapping until query-build
 * time), and the literal text between interpolations lives in `StringChunk`s. These
 * helpers let the test assert, without a database, that:
 *   (a) LEAST/GREATEST still wraps the update (out-of-order-delivery safety preserved),
 *       and
 *   (b) the bound `occurredAt` value is a *string* — never a raw `Date` — since binding a
 *       Date into a raw `sql` fragment throws at runtime against real postgres (see the
 *       inline comment in customer-lifetime.service.ts for the mechanism, and the live,
 *       unfixed instance at apps/notification/src/shared/services/metrics.service.ts:54).
 *       A future "simplification" back to `${seed.occurredAt}` would reintroduce that bug
 *       silently under mocks — this test is the only thing that would catch it.
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

describe('CustomerLifetimeService', () => {
  function makeService() {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const executor = { insert: jest.fn().mockReturnValue({ values }) };
    const run = jest.fn((fn: (e: unknown) => unknown, tx?: unknown) => (tx ? fn(tx) : fn(executor)));
    const dbService = { run };
    return { service: new CustomerLifetimeService(dbService as never), values, onConflictDoUpdate };
  }

  function conflictSet(onConflictDoUpdate: jest.Mock) {
    return (onConflictDoUpdate.mock.calls[0][0] as { set: Record<string, unknown> }).set;
  }

  it('신규 고객이면 최초 진입 시 주문수 1·매출을 그대로 기록한다', async () => {
    const { service, values } = makeService();
    const occurredAt = new Date('2026-07-14T01:00:00.000Z');

    await service.applyOrderCreated({ customerId: 'customer-1', occurredAt, revenue: 10000 });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-1',
        firstOrderAt: occurredAt,
        lastOrderAt: occurredAt,
        ordersCount: 1,
        totalRevenue: 10000,
      }),
    );
  });

  it('firstOrderAt/lastOrderAt 갱신은 LEAST/GREATEST 로 감싸고 Date 대신 ISO 문자열을 바인딩한다', async () => {
    const { service, onConflictDoUpdate } = makeService();
    const occurredAt = new Date('2026-07-14T01:00:00.000Z');

    await service.applyOrderCreated({ customerId: 'customer-1', occurredAt, revenue: 10000 });

    const set = conflictSet(onConflictDoUpdate);

    expect(literalText(set.firstOrderAt)).toContain('LEAST(');
    expect(literalText(set.lastOrderAt)).toContain('GREATEST(');

    const firstOrderParams = boundParams(set.firstOrderAt);
    const lastOrderParams = boundParams(set.lastOrderAt);
    expect(firstOrderParams).toEqual([occurredAt.toISOString()]);
    expect(lastOrderParams).toEqual([occurredAt.toISOString()]);

    for (const param of [...firstOrderParams, ...lastOrderParams]) {
      expect(param).not.toBeInstanceOf(Date);
      expect(typeof param).toBe('string');
    }
  });

  it('ordersCount·totalRevenue 갱신은 누적 덧셈이다', async () => {
    const { service, onConflictDoUpdate } = makeService();
    const occurredAt = new Date('2026-07-14T01:00:00.000Z');

    await service.applyOrderCreated({ customerId: 'customer-1', occurredAt, revenue: 10000 });

    const set = conflictSet(onConflictDoUpdate);
    // ordersCount's "+ 1" increment is a literal baked into the sql template text (not an
    // interpolation), so it shows up in the joined literal text rather than as a bound param.
    expect(literalText(set.ordersCount)).toContain('+ 1');
    expect(literalText(set.totalRevenue)).toContain('+');
    expect(boundParams(set.totalRevenue)).toEqual([10000]);
  });
});
