jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { ProductMastersService } from './product-masters.service';
import {
  productMasterPurchaseConstraints,
  productMasters,
  productMasterVersions,
  productPurchaseConstraints,
} from '../../../schema/catalog.schema';

describe('ProductMastersService Medusa projection outbox events', () => {
  function makeService() {
    const productPublisher = {
      publishEvent: jest.fn().mockResolvedValue(undefined),
    };
    const outboxPublisher = {
      saveEvent: jest.fn().mockResolvedValue(undefined),
    };
    const productSellableQuantity = {
      recalculateAndPublishForMaster: jest.fn().mockResolvedValue([]),
    };

    const service = new ProductMastersService(
      { run: (fn: any, t?: any) => (t ? fn(t) : fn(undefined)) } as any,
      productPublisher as any,
      outboxPublisher as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      productSellableQuantity as any,
      null,
    );

    return { service, productPublisher, outboxPublisher, productSellableQuantity };
  }

  it('passes the delete transaction to the ProductMasterDeleted outbox enqueue', async () => {
    const { service } = makeService();
    const tx: any = {
      select: jest.fn(() => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: () =>
              table === productMasterVersions ? [{ id: 'version-1', masterId: 'master-1', status: 'active' }] : [],
          }),
        }),
      })),
      update: jest.fn(() => ({
        set: () => ({
          where: () => ({
            returning: () => [{ id: 'master-1', deletedAt: new Date('2026-06-07T00:00:00.000Z') }],
          }),
        }),
      })),
    };
    tx.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () => {
          const rows =
            table === productMasters
              ? [{ id: 'master-1', deletedAt: null }]
              : [{ id: 'version-1', masterId: 'master-1', status: 'active' }];
          return {
            limit: () => rows,
            then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(rows)),
          };
        },
      }),
    }));
    (service as any)._emitMasterDeletedEvent = jest.fn().mockResolvedValue(undefined);

    await service.deleteMaster('master-1', 'user-1', tx);

    expect((service as any)._emitMasterDeletedEvent).toHaveBeenCalledWith('master-1', tx);
  });

  it('enqueues ProductMasterDeleted through the transactional outbox and does not publish directly to Kafka', async () => {
    const { service, productPublisher, outboxPublisher } = makeService();
    const tx = {} as any;

    await (service as any)._emitMasterDeletedEvent('master-1', tx);

    expect(outboxPublisher.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'products.events.v1',
        eventType: 'ProductMasterDeleted',
        aggregateType: 'Product',
        aggregateId: 'master-1',
        payload: expect.objectContaining({
          masterId: 'master-1',
        }),
      }),
      tx,
    );
    expect(productPublisher.publishEvent).not.toHaveBeenCalled();
  });
});

