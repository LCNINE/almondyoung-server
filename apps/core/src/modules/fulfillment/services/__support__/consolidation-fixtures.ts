import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { FULFILLMENT_SCOPE } from '../../../../platform/auth/fulfillment-scopes';
import { DbTx, wmsSchema, wmsTables } from '../../../inventory/schema/inventory.schema';
import { AuditService } from '../../../inventory/shared/services/audit.service';
import { ConsolidationService } from '../consolidation.service';
import { canonicalFulfillmentRequestHash, FulfillmentCommandService } from '../fulfillment-command.service';
import { FulfillmentInvariantService } from '../fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../fulfillment-workflow-gate.service';
import { seedHolder, seedMatching, seedSalesOrder, seedSku, seedWarehouseWithZone } from './logistics-fixtures';
import { Wired } from './logistics-wiring';

/** 합포장 통합 스펙 공용 픽스처 — consolidation.integration.spec 과 리컨실러 25번 스펙이 같이 쓴다 */
export const CONSOLIDATION_RECIPIENT = {
  recipientName: 'Consolidation Customer',
  phone: '010-1111-2222',
  postalCode: '01234',
  roadAddress: 'Seoul test road 1',
  detailAddress: '101',
};

export function makeConsolidationService(
  dbService: DbService<typeof wmsSchema>,
  wired: Wired,
  mode: 'v2' | 'maintenance' = 'v2',
): ConsolidationService {
  return new ConsolidationService(
    dbService,
    new FulfillmentCommandService(dbService),
    wired.shipmentReservations,
    new FulfillmentInvariantService(),
    new AuditService(dbService),
    {
      getScopesByRoles: () =>
        Promise.resolve(
          new Set([
            FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE,
            FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT,
            FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
          ]),
        ),
    } as never,
    new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: mode })),
  );
}

export type ConsolidationBase = Awaited<ReturnType<typeof consolidationBase>>;
export async function consolidationBase(tx: DbTx, onHand = 100) {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const { skuId } = await seedSku(tx, holderId);
  const [profile] = await tx
    .insert(wmsTables.deliveryProfiles)
    .values({
      name: `consolidation-profile-${randomUUID()}`,
      sourceType: 'in_house',
      supportedFulfillmentModes: ['in_house'],
    })
    .returning();
  await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, skuId));
  await tx.insert(wmsTables.stockLedgers).values({
    skuId,
    warehouseId,
    locationId,
    stockState: 'ON_HAND',
    qty: onHand,
  });
  return { warehouseId, skuId, profileId: profile.id };
}

export type ConsolidationSource = Awaited<ReturnType<typeof createConsolidationSource>>;
export async function createConsolidationSource(
  tx: DbTx,
  wired: Wired,
  base: ConsolidationBase,
  options: {
    quantity: number;
    customerId: string;
    recipient?: typeof CONSOLIDATION_RECIPIENT;
    salesChannel?: 'medusa' | 'naver' | 'coupang';
    entrancePassword?: string;
    orderDate?: Date;
  },
) {
  const variantId = randomUUID();
  const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
    lines: [{ variantId, quantity: options.quantity }],
  });
  await tx
    .update(wmsTables.salesOrders)
    .set({
      salesChannel: options.salesChannel ?? 'medusa',
      customerId: options.customerId,
      customerName: 'Consolidation Customer',
      customerPhone: '010-1111-2222',
      shippingAddress: options.recipient ?? CONSOLIDATION_RECIPIENT,
      // 비번은 스냅샷 밖의 전용 슬롯이다 — FO 생성이 여기서 상자 사본을 뜬다.
      ...(options.entrancePassword ? { entrancePassword: options.entrancePassword } : {}),
      ...(options.orderDate ? { orderDate: options.orderDate } : {}),
    })
    .where(eq(wmsTables.salesOrders.id, salesOrderId));
  await tx
    .update(wmsTables.salesOrderLines)
    .set({ channelOrderItemId: `item-${randomUUID()}`, channelProductId: `product-${randomUUID()}` })
    .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
  await seedMatching(tx, { variantId, skuId: base.skuId });
  await wired.fulfillments.create({ salesOrderId, warehouseId: base.warehouseId }, tx);
  const [row] = await tx
    .select({
      fulfillmentOrderId: wmsTables.fulfillmentOrders.id,
      fulfillmentOrderItemId: wmsTables.fulfillmentOrderItems.id,
      shipmentLineId: wmsTables.shipmentLines.id,
      shipmentId: wmsTables.shipments.id,
    })
    .from(wmsTables.fulfillmentOrders)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, wmsTables.fulfillmentOrders.id),
    )
    .innerJoin(
      wmsTables.shipmentLines,
      eq(wmsTables.shipmentLines.fulfillmentOrderItemId, wmsTables.fulfillmentOrderItems.id),
    )
    .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
    .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
  const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, row.shipmentId));
  const [line] = await tx
    .select()
    .from(wmsTables.shipmentLines)
    .where(eq(wmsTables.shipmentLines.id, row.shipmentLineId));
  return { salesOrderId, ...row, shipment, line };
}

export function consolidationSources(...fixtures: ConsolidationSource[]) {
  return fixtures.map((fixture) => ({
    shipmentId: fixture.shipment.id,
    expectedManifestVersion: fixture.shipment.manifestVersion,
    expectedReservationVersion: fixture.shipment.reservationVersion,
  }));
}

/**
 * 원본 둘을 합포장하려는데 첫 원본에 살아 있는 송장이 있어 CONSOLIDATION_PENDING 으로 멈춘 상태(#1016 25번이 보는 상황).
 * 송장을 취소하면 막힘이 풀리지만 재개를 부르는 곳이 없다.
 */
export async function pendingConsolidationBlockedByWaybill(
  tx: DbTx,
  wired: Wired,
  consolidation: ConsolidationService,
  customerId: string = randomUUID(),
) {
  const base = await consolidationBase(tx);
  const first = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
  const second = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
  await tx.update(wmsTables.shipments).set({ status: 'planned' }).where(eq(wmsTables.shipments.id, first.shipment.id));
  const [waybill] = await tx
    .insert(wmsTables.waybills)
    .values({
      shipmentId: first.shipment.id,
      source: 'manual',
      carrier: 'HANJIN',
      status: 'registered',
      trackingNo: `consolidation-waybill-${randomUUID()}`,
      manifestVersion: first.shipment.manifestVersion,
      recipientHash: canonicalFulfillmentRequestHash(first.shipment.recipientSnapshot),
    })
    .returning();
  const pending = await consolidation.consolidate(
    {
      sources: consolidationSources(first, second),
      recipientSourceShipmentId: first.shipment.id,
      reason: 'wait for waybill void',
    },
    `pending-consolidation-${randomUUID()}`,
    { id: randomUUID(), roles: ['logistics_manager'] },
    tx,
  );
  const voidWaybill = () =>
    tx
      .update(wmsTables.waybills)
      .set({ status: 'voided', voidedAt: new Date() })
      .where(eq(wmsTables.waybills.id, waybill.id));
  return { base, first, second, operationId: pending.operationId, voidWaybill };
}
