import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  seedHolder,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
} from '../../fulfillment/services/__support__';
import { WalletRefundClient } from './wallet-refund.client';
import { StoreSalesOrdersService } from './store-sales-orders.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('Store order tracking V2 graph (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });

  afterAll(async () => {
    await client.end();
  });

  async function seedOrder(tx: DbTx, skuId: string, warehouseId: string, customerId: string) {
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
      lines: [{ variantId: randomUUID(), quantity: 1 }],
    });
    await tx.update(wmsTables.salesOrders).set({ customerId }).where(eq(wmsTables.salesOrders.id, salesOrderId));
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId: `channel-item-${randomUUID()}` })
      .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({ salesOrderId, warehouseId, status: 'completed', totalItems: 1, totalQty: 1 })
      .returning();
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({
        fulfillmentOrderId: fulfillmentOrder.id,
        salesOrderId,
        salesOrderLineId: lineIds[0],
        skuId,
        qty: 1,
      })
      .returning();
    return { salesOrderId, salesOrderLineId: lineIds[0], fulfillmentOrder, item };
  }

  it('합배송 line subset과 recalled→redispatch 운송장 history를 두 SO에 보존하고 FO completed를 delivered로 보지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const customerId = randomUUID();
      const { warehouseId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      const first = await seedOrder(tx, skuId, warehouseId, customerId);
      const second = await seedOrder(tx, skuId, warehouseId, customerId);
      const [shipment] = await tx.insert(wmsTables.shipments).values({ warehouseId, status: 'planned' }).returning();
      const shipmentLines = await tx
        .insert(wmsTables.shipmentLines)
        .values([
          {
            shipmentId: shipment.id,
            fulfillmentOrderItemId: first.item.id,
            skuId,
            qty: 1,
          },
          {
            shipmentId: shipment.id,
            fulfillmentOrderItemId: second.item.id,
            skuId,
            qty: 1,
          },
        ])
        .returning();
      const [waybill] = await tx
        .insert(wmsTables.waybills)
        .values({
          trackingNo: `OLD-TRACK-${randomUUID()}`,
          carrier: 'CJ',
          source: 'carrier',
          shipmentId: shipment.id,
          status: 'voided',
          manifestVersion: 1,
          recipientHash: 'a'.repeat(64),
          voidedAt: new Date('2026-07-14T02:00:00Z'),
        })
        .returning();
      const [redispatchWaybill] = await tx
        .insert(wmsTables.waybills)
        .values({
          trackingNo: `NEW-TRACK-${randomUUID()}`,
          carrier: 'HANJIN',
          source: 'carrier',
          shipmentId: shipment.id,
          status: 'used',
          manifestVersion: 1,
          recipientHash: 'a'.repeat(64),
        })
        .returning();
      const journals = await tx
        .insert(wmsTables.stockJournals)
        .values([
          { sourceType: 'SHIPMENT', sourceId: shipment.id, idempotencyKey: `ship-1-${randomUUID()}` },
          { sourceType: 'SHIPMENT_RECALL', sourceId: shipment.id, idempotencyKey: `recall-1-${randomUUID()}` },
          { sourceType: 'SHIPMENT', sourceId: shipment.id, idempotencyKey: `ship-2-${randomUUID()}` },
        ])
        .returning();
      const dispatchedAt = new Date('2026-07-14T01:00:00Z');
      const recalledAt = new Date('2026-07-14T02:00:00Z');
      const redispatchedAt = new Date('2026-07-14T03:00:00Z');
      const attempts = await tx
        .insert(wmsTables.dispatchAttempts)
        .values([
          {
            shipmentId: shipment.id,
            attemptNo: 1,
            status: 'recalled',
            idempotencyKey: `tracking-it-1-${randomUUID()}`,
            waybillId: waybill.id,
            stockJournalId: journals[0].id,
            reversalJournalId: journals[1].id,
            dispatchedAt,
            recalledAt,
          },
          {
            shipmentId: shipment.id,
            attemptNo: 2,
            status: 'dispatched',
            idempotencyKey: `tracking-it-2-${randomUUID()}`,
            waybillId: redispatchWaybill.id,
            stockJournalId: journals[2].id,
            dispatchedAt: redispatchedAt,
          },
        ])
        .returning();
      await tx.insert(wmsTables.shipmentTracking).values([
        {
          shipmentId: shipment.id,
          dispatchAttemptId: attempts[0].id,
          providerEventId: `old-${randomUUID()}`,
          status: 'delivered',
          timestamp: new Date('2026-07-14T02:30:00Z'),
        },
        {
          shipmentId: shipment.id,
          dispatchAttemptId: attempts[1].id,
          providerEventId: `new-${randomUUID()}`,
          status: 'in_transit',
          timestamp: new Date('2026-07-14T04:00:00Z'),
        },
      ]);

      const service = new StoreSalesOrdersService({ db: tx } as never, {} as never, {} as WalletRefundClient);
      const firstView = await service.getTracking(first.salesOrderId, customerId);
      const secondView = await service.getTracking(second.salesOrderId, customerId);

      expect(firstView.status).toBe('shipping');
      expect(secondView.status).toBe('shipping');
      expect(firstView.shipments).toHaveLength(1);
      expect(secondView.shipments).toHaveLength(1);
      expect(firstView.shipments[0].shipmentId).toBe(shipment.id);
      expect(secondView.shipments[0].shipmentId).toBe(shipment.id);
      expect(firstView.shipments[0].lines).toEqual([
        expect.objectContaining({
          shipmentLineId: shipmentLines[0].id,
          salesOrderLineId: first.salesOrderLineId,
        }),
      ]);
      expect(secondView.shipments[0].lines).toEqual([
        expect.objectContaining({
          shipmentLineId: shipmentLines[1].id,
          salesOrderLineId: second.salesOrderLineId,
        }),
      ]);
      expect(firstView.shipments[0]).toMatchObject({
        trackingNumber: redispatchWaybill.trackingNo,
        carrier: 'HANJIN',
        status: 'in_transit',
      });
      expect(firstView.shipments[0].dispatchAttempts).toEqual([
        expect.objectContaining({
          attemptNo: 1,
          recalled: true,
          waybillId: waybill.id,
          carrier: 'CJ',
          trackingNumber: waybill.trackingNo,
          recalledAt,
        }),
        expect.objectContaining({
          attemptNo: 2,
          recalled: false,
          waybillId: redispatchWaybill.id,
          carrier: 'HANJIN',
          trackingNumber: redispatchWaybill.trackingNo,
        }),
      ]);
      expect(secondView.shipments[0].dispatchAttempts).toEqual([
        expect.objectContaining({
          attemptNo: 1,
          recalled: true,
          waybillId: waybill.id,
          carrier: 'CJ',
          trackingNumber: waybill.trackingNo,
          recalledAt,
        }),
        expect.objectContaining({
          attemptNo: 2,
          recalled: false,
          waybillId: redispatchWaybill.id,
          carrier: 'HANJIN',
          trackingNumber: redispatchWaybill.trackingNo,
        }),
      ]);
    });
  });
});
