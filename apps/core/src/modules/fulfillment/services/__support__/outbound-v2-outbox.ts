import { and, eq, inArray } from 'drizzle-orm';
import { wmsTables, DbTx } from '../../../inventory/schema/inventory.schema';

/**
 * The world fields the topology assertion reads. Structural on purpose: each scenario
 * spec owns a richer world type, and they only need to satisfy this shape.
 */
export interface OutboxTopologyWorld {
  skuId: string;
  warehouseId: string;
  /** Aggregate IDs whose outbox rows the fulfillment-side assertion is exact over. */
  outboxAggregateIds: string[];
}

export interface ExpectedOutboxTopology {
  dispatchAttemptIds?: string[];
  fullyShippedFulfillmentOrderIds?: string[];
  recalls?: Array<{ shipmentId: string; operationId: string; fulfillmentOrderIds: string[] }>;
}

interface OutboxRowIdentity {
  topic: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  idempotencyKey: string;
}

const encode = (row: OutboxRowIdentity) =>
  `${row.topic}|${row.eventType}|${row.aggregateType}|${row.aggregateId}|${row.idempotencyKey}`;

/**
 * Asserts the exact set of outbox rows — not a count and not a subset — for both the
 * inventory SHIP projection and the fulfillment-side topics.
 *
 * Exactness is the point: a count lets a wrong topic/key pass, and `arrayContaining`
 * lets a duplicate or an extra event pass. Callers therefore declare every event they
 * expect, and stable idempotency keys are pinned here rather than in each spec. One
 * consequence worth knowing: `fullyShippedFulfillmentOrderIds` yields exactly one v1
 * row per FO no matter how many attempts shipped it, which is what makes the v1
 * full-completion projection's once-only contract (`${foId}:fully-shipped`) observable.
 */
export async function expectExactOutboxTopology(
  tx: DbTx,
  world: OutboxTopologyWorld,
  expected: ExpectedOutboxTopology,
): Promise<void> {
  const shipEvents = await tx
    .select({ id: wmsTables.stockEvents.id })
    .from(wmsTables.stockEvents)
    .where(
      and(
        eq(wmsTables.stockEvents.skuId, world.skuId),
        eq(wmsTables.stockEvents.fromWarehouseId, world.warehouseId),
        eq(wmsTables.stockEvents.transitionType, 'SHIP'),
      ),
    );
  const inventoryRows = shipEvents.length
    ? await tx
        .select({
          topic: wmsTables.outboxEvents.topic,
          eventType: wmsTables.outboxEvents.eventType,
          aggregateType: wmsTables.outboxEvents.aggregateType,
          aggregateId: wmsTables.outboxEvents.aggregateId,
          idempotencyKey: wmsTables.outboxEvents.idempotencyKey,
        })
        .from(wmsTables.outboxEvents)
        .where(
          and(
            eq(wmsTables.outboxEvents.topic, 'inventory.events.v1'),
            inArray(
              wmsTables.outboxEvents.aggregateId,
              shipEvents.map((event) => event.id),
            ),
          ),
        )
    : [];
  expect(inventoryRows.map(encode).sort()).toEqual(
    shipEvents
      .map((event) =>
        encode({
          topic: 'inventory.events.v1',
          eventType: 'StockShipped',
          aggregateType: 'Stock',
          aggregateId: event.id,
          idempotencyKey: `stock-event:${event.id}`,
        }),
      )
      .sort(),
  );

  const dispatchAttemptIds = expected.dispatchAttemptIds ?? [];
  const attempts = dispatchAttemptIds.length
    ? await tx
        .select({ id: wmsTables.dispatchAttempts.id, shipmentId: wmsTables.dispatchAttempts.shipmentId })
        .from(wmsTables.dispatchAttempts)
        .where(inArray(wmsTables.dispatchAttempts.id, dispatchAttemptIds))
    : [];
  expect(attempts).toHaveLength(dispatchAttemptIds.length);
  const attemptOrders = attempts.length
    ? await tx
        .select({
          attemptId: wmsTables.dispatchAttempts.id,
          fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
        })
        .from(wmsTables.dispatchAttempts)
        .innerJoin(
          wmsTables.shipmentLines,
          eq(wmsTables.shipmentLines.shipmentId, wmsTables.dispatchAttempts.shipmentId),
        )
        .innerJoin(
          wmsTables.fulfillmentOrderItems,
          eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
        )
        .where(inArray(wmsTables.dispatchAttempts.id, dispatchAttemptIds))
    : [];
  const expectedRows: OutboxRowIdentity[] = [];
  for (const attempt of attempts) {
    expectedRows.push({
      topic: 'shipments.events.v1',
      eventType: 'ShipmentShipped',
      aggregateType: 'Shipment',
      aggregateId: attempt.shipmentId,
      idempotencyKey: attempt.id,
    });
    const fulfillmentOrderIds = [
      ...new Set(
        attemptOrders.filter((order) => order.attemptId === attempt.id).map((order) => order.fulfillmentOrderId),
      ),
    ];
    for (const fulfillmentOrderId of fulfillmentOrderIds) {
      expectedRows.push({
        topic: 'fulfillments.events.v2',
        eventType: 'FulfillmentProgressed',
        aggregateType: 'FulfillmentOrder',
        aggregateId: fulfillmentOrderId,
        idempotencyKey: `${attempt.id}:${fulfillmentOrderId}`,
      });
    }
  }
  for (const fulfillmentOrderId of expected.fullyShippedFulfillmentOrderIds ?? []) {
    expectedRows.push({
      topic: 'fulfillments.events.v1',
      eventType: 'FulfillmentShipped',
      aggregateType: 'Fulfillment',
      aggregateId: fulfillmentOrderId,
      idempotencyKey: `${fulfillmentOrderId}:fully-shipped`,
    });
  }
  for (const recalled of expected.recalls ?? []) {
    expectedRows.push({
      topic: 'shipments.events.v1',
      eventType: 'ShipmentDispatchRecalled',
      aggregateType: 'Shipment',
      aggregateId: recalled.shipmentId,
      idempotencyKey: recalled.operationId,
    });
    for (const fulfillmentOrderId of recalled.fulfillmentOrderIds) {
      expectedRows.push({
        topic: 'fulfillments.events.v2',
        eventType: 'FulfillmentReopened',
        aggregateType: 'FulfillmentOrder',
        aggregateId: fulfillmentOrderId,
        idempotencyKey: `${recalled.operationId}:${fulfillmentOrderId}`,
      });
    }
  }
  const fulfillmentRows = await tx
    .select({
      topic: wmsTables.outboxEvents.topic,
      eventType: wmsTables.outboxEvents.eventType,
      aggregateType: wmsTables.outboxEvents.aggregateType,
      aggregateId: wmsTables.outboxEvents.aggregateId,
      idempotencyKey: wmsTables.outboxEvents.idempotencyKey,
    })
    .from(wmsTables.outboxEvents)
    .where(inArray(wmsTables.outboxEvents.aggregateId, world.outboxAggregateIds));
  expect(fulfillmentRows.map(encode).sort()).toEqual(expectedRows.map(encode).sort());
}
