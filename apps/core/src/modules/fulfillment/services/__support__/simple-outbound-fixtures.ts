import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { PickableShipmentFixture, seedPickableShipment, seedShipmentForExistingStock } from './logistics-fixtures';

/**
 * seedPickableShipment 의 shipment 에 두 번째 SKU 라인을 덧붙인다 — settleIfFullyPicked 의
 * "라인 A 는 다 찼지만 라인 B 는 아직 → null(미완료)" 분기(리뷰 지적 6)는 라인이 하나뿐인
 * 픽스처로는 절대 밟히지 않는다. 공유 픽스처(seedPickableShipment)는 다른 스펙이 그 모양에
 * 기대므로 건드리지 않고, shipment-dispatch.integration.spec 의 addParallelShipmentLine 을
 * 모델로 이 스펙 안에서만 만든다. 서로 다른 SKU/바코드를 써서 두 스캔이 서로 다른 라인의
 * allocation 만 채우도록 한다(같은 SKU 였다면 한 스캔이 두 라인에 걸쳐 분배될 수 있어
 * 이 테스트가 검증하려는 "라인 하나만 완료" 상태를 결정적으로 만들 수 없다).
 */
export async function addSecondSimpleOutboundLine(
  tx: DbTx,
  fixture: PickableShipmentFixture,
  qty: number,
): Promise<{ skuId: string; barcode: string; shipmentLineId: string }> {
  const [existingLine] = await tx
    .select({ fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId })
    .from(wmsTables.shipmentLines)
    .where(eq(wmsTables.shipmentLines.id, fixture.shipmentLineId))
    .limit(1);
  const [existingItem] = await tx
    .select({
      fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
      salesOrderId: wmsTables.fulfillmentOrderItems.salesOrderId,
    })
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.id, existingLine.fulfillmentOrderItemId))
    .limit(1);
  // fulfillment_order_items.sales_order_id 는 nullable 이지만 sales_order_lines 는
  // NOT NULL 이다. 픽스처가 만든 항목이라 항상 있어야 하고, 없으면 픽스처가 깨진 것이다.
  const existingSalesOrderId = existingItem.salesOrderId;
  if (!existingSalesOrderId) {
    throw new Error('픽스처의 fulfillment_order_item 에 sales_order_id 가 없다');
  }
  const [shipment] = await tx
    .select({ shippingProfileId: wmsTables.shipments.shippingProfileId })
    .from(wmsTables.shipments)
    .where(eq(wmsTables.shipments.id, fixture.shipmentId))
    .limit(1);

  const suffix = randomUUID();
  const [sku] = await tx
    .insert(wmsTables.skus)
    .values({
      name: 'Simple SKU (second line)',
      code: `SIMPLE2-${suffix}`,
      holderId: fixture.holderId,
      // 배치 시작(assertStartEligibility)은 라인의 delivery profile 이 shipment 의 shippingProfileId 와
      // 같아야 한다 — 원 라인과 같은 profile 을 그대로 물려받는다.
      deliveryProfileId: shipment.shippingProfileId,
    })
    .returning();
  const barcode = `881${suffix.replaceAll('-', '').slice(0, 10)}`;
  await tx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
  await tx.insert(wmsTables.stockLedgers).values({
    skuId: sku.id,
    warehouseId: fixture.warehouseId,
    locationId: fixture.locationId,
    stockState: 'ON_HAND',
    qty,
  });

  const [salesOrderLine] = await tx
    .insert(wmsTables.salesOrderLines)
    .values({
      salesOrderId: existingSalesOrderId,
      variantId: randomUUID(),
      productName: 'Simple product (second line)',
      quantity: qty,
      channelOrderItemId: `simple-item-2-${suffix}`,
      channelProductId: `simple-product-2-${suffix}`,
    })
    .returning();
  const [item] = await tx
    .insert(wmsTables.fulfillmentOrderItems)
    .values({
      fulfillmentOrderId: existingItem.fulfillmentOrderId,
      salesOrderId: existingSalesOrderId,
      salesOrderLineId: salesOrderLine.id,
      skuId: sku.id,
      qty,
      reservedQty: qty,
      status: 'processing',
    })
    .returning();
  const [line] = await tx
    .insert(wmsTables.shipmentLines)
    .values({
      shipmentId: fixture.shipmentId,
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
    warehouseId: fixture.warehouseId,
    quantity: qty,
    status: 'confirmed',
    requestedAt: new Date(),
  });

  return { skuId: sku.id, barcode, shipmentLineId: line.id };
}

/**
 * 같은 배치·같은 SKU·같은 위치에 박스 두 개. 두 번째 박스는 첫 박스의 재고 위에 만들고 작업 항목을
 * 첫 배치로 옮긴다(seedShipmentForExistingStock 은 박스마다 배치를 새로 만든다 — 그 빈 배치는 정리 때 지운다).
 */
export async function seedTwoBoxBatch(
  tx: DbTx,
  secondQty = 3,
  stockQty = 5,
): Promise<{ first: PickableShipmentFixture; second: PickableShipmentFixture }> {
  const first = await seedPickableShipment(tx, 2);
  await tx
    .update(wmsTables.stockLedgers)
    .set({ qty: stockQty })
    .where(and(eq(wmsTables.stockLedgers.skuId, first.skuId), eq(wmsTables.stockLedgers.locationId, first.locationId)));
  const second = await seedBoxOverSameStock(tx, first, secondQty);
  await tx
    .update(wmsTables.outboundBatchWorkItems)
    .set({ batchId: first.batchId })
    .where(eq(wmsTables.outboundBatchWorkItems.id, second.workItemId));
  return { first, second };
}

/**
 * `base` 와 같은 SKU·위치·창고·배송 프로필 위에 박스 하나를 더 만든다. 재고 행은 만들지 않는다.
 * 새 박스는 자기 배치(queued 작업 항목 하나)에 들어간다 — 정리는 `cleanupPreparationFixture(tx, base, [box])`.
 */
export async function seedBoxOverSameStock(
  tx: DbTx,
  base: PickableShipmentFixture,
  qty: number,
): Promise<PickableShipmentFixture> {
  const [profile] = await tx
    .select({ id: wmsTables.shipments.shippingProfileId })
    .from(wmsTables.shipments)
    .where(eq(wmsTables.shipments.id, base.shipmentId));
  if (!profile?.id) throw new Error('base box has no shipping profile');
  return seedShipmentForExistingStock(
    tx,
    {
      actorId: base.actorId,
      warehouseId: base.warehouseId,
      holderId: base.holderId,
      skuId: base.skuId,
      skuCode: base.skuCode,
      barcode: base.barcode,
      locationId: base.locationId,
      ledgerVersion: base.ledgerVersion,
      deliveryProfileId: profile.id,
    },
    qty,
  );
}

/**
 * 어느 배치에도 없는 `planned` 박스 — 합류 대상. `base` 와 같은 SKU·위치·배송 프로필 위에 만들고 자기 작업 항목을 지운다
 * (seedShipmentForExistingStock 이 만든 빈 배치는 남는다 — 롤백 스펙이면 상관없고, 커밋 스펙은
 * `cleanupPreparationFixture(tx, base, [box])` 가 그 배치까지 지운다).
 */
export async function seedLooseBox(
  tx: DbTx,
  base: PickableShipmentFixture,
  qty: number,
): Promise<PickableShipmentFixture> {
  const box = await seedBoxOverSameStock(tx, base, qty);
  await tx.delete(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
  return box;
}
