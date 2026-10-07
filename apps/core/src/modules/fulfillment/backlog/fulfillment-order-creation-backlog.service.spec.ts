import { PgDialect } from 'drizzle-orm/pg-core';

import { wmsTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentOrderCreationBacklogService } from './fulfillment-order-creation-backlog.service';

describe('FulfillmentOrderCreationBacklogService', () => {
  function makeService() {
    const updates: Array<{ table: unknown; set: Record<string, unknown>; where: unknown; returning: unknown[] }> = [];
    const tx: any = {
      update: (table: unknown) => ({
        set: (set: Record<string, unknown>) => ({
          where: (where: unknown) => ({
            returning: (projection?: unknown) => {
              const returning = projection ? [{ id: 'backlog-1' }] : [{ id: 'backlog-1', ...set }];
              updates.push({ table, set, where, returning });
              return returning;
            },
          }),
        }),
      }),
    };
    const dbService = {
      db: {
        transaction: jest.fn((fn) => fn(tx)),
      },
      run: jest.fn((fn: (t: any) => any, aTx?: any) => fn(aTx ?? tx)),
    };
    const workflowGate = {
      shouldEnqueueFo: jest.fn().mockReturnValue(true),
      shouldRunFoCreation: jest.fn().mockReturnValue(true),
    };

    return {
      service: new FulfillmentOrderCreationBacklogService(dbService as never, workflowGate as never),
      tx,
      updates,
      workflowGate,
    };
  }

  function normalizeSql(where: unknown) {
    const { sql } = new PgDialect().sqlToQuery(where as any);
    return sql.replace(/\s+/g, ' ');
  }

  it('wakeBacklogsWaitingForVariant also requeues rows currently being processed', async () => {
    const { service, tx, updates } = makeService();

    await service.wakeBacklogsWaitingForVariant('variant-1', tx);

    expect(updates).toHaveLength(1);
    expect(updates[0].set.status).toBe('pending');
    const whereSql = normalizeSql(updates[0].where);
    expect(whereSql).toContain(`"status" = 'awaiting_matching'`);
    expect(whereSql).toContain('?');
    expect(whereSql).toMatch(/"status"\s+=\s+'processing'/i);
    expect(whereSql).toMatch(/exists\s+\( select 1 from "sales_order_lines"/i);
    expect(whereSql).toMatch(/"sales_order_id"\s+=\s+"fulfillment_order_creation_backlogs"\."sales_order_id"/i);
  });

  it('markAwaitingMatching only writes awaiting_matching while the row is still processing', async () => {
    const { service, tx, updates } = makeService();

    await service.markAwaitingMatching(
      'backlog-1',
      [{ salesOrderLineId: 'line-1', variantId: 'variant-1', reason: 'NO_PRODUCT_SKU_MATCHING' }],
      tx,
    );

    expect(updates).toHaveLength(1);
    expect(updates[0].set.status).toBe('awaiting_matching');
    const whereSql = normalizeSql(updates[0].where);
    expect(whereSql).toMatch(/"id"\s*=\s*\$\d+/);
    expect(whereSql).toMatch(/"status"\s*=\s*\$\d+/);
  });

  it('markFailed only writes failed while the row is still processing', async () => {
    const { service, tx, updates } = makeService();

    await service.markFailed('backlog-1', 1, new Error('boom'), tx);

    expect(updates).toHaveLength(1);
    expect(updates[0].set.status).toBe('failed');
    const whereSql = normalizeSql(updates[0].where);
    expect(whereSql).toMatch(/"id"\s*=\s*\$\d+/);
    expect(whereSql).toMatch(/"status"\s*=\s*\$\d+/);
  });

  it('closeOpenForSalesOrder closes all non-terminal backlog rows for a cancelled order', async () => {
    const { service, tx, updates } = makeService();

    await service.closeOpenForSalesOrder('sales-order-1', tx);

    expect(updates).toHaveLength(1);
    expect(updates[0].set.status).toBe('not_required');
    const whereSql = normalizeSql(updates[0].where);
    expect(whereSql).toMatch(/"sales_order_id"\s*=\s*\$\d+/);
    expect(whereSql).toMatch(/"status"\s+in\s+\(\$\d+,\s*\$\d+,\s*\$\d+,\s*\$\d+\)/i);
  });

  it('does not enqueue or claim backlog rows when the workflow gate is closed', async () => {
    const { service, workflowGate } = makeService();
    workflowGate.shouldEnqueueFo.mockReturnValue(false);
    workflowGate.shouldRunFoCreation.mockReturnValue(false);

    await expect(
      service.enqueueForSalesOrder('sales-order-1', {
        eventOccurredAt: '2026-07-14T03:00:00.000Z',
        isNewSalesOrder: true,
      }),
    ).resolves.toBeUndefined();
    await expect(service.claimPending()).resolves.toEqual([]);
  });

  it('requeueAwaitingMatching 은 그 주문의 awaiting_matching 행만 pending 으로 되돌린다 (CAS)', async () => {
    const { service, tx, updates } = makeService();

    const n = await service.requeueAwaitingMatching('so-1', tx);

    expect(n).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({
      status: 'pending',
      waitingVariantIds: [],
      failureReason: null,
      failureDetails: null,
      lockedAt: null,
    });
    const whereSql = normalizeSql(updates[0].where);
    expect(whereSql).toMatch(/"sales_order_id" = \$1/);
    expect(whereSql).toMatch(/"status" = \$2/);
  });

  it('requeueAwaitingMatching 은 정비 모드면 아무것도 하지 않는다', async () => {
    const { service, tx, updates, workflowGate } = makeService();
    workflowGate.shouldRunFoCreation.mockReturnValue(false);

    expect(await service.requeueAwaitingMatching('so-1', tx)).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
