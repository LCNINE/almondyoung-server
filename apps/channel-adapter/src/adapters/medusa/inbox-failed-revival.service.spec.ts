import { InboxFailedRevivalService } from './inbox-failed-revival.service';
import { PgDialect } from 'drizzle-orm/pg-core';

function renderSql(condition: unknown): string {
  return new PgDialect().sqlToQuery(condition as never).sql;
}

function createDbMock(rows: unknown[]) {
  const selectWheres: unknown[] = [];
  const updates: { values: any; where: unknown }[] = [];

  const db = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn((condition: unknown) => {
          selectWheres.push(condition);
          return Promise.resolve(rows);
        }),
      })),
    })),
    update: jest.fn(() => ({
      set: jest.fn((values: any) => ({
        where: jest.fn((condition: unknown) => {
          updates.push({ values, where: condition });
          return Promise.resolve(undefined);
        }),
      })),
    })),
  };

  return { dbService: { db } as any, selectWheres, updates, db };
}

describe('InboxFailedRevivalService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** sleep 을 건너뛰며 크론을 끝까지 돌린다. */
  async function run(service: InboxFailedRevivalService) {
    const done = service.reviveProductNotFoundFailures();
    await jest.runAllTimersAsync();
    return done;
  }

  it('Medusa 에 상품이 생긴 masterId 의 실패만 되살린다', async () => {
    const { dbService, updates } = createDbMock([
      { id: 'e1', payload: { masterId: 'm-exists' } },
      { id: 'e2', payload: { masterId: 'm-exists' } },
      { id: 'e3', payload: { masterId: 'm-missing' } },
    ]);
    const medusaClient = {
      findProductByHandle: jest.fn(async (handle: string) => (handle === 'm-exists' ? { id: 'prod_1' } : null)),
    } as any;

    await run(new InboxFailedRevivalService(dbService, medusaClient));

    // 이벤트 3건이지만 조회는 상품 수(2개) 만큼이다.
    expect(medusaClient.findProductByHandle).toHaveBeenCalledTimes(2);
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({
      status: 'pending',
      attempts: 0,
      errorMessage: null,
      failedAt: null,
    });
    // 상품이 아직 없는 m-missing(e3) 은 깨우지 않는다.
    const where = renderSql(updates[0].where);
    expect(where).toContain('$4, $5');
    // 조회 때와 같은 조건을 UPDATE 에도 건다.
    expect(where).toContain('"status" = $1');
    expect(where).toContain('"event_type" = $2');
    expect(where).toContain('"error_message" like $3');
    expect(where).toContain('not exists');
  });

  it('상품이 하나도 안 생겼으면 UPDATE 를 아예 하지 않는다', async () => {
    const { dbService, updates } = createDbMock([{ id: 'e1', payload: { masterId: 'm-missing' } }]);
    const medusaClient = { findProductByHandle: jest.fn().mockResolvedValue(null) } as any;

    await run(new InboxFailedRevivalService(dbService, medusaClient));

    expect(updates).toHaveLength(0);
  });

  it('조회가 터진 masterId 는 건너뛰고 나머지는 되살린다', async () => {
    const { dbService, updates } = createDbMock([
      { id: 'e1', payload: { masterId: 'm-boom' } },
      { id: 'e2', payload: { masterId: 'm-exists' } },
    ]);
    const medusaClient = {
      findProductByHandle: jest.fn(async (handle: string) => {
        if (handle === 'm-boom') throw new Error('Medusa findProductByHandle failed: 503');
        return { id: 'prod_1' };
      }),
    } as any;

    await run(new InboxFailedRevivalService(dbService, medusaClient));

    expect(updates).toHaveLength(1);
    expect(renderSql(updates[0].where)).toContain('$4');
  });

  it('product-not-found 실패만, ProductSellableQuantityChanged 만 고른다', async () => {
    const { dbService, selectWheres } = createDbMock([]);
    const medusaClient = { findProductByHandle: jest.fn() } as any;

    await run(new InboxFailedRevivalService(dbService, medusaClient));

    const sql = renderSql(selectWheres[0]);
    expect(sql).toContain('"status" = $1');
    expect(sql).toContain('"event_type" = $2');
    expect(sql).toContain('"error_message" like $3');
    // 같은 variant 에 더 최신 이벤트가 있으면 되살리지 않는다.
    expect(sql.replace(/\s+/g, ' ')).toContain(
      'not exists ( select 1 from "inbox_events" newer where newer.aggregate_id = "inbox_events"."aggregate_id"',
    );
    expect(sql.replace(/\s+/g, ' ')).toContain(
      'coalesce(newer.event_occurred_at, newer.created_at) > coalesce("inbox_events"."event_occurred_at", "inbox_events"."created_at")',
    );
    expect(medusaClient.findProductByHandle).not.toHaveBeenCalled();
  });

  it('payload 에 masterId 가 없는 행은 되살리지 않는다', async () => {
    const { dbService, updates } = createDbMock([{ id: 'e1', payload: { variantId: 'v1' } }]);
    const medusaClient = { findProductByHandle: jest.fn() } as any;

    await run(new InboxFailedRevivalService(dbService, medusaClient));

    expect(medusaClient.findProductByHandle).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});
