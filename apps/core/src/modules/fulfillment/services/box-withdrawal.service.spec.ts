import { PgDialect } from 'drizzle-orm/pg-core';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { BoxWithdrawalService } from './box-withdrawal.service';

class QueryResult implements PromiseLike<unknown[]> {
  constructor(
    private readonly rows: unknown[],
    private readonly captureWhere?: (predicate: unknown) => void,
  ) {}

  from(): this {
    return this;
  }

  innerJoin(): this {
    return this;
  }

  where(predicate: unknown): this {
    this.captureWhere?.(predicate);
    return this;
  }

  limit(): Promise<unknown[]> {
    return Promise.resolve(this.rows);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

const service = new BoxWithdrawalService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
const box = {
  shipmentId: '55555555-5555-4555-8555-555555555555',
  shipmentStatus: 'ready',
  lines: [{ inspectedQty: 0 }],
};

describe('BoxWithdrawalService.unstartedExitBlocker', () => {
  it('requires an active shipment tote assignment to be released before exclusion', async () => {
    const queryResults = [[], [], [], [{ id: '66666666-6666-4666-8666-666666666666' }]];
    const select = jest.fn(() => new QueryResult(queryResults.shift() ?? []));
    const tx = { select } as unknown as DbTx;

    await expect(service.unstartedExitBlocker(box, tx)).resolves.toMatchObject({
      code: 'WORK_ITEM_TOTE_RELEASE_REQUIRED',
    });
    expect(select).toHaveBeenCalledTimes(4);
  });

  it('refuses exclusion while a live work item still holds a positive allocation', async () => {
    const predicates: unknown[] = [];
    const queryResults = [[], [], [{ id: '88888888-8888-4888-8888-888888888888' }], []];
    const select = jest.fn(
      () => new QueryResult(queryResults.shift() ?? [], (predicate) => predicates.push(predicate)),
    );
    const tx = { select } as unknown as DbTx;

    await expect(service.unstartedExitBlocker(box, tx)).resolves.toMatchObject({ code: 'WORK_ITEM_ALLOCATED' });

    const rendered = predicates.map((predicate) =>
      new PgDialect().sqlToQuery(predicate as never).sql.replace(/\s+/g, ' '),
    );
    expect(
      rendered.some(
        (query) =>
          query.includes('"outbound_batch_work_items"."status" not in') &&
          query.includes('"picking_source_allocations"."qty" >'),
      ),
    ).toBe(true);
    expect(rendered.some((query) => query.includes('picking_plan'))).toBe(false);
  });
});
