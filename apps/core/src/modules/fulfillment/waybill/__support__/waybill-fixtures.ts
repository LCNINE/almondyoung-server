import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { seedHolder, seedMatching, seedSalesOrder, seedSku, seedWarehouseWithZone } from '../../services/__support__';
import type { AllocateResult, CarrierGateway, RegisterOutcome } from '../carrier/carrier-gateway.interface';

export const WAYBILL_RECIPIENT = {
  recipientName: '수취인 통합',
  phone: '010-1111-2222',
  postalCode: '01234',
  roadAddress: '서울 종로구 세종대로 1',
  detailAddress: '101',
  deliveryNote: '문앞',
};

// deps.fulfillments = wired.fulfillments, deps.plan 은 wiring 이 노출하지 않는 ShipmentPlanningService 인스턴스를
// 호출자가 별도 구성해 넘긴다(호출자 = 통합 spec 의 services() 헬퍼, invoice-orchestrator.integration.spec.ts 패턴 미러).
export interface SeedDeps {
  fulfillments: { create(args: { salesOrderId: string; warehouseId: string }, tx: DbTx): Promise<unknown> };
  plan(
    shipmentId: string,
    opts: { shippingProfileId: string; expectedManifestVersion: number; expectedReservationVersion: number },
    idem: string,
    actor: { id: string; roles: string[] },
    tx: DbTx,
  ): Promise<{ shipment: { shipmentId: string; manifestVersion: number; recipientSnapshot: unknown } }>;
}

export async function seedPlannedShipmentForWaybill(tx: DbTx, deps: SeedDeps) {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const { skuId } = await seedSku(tx, holderId);
  const [profile] = await tx
    .insert(wmsTables.deliveryProfiles)
    .values({
      name: `waybill-profile-${randomUUID()}`,
      sourceType: 'in_house',
      senderSnapshot: { name: 'Sender', phone: '02-0000-0000' },
      originAddressSnapshot: { address: 'Origin' },
      returnAddressSnapshot: { address: 'Return' },
      carrierAccountRef: 'n/a',
      supportedFulfillmentModes: ['in_house'],
    })
    .returning();
  await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, skuId));
  await tx.insert(wmsTables.stockLedgers).values({ skuId, warehouseId, locationId, stockState: 'ON_HAND', qty: 2 });
  const variantId = randomUUID();
  const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
    lines: [{ variantId, quantity: 2, productName: '아몬드유 30입' }],
  });
  await tx
    .update(wmsTables.salesOrders)
    .set({ shippingAddress: WAYBILL_RECIPIENT })
    .where(eq(wmsTables.salesOrders.id, salesOrderId));
  // seedSalesOrder 는 salesChannel: 'medusa' 를 신뢰 채널로 심는다 — assertTrustedExternalLineIdentity(plan) 가
  // channelOrderItemId 를 요구하므로(invoice-orchestrator.integration.spec.ts 133-136 미러) 여기서도 채운다.
  await tx
    .update(wmsTables.salesOrderLines)
    .set({ channelOrderItemId: `item-${randomUUID()}`, channelProductId: `product-${randomUUID()}` })
    .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
  await seedMatching(tx, { variantId, skuId });
  await deps.fulfillments.create({ salesOrderId, warehouseId }, tx);
  const [line] = await tx
    .select()
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId))
    .then((rows) => rows.map((r) => r.shipment_lines));
  const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, line.shipmentId));
  const planned = await deps.plan(
    shipment.id,
    {
      shippingProfileId: profile.id,
      expectedManifestVersion: shipment.manifestVersion,
      expectedReservationVersion: shipment.reservationVersion,
    },
    `plan-${randomUUID()}`,
    { id: randomUUID(), roles: ['master'] },
    tx,
  );
  return {
    // ShipmentPlanningService.snapshot() 는 `shipmentId` 필드를 쓴다(`id` 아님) — invoice-orchestrator.integration.spec.ts
    // 의 fixture.shipment.shipmentId 사용과 동일.
    shipmentId: planned.shipment.shipmentId,
    warehouseId,
    skuId,
    salesOrderLineId: lineIds[0],
    manifestVersion: planned.shipment.manifestVersion,
    recipientSnapshot: planned.shipment.recipientSnapshot,
  };
}

export function fakeCarrierGateway(over: Partial<CarrierGateway> = {}): CarrierGateway {
  return {
    carrier: 'HANJIN',
    isConfigured: () => true,
    capabilities: { allocatesExternally: true, registersSeparately: true, canTrack: true, canCancel: false },
    allocate: (): Promise<AllocateResult> =>
      Promise.resolve({ waybillNo: `WBL-${randomUUID().slice(0, 10)}`, labelData: { s_tml_cod: 'x' } }),
    register: (): Promise<RegisterOutcome> => Promise.resolve({ kind: 'registered' }),
    ...over,
  } as CarrierGateway;
}
