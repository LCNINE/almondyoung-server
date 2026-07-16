import { DbService } from '@app/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import { FulfillmentReconciliationService } from './fulfillment-reconciliation.service';

describe('FulfillmentReconciliationService', () => {
  it('returns counts and exact resource IDs without issuing any write', async () => {
    const execute = jest.fn().mockResolvedValue([
      { kind: 'ACTIVE_LINE_QUANTITY', resource_id: 'foi-1', message: 'drift' },
      { kind: 'ACTIVE_LINE_QUANTITY', resource_id: 'foi-2', message: 'drift' },
      { kind: 'SESSION_CONSERVATION', resource_id: 'session-1', message: 'drift' },
    ]);
    const trx = { execute };
    const dbService = {
      run: jest.fn((fn: (value: typeof trx) => unknown) => fn(trx)),
    } as unknown as DbService<typeof wmsSchema>;
    const metrics = { setFulfillmentInvariantViolations: jest.fn() };
    const service = new FulfillmentReconciliationService(dbService, metrics as never);

    const report = await service.reconcile();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(report.totalViolations).toBe(3);
    expect(report.counts.ACTIVE_LINE_QUANTITY).toBe(2);
    expect(report.resourceIds).toMatchObject({
      ACTIVE_LINE_QUANTITY: ['foi-1', 'foi-2'],
      SESSION_CONSERVATION: ['session-1'],
    });
    expect(Object.keys(trx)).toEqual(['execute']);
  });

  it('publishes zero counts for a clean scheduled run', async () => {
    const trx = { execute: jest.fn().mockResolvedValue([]) };
    const dbService = {
      run: jest.fn((fn: (value: typeof trx) => unknown) => fn(trx)),
    } as unknown as DbService<typeof wmsSchema>;
    const metrics = { setFulfillmentInvariantViolations: jest.fn() };
    const service = new FulfillmentReconciliationService(dbService, metrics as never);

    await service.scheduledReconcile();

    expect(metrics.setFulfillmentInvariantViolations).toHaveBeenCalledWith(
      expect.objectContaining({ ACTIVE_LINE_QUANTITY: 0, DISPATCH_EVENT_CARDINALITY: 0 }),
    );
  });

  it('queries foreign source ownership and exact SHIP/SKU/warehouse event semantics', async () => {
    let capturedQuery: unknown;
    const trx = {
      execute: jest.fn((query: unknown) => {
        capturedQuery = query;
        return Promise.resolve([]);
      }),
    };
    const dbService = {
      run: jest.fn((fn: (value: typeof trx) => unknown) => fn(trx)),
    } as unknown as DbService<typeof wmsSchema>;
    const service = new FulfillmentReconciliationService(dbService, {} as never);

    await service.reconcile();

    const rendered = new PgDialect().sqlToQuery(capturedQuery as never).sql.replace(/\s+/g, ' ');
    expect(rendered).toContain('sl.shipment_id IS DISTINCT FROM da.shipment_id');
    expect(rendered).toContain("se.transition_type IS DISTINCT FROM 'SHIP'");
    expect(rendered).toContain('se.sku_id IS DISTINCT FROM sl.sku_id');
    expect(rendered).toContain('se.from_warehouse_id IS DISTINCT FROM s.warehouse_id');
  });
});
