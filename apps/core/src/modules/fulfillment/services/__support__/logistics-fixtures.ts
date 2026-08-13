import { randomUUID } from 'crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { outbox_events } from '@app/events';
import { wmsTables, DbTx } from '../../../inventory/schema/inventory.schema';
import { InventoryCommandService } from '../../../inventory/core/services/inventory-command.service';
import { FulfillmentInvariantService } from '../fulfillment-invariant.service';
import { availableFromView } from './logistics-assertions';
import { canonicalFulfillmentRequestHash } from '../fulfillment-command.service';

export async function seedWarehouseWithZone(tx: DbTx): Promise<{ warehouseId: string; locationId: string }> {
  const [wh] = await tx
    .insert(wmsTables.warehouses)
    // 배치 생성이 창고 능력을 검사하므로 기본 창고는 discrete 를 지원해야 한다.
    // 다른 전략이 필요한 스펙은 이 값을 자기가 덮어쓴다(outbound-v2-warehouse-scenarios 등).
    .values({ name: `it-wh-${randomUUID().slice(0, 8)}`, supportedPickingStrategies: ['discrete'] })
    .returning();
  const [loc] = await tx
    .insert(wmsTables.locations)
    .values({ warehouseId: wh.id, code: `IT-Z-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
    .returning();
  return { warehouseId: wh.id, locationId: loc.id };
}

export async function seedHolder(tx: DbTx): Promise<{ holderId: string }> {
  const [holder] = await tx
    .insert(wmsTables.holders)
    .values({ name: `it-holder-${randomUUID().slice(0, 8)}` })
    .returning();
  return { holderId: holder.id };
}

// sku.code 는 대문자 — inspectScan 바코드 매칭이 대문자 code 로 대조.
export async function seedSku(tx: DbTx, holderId: string): Promise<{ skuId: string; skuCode: string }> {
  const skuCode = `IT-${randomUUID().toUpperCase()}`;
  const [sku] = await tx.insert(wmsTables.skus).values({ name: 'it-sku', code: skuCode, holderId }).returning();
  return { skuId: sku.id, skuCode };
}

// RECEIVE 이벤트 + ON_HAND ledger 를 남긴다. toLocationId 필수.
export async function receiveStock(
  command: InventoryCommandService,
  tx: DbTx,
  args: { skuId: string; warehouseId: string; locationId: string; quantity: number },
): Promise<void> {
  await command.receive(
    {
      skuId: args.skuId,
      toWarehouseId: args.warehouseId,
      toLocationId: args.locationId,
      quantity: args.quantity,
      reason: 'IT-SEED',
      idempotencyKey: `recv-${randomUUID()}`,
    },
    tx,
  );
}

// SO + 라인. 라인 mappingSnapshotId 는 default null → 라이브 매칭 경로 강제. variantId 는 임의 UUID.
export async function seedSalesOrder(
  tx: DbTx,
  args: { lines: Array<{ variantId: string; quantity: number; productName?: string }> },
): Promise<{ salesOrderId: string; lineIds: string[] }> {
  const [so] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `IT-CH-${randomUUID().slice(0, 8)}`,
      salesChannel: 'medusa',
      status: 'confirmed',
      shippingAddress: { name: 'IT', address1: 'x' },
      orderDate: new Date(),
    })
    .returning();

  const lineIds: string[] = [];
  for (const l of args.lines) {
    const [line] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({
        salesOrderId: so.id,
        variantId: l.variantId,
        productName: l.productName ?? 'IT Product',
        quantity: l.quantity,
        unitPrice: 1000,
      })
      .returning();
    lineIds.push(line.id);
  }
  return { salesOrderId: so.id, lineIds };
}

// 사전 매칭(matched/variant) + link. 재매칭-깨우기 경로를 태우지 않는 케이스용(1a/2a/골든 SO-1).
export async function seedMatching(
  tx: DbTx,
  args: { variantId: string; skuId: string; quantity?: number; strategy?: 'variant' | 'void' },
): Promise<{ matchingId: string }> {
  const strategy = args.strategy ?? 'variant';
  const [matching] = await tx
    .insert(wmsTables.productMatchings)
    .values({ variantId: args.variantId, status: 'matched', strategy, isResolved: true, preStockSellable: true })
    .returning();
  if (strategy === 'variant') {
    await tx
      .insert(wmsTables.productVariantSkuLinks)
      .values({ productMatchingId: matching.id, skuId: args.skuId, quantity: args.quantity ?? 1 });
  }
  return { matchingId: matching.id };
}

export interface OutboundV2Checkpoint {
  fulfillmentOrderIds: string[];
  skuId: string;
  warehouseId: string;
  outboxAggregateIds: string[];
  expected: {
    onHandQty: number;
    reservedQty: number;
    availableQty: number;
    outboxCount: number;
    inventoryOutboxCount: number;
    dispatchAttemptCount: number;
    dispatchSourceCount: number;
    shipEventCount: number;
  };
}

/**
 * Release-scenario checkpoint. The production invariant checker owns demand,
 * active-line/reservation, session and dispatch source/event cardinality. This
 * wrapper adds the externally observable inventory/outbox totals and exact
 * dispatch attempt/source/SHIP-event topology that are deliberately outside
 * that connected-component invariant.
 */
export async function assertOutboundV2Checkpoint(tx: DbTx, checkpoint: OutboundV2Checkpoint): Promise<void> {
  try {
    await new FulfillmentInvariantService().assertFulfillmentOrders(checkpoint.fulfillmentOrderIds, tx);
  } catch (error) {
    // getResponse() only exists on HttpException. Anything else — a DB error, a
    // TypeError — must still report its message, or JSON.stringify(error)
    // silently renders "{}" and hides the real failure.
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    const detail =
      response !== undefined
        ? JSON.stringify(response)
        : error instanceof Error
          ? (error.stack ?? error.message)
          : String(error);
    throw new Error(`Outbound V2 invariant checkpoint failed: ${detail}`, {
      cause: error,
    });
  }

  const [ledger] = await tx
    .select({ qty: sql<number>`coalesce(sum(${wmsTables.stockLedgers.qty}), 0)::int` })
    .from(wmsTables.stockLedgers)
    .where(
      and(
        eq(wmsTables.stockLedgers.skuId, checkpoint.skuId),
        eq(wmsTables.stockLedgers.warehouseId, checkpoint.warehouseId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
      ),
    );
  const [reservations] = await tx
    .select({ qty: sql<number>`coalesce(sum(${wmsTables.stockReservations.quantity}), 0)::int` })
    .from(wmsTables.stockReservations)
    .where(
      and(
        eq(wmsTables.stockReservations.skuId, checkpoint.skuId),
        eq(wmsTables.stockReservations.warehouseId, checkpoint.warehouseId),
        eq(wmsTables.stockReservations.status, 'confirmed'),
      ),
    );
  // 적재 대상이 `event.outbox_events` 로 옮겨졌다 (ADR-0029 §5-1, Task 6-C-2).
  const [outbox] = checkpoint.outboxAggregateIds.length
    ? await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(outbox_events)
        .where(inArray(outbox_events.aggregateId, checkpoint.outboxAggregateIds))
    : [{ count: 0 }];
  const [inventoryOutbox] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(outbox_events)
    // 공용 테이블의 `aggregate_id` 는 varchar 라 uuid 컬럼과 직접 비교하면 Postgres 가 거부한다.
    .innerJoin(wmsTables.stockEvents, sql`${wmsTables.stockEvents.id}::text = ${outbox_events.aggregateId}`)
    .where(
      and(
        eq(outbox_events.topic, 'inventory.events.v1'),
        eq(outbox_events.eventType, 'StockShipped'),
        eq(outbox_events.aggregateType, 'Stock'),
        eq(wmsTables.stockEvents.skuId, checkpoint.skuId),
        eq(wmsTables.stockEvents.transitionType, 'SHIP'),
        or(
          eq(wmsTables.stockEvents.fromWarehouseId, checkpoint.warehouseId),
          eq(wmsTables.stockEvents.toWarehouseId, checkpoint.warehouseId),
        ),
      ),
    );
  const [dispatchAttempts] = await tx
    .select({ count: sql<number>`count(distinct ${wmsTables.dispatchAttempts.id})::int` })
    .from(wmsTables.dispatchAttempts)
    .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.dispatchAttempts.shipmentId))
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(inArray(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, checkpoint.fulfillmentOrderIds));
  // Reach lines through the source's own shipmentLineId FK, not through the
  // attempt's shipment. A consolidated shipment carries lines from several
  // fulfillment orders, so a shipment-level join would count sources belonging
  // to orders the checkpoint never listed.
  const [dispatchSources] = await tx
    .select({ count: sql<number>`count(distinct ${wmsTables.dispatchAttemptSources.id})::int` })
    .from(wmsTables.dispatchAttemptSources)
    .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.dispatchAttemptSources.shipmentLineId))
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(inArray(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, checkpoint.fulfillmentOrderIds));
  const [shipEvents] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(wmsTables.stockEvents)
    .where(
      and(
        eq(wmsTables.stockEvents.skuId, checkpoint.skuId),
        eq(wmsTables.stockEvents.fromWarehouseId, checkpoint.warehouseId),
        eq(wmsTables.stockEvents.transitionType, 'SHIP'),
      ),
    );

  const onHandQty = Number(ledger?.qty ?? 0);
  const reservedQty = Number(reservations?.qty ?? 0);
  // available 은 DB 가 계산한 값을 읽는다. `onHandQty - reservedQty` 로 TS 에서 재계산하면 바로 위
  // 두 값의 항등식이 되어 독립적으로 실패할 수 없다 — 두 값이 이미 골든값으로 단언되는 이상
  // 정보량이 0이고, available 회귀를 하나도 못 잡는다. 뷰는 available_qty 를
  // on_hand − reserved − transit_out 으로 계산하므로, 뷰에서 읽으면 transit_out 누수와 뷰 산술
  // 회귀를 실제로 검출한다. 이 값이 onHand/reserved 와 함께 움직이는지는 골든값이 앵커링한다.
  const availableQty = await availableFromView(tx, checkpoint.skuId, checkpoint.warehouseId);
  expect({
    onHandQty,
    reservedQty,
    availableQty,
    outboxCount: Number(outbox?.count ?? 0),
    inventoryOutboxCount: Number(inventoryOutbox?.count ?? 0),
    dispatchAttemptCount: Number(dispatchAttempts?.count ?? 0),
    dispatchSourceCount: Number(dispatchSources?.count ?? 0),
    shipEventCount: Number(shipEvents?.count ?? 0),
  }).toEqual(checkpoint.expected);
}

export interface PickableShipmentFixture {
  actorId: string;
  warehouseId: string;
  holderId: string;
  skuId: string;
  skuCode: string;
  barcode: string;
  locationId: string;
  ledgerVersion: number;
  shipmentId: string;
  shipmentLineId: string;
  batchId: string;
  workItemId: string;
  waybillId: string;
  trackingNo: string;
  qty: number;
}

/**
 * 단순출고 시작 지점 픽스처 — 재고·예약·운송장은 준비됐고 피킹은 아직 시작하지
 * 않은 상태(work item `queued`, plan·session 없음). `seedReadyShipment`(검수 직전)
 * 와 달리 plan/session/HAND_IN 을 심지 않는다 — 그것을 만드는 것이 피검증 대상이다.
 */
export async function seedPickableShipment(tx: DbTx, qty = 2): Promise<PickableShipmentFixture> {
  const suffix = randomUUID();
  const actorId = randomUUID();
  const [warehouse] = await tx
    .insert(wmsTables.warehouses)
    .values({ name: `simple-warehouse-${suffix}`, supportedPickingStrategies: ['discrete'] })
    .returning();
  const [holder] = await tx
    .insert(wmsTables.holders)
    .values({ name: `simple-holder-${suffix}` })
    .returning();
  // discrete-picking.strategy.assertPlanningEligibility 가 plan() 진입에 요구하는 최소 조건 —
  // shipment.shippingProfileId + sku.deliveryProfileId 가 같은 완전한 delivery profile 을 가리켜야 한다.
  const [deliveryProfile] = await tx
    .insert(wmsTables.deliveryProfiles)
    .values({
      name: `simple-profile-${suffix}`,
      sourceType: 'in_house',
      senderSnapshot: { name: 'Simple Sender', phone: '02-0000-0000' },
      originAddressSnapshot: { address: 'Origin' },
      returnAddressSnapshot: { address: 'Return' },
      carrierAccountRef: 'simple-center',
      supportedFulfillmentModes: ['in_house'],
    })
    .returning();
  const skuCode = `SIMPLE-${suffix}`;
  const [sku] = await tx
    .insert(wmsTables.skus)
    .values({ name: 'Simple SKU', code: skuCode, holderId: holder.id, deliveryProfileId: deliveryProfile.id })
    .returning();
  const barcode = `880${suffix.replaceAll('-', '').slice(0, 10)}`;
  await tx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
  const [location] = await tx
    .insert(wmsTables.locations)
    .values({ warehouseId: warehouse.id, code: `SIMPLE-ZONE-${suffix}`, locationType: 'zone' })
    .returning();
  const [ledger] = await tx
    .insert(wmsTables.stockLedgers)
    .values({ skuId: sku.id, warehouseId: warehouse.id, locationId: location.id, stockState: 'ON_HAND', qty })
    .returning();

  const [salesOrder] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `simple-order-${suffix}`,
      salesChannel: 'medusa',
      shippingAddress: {},
      orderDate: new Date(),
    })
    .returning();
  const [salesOrderLine] = await tx
    .insert(wmsTables.salesOrderLines)
    .values({
      salesOrderId: salesOrder.id,
      variantId: randomUUID(),
      productName: 'Simple product',
      quantity: qty,
      channelOrderItemId: `simple-item-${suffix}`,
      channelProductId: `simple-product-${suffix}`,
    })
    .returning();
  const [fulfillmentOrder] = await tx
    .insert(wmsTables.fulfillmentOrders)
    .values({ salesOrderId: salesOrder.id, warehouseId: warehouse.id, status: 'processing', totalQty: qty })
    .returning();
  const [item] = await tx
    .insert(wmsTables.fulfillmentOrderItems)
    .values({
      fulfillmentOrderId: fulfillmentOrder.id,
      salesOrderId: salesOrder.id,
      salesOrderLineId: salesOrderLine.id,
      skuId: sku.id,
      qty,
      reservedQty: qty,
      status: 'processing',
    })
    .returning();
  // assertRecipientComplete 는 recipientName/phone/postalCode/roadAddress/detailAddress 다섯 필드를 요구한다.
  const recipientSnapshot = {
    recipientName: 'Simple Test',
    phone: '010-3333-4444',
    postalCode: '06236',
    roadAddress: 'Teheran-ro 123',
    detailAddress: '4F',
  };
  const [shipment] = await tx
    .insert(wmsTables.shipments)
    .values({
      warehouseId: warehouse.id,
      status: 'planned',
      recipientSnapshot,
      plannedAt: new Date(),
      shippingProfileId: deliveryProfile.id,
    })
    .returning();
  const [line] = await tx
    .insert(wmsTables.shipmentLines)
    .values({
      shipmentId: shipment.id,
      fulfillmentOrderItemId: item.id,
      skuId: sku.id,
      qty,
      reservedQty: qty,
      inspectedQty: 0,
    })
    .returning();
  await tx.insert(wmsTables.stockReservations).values({
    targetType: 'SHIPMENT_LINE',
    targetId: line.id,
    shipmentLineId: line.id,
    skuId: sku.id,
    warehouseId: warehouse.id,
    quantity: qty,
    status: 'confirmed',
    requestedAt: new Date(),
  });
  const [batch] = await tx
    .insert(wmsTables.outboundBatches)
    .values({
      batchNumber: `SIMPLE-BATCH-${suffix}`,
      warehouseId: warehouse.id,
      pickingMethod: 'individual',
      status: 'created',
    })
    .returning();
  const [workItem] = await tx
    .insert(wmsTables.outboundBatchWorkItems)
    .values({ batchId: batch.id, shipmentId: shipment.id, status: 'queued', leaseVersion: 0 })
    .returning();
  const trackingNo = `SIMPLE-TRACK-${suffix}`;
  const [waybill] = await tx
    .insert(wmsTables.waybills)
    .values({
      shipmentId: shipment.id,
      source: 'manual',
      carrier: 'HANJIN',
      status: 'registered',
      trackingNo,
      manifestVersion: shipment.manifestVersion,
      recipientHash: canonicalFulfillmentRequestHash(recipientSnapshot),
    })
    .returning();

  return {
    actorId,
    warehouseId: warehouse.id,
    holderId: holder.id,
    skuId: sku.id,
    skuCode,
    barcode,
    locationId: location.id,
    ledgerVersion: ledger.version,
    shipmentId: shipment.id,
    shipmentLineId: line.id,
    batchId: batch.id,
    workItemId: workItem.id,
    waybillId: waybill.id,
    trackingNo,
    qty,
  };
}

/**
 * 이미 만들어 둔 (sku, warehouse) 에 대해 **예약을 걸 수 있는 최소 shipment line** 만 심는다.
 *
 * `stock_reservations.shipment_line_id` 가 NOT NULL 이 되고 `target_type` 이
 * `'SHIPMENT_LINE'` 로 좁혀지면서(Task 25 contract), "sku·warehouse 만 만들고 예약을
 * 꽂던" 재고 쪽 통합 스펙들이 컴파일조차 안 되게 됐다. 그 스펙들은 피킹/배치까지
 * 필요하지 않으므로 `seedPickableShipment`(피킹 가능 상태 전부)를 쓰면 과하다 —
 * 그쪽은 confirmed 예약까지 심어서 가용 재고 전제 자체가 달라진다.
 *
 * 여기서는 sales order → fulfillment order → shipment → shipment line 체인만 만들고
 * **예약은 만들지 않는다**. 예약은 각 스펙이 자기 시나리오대로 건다.
 */
export async function seedShipmentLineFor(
  tx: DbTx,
  params: { skuId: string; warehouseId: string; qty: number },
): Promise<string> {
  const suffix = randomUUID();
  const [salesOrder] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `resv-order-${suffix}`,
      salesChannel: 'medusa',
      shippingAddress: {},
      orderDate: new Date(),
    })
    .returning();
  const [salesOrderLine] = await tx
    .insert(wmsTables.salesOrderLines)
    .values({
      salesOrderId: salesOrder.id,
      variantId: randomUUID(),
      productName: 'Reservation fixture product',
      quantity: params.qty,
      channelOrderItemId: `resv-item-${suffix}`,
      channelProductId: `resv-product-${suffix}`,
    })
    .returning();
  const [fulfillmentOrder] = await tx
    .insert(wmsTables.fulfillmentOrders)
    .values({
      salesOrderId: salesOrder.id,
      warehouseId: params.warehouseId,
      status: 'processing',
      totalQty: params.qty,
    })
    .returning();
  const [item] = await tx
    .insert(wmsTables.fulfillmentOrderItems)
    .values({
      fulfillmentOrderId: fulfillmentOrder.id,
      salesOrderId: salesOrder.id,
      salesOrderLineId: salesOrderLine.id,
      skuId: params.skuId,
      qty: params.qty,
      reservedQty: params.qty,
      status: 'processing',
    })
    .returning();
  const [shipment] = await tx
    .insert(wmsTables.shipments)
    .values({
      warehouseId: params.warehouseId,
      status: 'planned',
      // assertRecipientComplete 가 요구하는 다섯 필드.
      recipientSnapshot: {
        recipientName: 'Reservation Fixture',
        phone: '010-0000-0000',
        postalCode: '06236',
        roadAddress: 'Teheran-ro 1',
        detailAddress: '1F',
      },
      plannedAt: new Date(),
    })
    .returning();
  const [line] = await tx
    .insert(wmsTables.shipmentLines)
    .values({
      shipmentId: shipment.id,
      fulfillmentOrderItemId: item.id,
      skuId: params.skuId,
      qty: params.qty,
      reservedQty: params.qty,
      inspectedQty: 0,
    })
    .returning();
  return line.id;
}