describe('ProductMastersService hardDelete purchase constraint cleanup', () => {
  type VersionRow = {
    id: string;
    masterId: string;
    status: string;
  };

  type PurchaseConstraintRow = {
    id: string;
    requiresMembership: boolean;
    lifetimeQuantityLimit: number | null;
  };

  type PurchaseConstraintMappingRow = {
    id: string;
    masterId: string;
    versionId: string;
    purchaseConstraintId: string;
  };

  function makeService() {
    const productPublisher = {
      publishEvent: jest.fn().mockResolvedValue(undefined),
    };
    const outboxPublisher = {
      saveEvent: jest.fn().mockResolvedValue(undefined),
    };
    const productSellableQuantity = {
      recalculateAndPublishForMaster: jest.fn().mockResolvedValue([]),
    };

    return new ProductMastersService(
      { run: (fn: any, t?: any) => (t ? fn(t) : fn(undefined)) } as any,
      productPublisher as any,
      outboxPublisher as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      productSellableQuantity as any,
      null,
    );
  }

  function makeHardDeleteTx(input: {
    versions: VersionRow[];
    purchaseConstraints: PurchaseConstraintRow[];
    purchaseConstraintMappings: PurchaseConstraintMappingRow[];
  }) {
    const state = {
      versions: [...input.versions],
      purchaseConstraints: [...input.purchaseConstraints],
      purchaseConstraintMappings: [...input.purchaseConstraintMappings],
    };

    const rowsForTable = (table: unknown) => {
      if (table === productMasterVersions) return state.versions;
      if (table === productPurchaseConstraints) return state.purchaseConstraints;
      if (table === productMasterPurchaseConstraints) return state.purchaseConstraintMappings;
      return [];
    };

    const columnToRowKey: Record<string, string> = {
      id: 'id',
      master_id: 'masterId',
      version_id: 'versionId',
      purchase_constraint_id: 'purchaseConstraintId',
    };

    const isColumnChunk = (chunk: any) => chunk && typeof chunk.name === 'string' && chunk.table;
    const isParamChunk = (chunk: any) =>
      chunk &&
      Object.prototype.hasOwnProperty.call(chunk, 'value') &&
      Object.prototype.hasOwnProperty.call(chunk, 'encoder');

    const collectPredicates = (condition: any): Array<{ column: string; value: unknown }> => {
      const chunks = condition?.queryChunks;
      if (!Array.isArray(chunks)) {
        return [];
      }

      const column = chunks.find(isColumnChunk);
      const param = chunks.find(isParamChunk);
      if (column && param) {
        return [{ column: column.name, value: param.value }];
      }

      return chunks.flatMap((chunk) => collectPredicates(chunk));
    };

    const matchesWhere = (row: Record<string, unknown>, condition: any) =>
      collectPredicates(condition).every((predicate) => {
        const key = columnToRowKey[predicate.column] ?? predicate.column;
        return row[key] === predicate.value;
      });

    const projectRows = <T extends Record<string, unknown>>(rows: T[], selection?: Record<string, unknown>) => {
      if (!selection) {
        return rows;
      }

      return rows.map((row) =>
        Object.keys(selection).reduce<Record<string, unknown>>((projected, key) => {
          projected[key] = row[key];
          return projected;
        }, {}),
      );
    };

    return {
      state,
      select: jest.fn((selection?: Record<string, unknown>) => ({
        from: jest.fn((table: unknown) => ({
          where: jest.fn((condition: unknown) =>
            projectRows(
              rowsForTable(table).filter((row) => matchesWhere(row, condition)),
              selection,
            ),
          ),
        })),
      })),
      delete: jest.fn((table: unknown) => ({
        where: jest.fn((condition: unknown) => {
          const rows = rowsForTable(table);
          const deletedRows: Record<string, unknown>[] = [];

          for (let index = rows.length - 1; index >= 0; index -= 1) {
            if (matchesWhere(rows[index], condition)) {
              deletedRows.push(rows[index]);
              rows.splice(index, 1);
            }
          }

          if (table === productMasterVersions) {
            for (const version of deletedRows) {
              for (let index = state.purchaseConstraintMappings.length - 1; index >= 0; index -= 1) {
                if (state.purchaseConstraintMappings[index].versionId === version.id) {
                  state.purchaseConstraintMappings.splice(index, 1);
                }
              }
            }
          }
        }),
      })),
    };
  }

  it('deletes an unshared purchase constraint row after permanently deleting its version', async () => {
    const service = makeService();
    const tx = makeHardDeleteTx({
      versions: [{ id: 'version-id', masterId: 'master-id', status: 'draft' }],
      purchaseConstraints: [{ id: 'constraint-id', requiresMembership: true, lifetimeQuantityLimit: 3 }],
      purchaseConstraintMappings: [
        {
          id: 'mapping-id',
          masterId: 'master-id',
          versionId: 'version-id',
          purchaseConstraintId: 'constraint-id',
        },
      ],
    });
    (service as any).logAudit = jest.fn().mockResolvedValue(undefined);

    await service.hardDelete('version-id', 'user-id', tx as any);

    expect(tx.state.purchaseConstraintMappings).toEqual([]);
    expect(tx.state.purchaseConstraints).toEqual([]);
  });
});
