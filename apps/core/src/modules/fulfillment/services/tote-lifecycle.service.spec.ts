import { DbTx } from '../../inventory/schema/inventory.schema';
import { ToteLifecycleService } from './tote-lifecycle.service';

class QueryResult<T> implements PromiseLike<T> {
  constructor(private readonly value: T) {}
  from() {
    return this;
  }
  innerJoin() {
    return this;
  }
  where() {
    return this;
  }
  orderBy() {
    return this;
  }
  limit() {
    return this;
  }
  for() {
    return Promise.resolve(this.value);
  }
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.value).then(onfulfilled, onrejected);
  }
}

describe('ToteLifecycleService', () => {
  it('takes the canonical physical-tote advisory lock before CAS-releasing an empty assignment', async () => {
    const rows = [
      [{ assignmentId: 'assignment-1', toteId: 'tote-1', toteBarcode: 'TOTE-001' }],
      [{ id: 'tote-1', status: 'in_use', version: 3 }],
      [{ id: 'assignment-1', shipmentId: 'shipment-1' }],
      [],
    ];
    const select = jest.fn(() => new QueryResult(rows.shift() ?? []));
    const execute = jest.fn().mockResolvedValue([]);
    const updateResults = [[{ id: 'assignment-1' }], [{ id: 'tote-1' }]];
    const update = jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => ({ returning: jest.fn(async () => updateResults.shift() ?? []) })),
      })),
    }));
    const tx = { select, execute, update } as unknown as DbTx;
    const service = new ToteLifecycleService({ run: (work: (trx: DbTx) => Promise<unknown>) => work(tx) } as never);

    const result = await service.releaseEmptyAssignmentsForShipment({
      shipmentId: 'shipment-1',
      operationId: 'operation-1',
    });

    expect(result).toEqual({ releasedAssignmentIds: ['assignment-1'], retainedToteIds: [] });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
  });

  it('retains an assigned tote while positive physical custody remains', async () => {
    const rows = [
      [{ assignmentId: 'assignment-1', toteId: 'tote-1', toteBarcode: 'TOTE-001' }],
      [{ id: 'tote-1', status: 'in_use', version: 3 }],
      [{ id: 'assignment-1', shipmentId: 'shipment-1' }],
      [{ id: 'balance-1' }],
    ];
    const tx = {
      select: jest.fn(() => new QueryResult(rows.shift() ?? [])),
      execute: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    } as unknown as DbTx;
    const service = new ToteLifecycleService({ run: (work: (trx: DbTx) => Promise<unknown>) => work(tx) } as never);

    await expect(
      service.releaseEmptyAssignmentsForShipment({ shipmentId: 'shipment-1', operationId: 'operation-1' }),
    ).resolves.toEqual({ releasedAssignmentIds: [], retainedToteIds: ['tote-1'] });
    expect(tx.update).not.toHaveBeenCalled();
  });
});
