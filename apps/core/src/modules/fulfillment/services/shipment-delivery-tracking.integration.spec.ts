import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, inArray } from 'drizzle-orm';
import { FULFILLMENT_STREAM, SHIPMENT_STREAM } from '@packages/event-contracts/streams';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { OutboxService } from '../outbox/outbox.service';
import { makeDbService } from './__support__';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentProgressService } from './fulfillment-progress.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentDeliveryTrackingService } from './shipment-delivery-tracking.service';
import { ShipmentReservationService } from './shipment-reservation.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ShipmentDeliveryTrackingService (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 5 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  it('serializes concurrent final deliveries, preserves FO state, and emits V1 completion exactly once', async () => {
    const suffix = randomUUID();
    const dispatchedAt = new Date('2026-07-15T01:00:00.000Z');
    const inTransitAt = new Date('2026-07-15T02:00:00.000Z');
    const deliveredAt = [new Date('2026-07-15T03:00:00.000Z'), new Date('2026-07-15T04:00:00.000Z')];
    const ids = await db.transaction(async (tx) => {
      const [warehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: `delivery-wh-${suffix}` })
        .returning();
      const [holder] = await tx
        .insert(wmsTables.holders)
        .values({ name: `delivery-holder-${suffix}` })
        .returning();
      const [sku] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'delivery sku', code: `DELIVERY-${suffix}`, holderId: holder.id })
        .returning();
      const [location] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: warehouse.id, code: `DELIVERY-${suffix}`, locationType: 'zone' })
        .returning();
      const [salesOrder] = await tx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: `delivery-order-${suffix}`,
          salesChannel: 'naver',
          shippingAddress: {},
          orderDate: dispatchedAt,
        })
        .returning();
      const [fulfillmentOrder] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({ salesOrderId: salesOrder.id, warehouseId: warehouse.id, status: 'completed' })
        .returning();
      const [item] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({ fulfillmentOrderId: fulfillmentOrder.id, skuId: sku.id, qty: 2, shippedQty: 2, status: 'shipped' })
        .returning();
      const shipments = await tx
        .insert(wmsTables.shipments)
        .values([
          {
            warehouseId: warehouse.id,
            openedForFulfillmentOrderId: fulfillmentOrder.id,
            status: 'shipped' as const,
            shippedAt: dispatchedAt,
          },
          {
            warehouseId: warehouse.id,
            openedForFulfillmentOrderId: fulfillmentOrder.id,
            status: 'shipped' as const,
            shippedAt: dispatchedAt,
          },
        ])
        .returning();
      const lines = await tx
        .insert(wmsTables.shipmentLines)
        .values(
          shipments.map((shipment) => ({
            shipmentId: shipment.id,
            fulfillmentOrderItemId: item.id,
            skuId: sku.id,
            qty: 1,
            inspectedQty: 1,
          })),
        )
        .returning();
      const journals = await tx
        .insert(wmsTables.stockJournals)
        .values([
          { sourceType: 'dispatch', idempotencyKey: `delivery-journal-a-${suffix}` },
          { sourceType: 'dispatch', idempotencyKey: `delivery-journal-b-${suffix}` },
        ])
        .returning();
      const attempts = await tx
        .insert(wmsTables.dispatchAttempts)
        .values(
          shipments.map((shipment, index) => ({
            shipmentId: shipment.id,
            attemptNo: 1,
            status: 'dispatched' as const,
            idempotencyKey: `delivery-attempt-${index}-${suffix}`,
            stockJournalId: journals[index].id,
            dispatchedAt,
          })),
        )
        .returning();
      await tx.insert(wmsTables.dispatchAttemptSources).values(
        attempts.map((attempt, index) => ({
          dispatchAttemptId: attempt.id,
          shipmentLineId: lines[index].id,
          sourceLocationId: location.id,
          qty: 1,
        })),
      );
      await tx.insert(wmsTables.outboxEvents).values({
        topic: FULFILLMENT_STREAM.topic.topic,
        idempotencyKey: `${fulfillmentOrder.id}:fully-shipped`,
        eventType: 'FulfillmentShipped',
        aggregateType: 'Fulfillment',
        aggregateId: fulfillmentOrder.id,
        partitionKey: fulfillmentOrder.id,
        payload: {},
      });
      return {
        warehouse,
        holder,
        sku,
        location,
        salesOrder,
        fulfillmentOrder,
        item,
        shipments,
        lines,
        journals,
        attempts,
      };
    });

    const dbService = makeDbService(db);
    const service = new ShipmentDeliveryTrackingService(
      dbService,
      new OutboxService(dbService),
      new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
      new ShipmentReservationService(
        dbService,
        {} as never,
        new FulfillmentProgressService(),
        new FulfillmentInvariantService(),
      ),
    );

    try {
      await service.recordProviderEvent(ids.attempts[0].id, {
        providerEventId: `in-transit-${suffix}`,
        status: 'in_transit',
        occurredAt: inTransitAt.toISOString(),
      });
      await Promise.all(
        ids.attempts.map((attempt, index) =>
          service.recordProviderEvent(attempt.id, {
            providerEventId: `delivered-${index}-${suffix}`,
            status: 'delivered',
            occurredAt: deliveredAt[index].toISOString(),
          }),
        ),
      );

      const tracking = await db
        .select()
        .from(wmsTables.shipmentTracking)
        .where(
          inArray(
            wmsTables.shipmentTracking.dispatchAttemptId,
            ids.attempts.map((row) => row.id),
          ),
        );
      expect(tracking).toHaveLength(3);
      expect(tracking.filter((row) => row.status === 'delivered')).toHaveLength(2);

      const [fo] = await db
        .select({ status: wmsTables.fulfillmentOrders.status })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, ids.fulfillmentOrder.id));
      expect(fo.status).toBe('completed');

      const shipmentDeliveredEvents = await db
        .select()
        .from(wmsTables.outboxEvents)
        .where(
          and(
            eq(wmsTables.outboxEvents.topic, SHIPMENT_STREAM.topic.topic),
            eq(wmsTables.outboxEvents.eventType, 'ShipmentDelivered'),
          ),
        );
      expect(shipmentDeliveredEvents.filter((row) => ids.shipments.some((s) => s.id === row.aggregateId))).toHaveLength(
        2,
      );

      const v1Delivered = await db
        .select()
        .from(wmsTables.outboxEvents)
        .where(
          and(
            eq(wmsTables.outboxEvents.topic, FULFILLMENT_STREAM.topic.topic),
            eq(wmsTables.outboxEvents.eventType, 'FulfillmentDelivered'),
            eq(wmsTables.outboxEvents.aggregateId, ids.fulfillmentOrder.id),
          ),
        );
      expect(v1Delivered).toHaveLength(1);
      expect(v1Delivered[0].idempotencyKey).toBe(`${ids.fulfillmentOrder.id}:fully-delivered`);
      expect((v1Delivered[0].payload as { deliveredAt: string }).deliveredAt).toBe(deliveredAt[1].toISOString());

      const acceptedAttempts = await db
        .select({ id: wmsTables.dispatchAttempts.id, carrierAcceptedAt: wmsTables.dispatchAttempts.carrierAcceptedAt })
        .from(wmsTables.dispatchAttempts)
        .where(
          inArray(
            wmsTables.dispatchAttempts.id,
            ids.attempts.map((row) => row.id),
          ),
        );
      expect(new Map(acceptedAttempts.map((row) => [row.id, row.carrierAcceptedAt?.toISOString()]))).toEqual(
        new Map([
          [ids.attempts[0].id, inTransitAt.toISOString()],
          [ids.attempts[1].id, deliveredAt[1].toISOString()],
        ]),
      );

      await expect(
        service.recordProviderEvent(ids.attempts[0].id, {
          providerEventId: `delivered-0-${suffix}`,
          status: 'delivered',
          occurredAt: deliveredAt[0].toISOString(),
        }),
      ).resolves.toEqual(expect.objectContaining({ replayed: true }));
      await expect(
        service.recordProviderEvent(ids.attempts[1].id, {
          providerEventId: `delivered-0-${suffix}`,
          status: 'delivered',
          occurredAt: deliveredAt[1].toISOString(),
        }),
      ).resolves.toEqual(expect.objectContaining({ replayed: false, dispatchAttemptId: ids.attempts[1].id }));

      const finalV1Delivered = await db
        .select()
        .from(wmsTables.outboxEvents)
        .where(
          and(
            eq(wmsTables.outboxEvents.topic, FULFILLMENT_STREAM.topic.topic),
            eq(wmsTables.outboxEvents.eventType, 'FulfillmentDelivered'),
            eq(wmsTables.outboxEvents.aggregateId, ids.fulfillmentOrder.id),
          ),
        );
      expect(finalV1Delivered).toHaveLength(1);
    } finally {
      await db.transaction(async (tx) => {
        const attemptIds = ids.attempts.map((row) => row.id);
        const shipmentIds = ids.shipments.map((row) => row.id);
        await tx
          .delete(wmsTables.shipmentTracking)
          .where(inArray(wmsTables.shipmentTracking.dispatchAttemptId, attemptIds));
        await tx
          .delete(wmsTables.outboxEvents)
          .where(inArray(wmsTables.outboxEvents.aggregateId, [...shipmentIds, ids.fulfillmentOrder.id]));
        await tx
          .delete(wmsTables.dispatchAttemptSources)
          .where(inArray(wmsTables.dispatchAttemptSources.dispatchAttemptId, attemptIds));
        await tx.delete(wmsTables.dispatchAttempts).where(inArray(wmsTables.dispatchAttempts.id, attemptIds));
        await tx.delete(wmsTables.stockJournals).where(
          inArray(
            wmsTables.stockJournals.id,
            ids.journals.map((row) => row.id),
          ),
        );
        await tx.delete(wmsTables.shipmentLines).where(
          inArray(
            wmsTables.shipmentLines.id,
            ids.lines.map((row) => row.id),
          ),
        );
        await tx.delete(wmsTables.shipments).where(inArray(wmsTables.shipments.id, shipmentIds));
        await tx.delete(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.id, ids.item.id));
        await tx.delete(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, ids.fulfillmentOrder.id));
        await tx.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, ids.salesOrder.id));
        await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.id, ids.location.id));
        await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, ids.sku.id));
        await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, ids.holder.id));
        await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, ids.warehouse.id));
      });
    }
  });
});
