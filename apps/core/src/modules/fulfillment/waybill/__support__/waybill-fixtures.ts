import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../../inventory/schema/inventory.schema';
import { AuditService } from '../../../inventory/shared/services/audit.service';
import {
  makeDbService,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
} from '../../services/__support__';
import { canonicalFulfillmentRequestHash, FulfillmentCommandService } from '../../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../../services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from '../../services/shipment-planning.service';
import type { AllocateResult, CarrierGateway, RegisterOutcome } from '../carrier/carrier-gateway.interface';
import type { WaybillRow } from '../waybill.types';

export const WAYBILL_RECIPIENT = {
  recipientName: '수취인 통합',
  phone: '010-1111-2222',
  postalCode: '01234',
  roadAddress: '서울 종로구 세종대로 1',
  detailAddress: '101',
  deliveryNote: '문앞',
};

// deps.fulfillments = wired.fulfillments, deps.plan 은 wiring 이 노출하지 않는 ShipmentPlanningService 인스턴스를
// 필요로 한다(호출자 = 통합 spec 의 services() 헬퍼, invoice-orchestrator.integration.spec.ts 패턴 미러).
// makeSeedDeps() 가 이 조립을 한 곳에서 제공한다 — 여러 waybill integration spec 이 중복 없이 재사용한다.
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

// Wired(wireLogistics 반환)는 ShipmentPlanningService 를 노출하지 않는다(logistics-wiring.ts 확인됨) —
// invoice-orchestrator.integration.spec.ts 의 services() 헬퍼와 동일하게 로컬 조립한다.
// waybill integration spec 들이 공통으로 재사용하는 SeedDeps 팩토리.
export function makeSeedDeps(db: PostgresJsDatabase<typeof wmsSchema>): SeedDeps {
  const svc = makeDbService(db);
  const wired = wireLogistics(svc, 'v2');
  const workflowGate = new FulfillmentWorkflowGate(
    new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2', FULFILLMENT_V2_CUTOVER_AT: new Date().toISOString() }),
  );
  const commands = new FulfillmentCommandService(svc);
  const invariant = new FulfillmentInvariantService();
  const planning = new ShipmentPlanningService(
    svc,
    commands,
    wired.shipmentReservations,
    invariant,
    new AuditService(svc),
    { getScopesByRoles: () => Promise.resolve(new Set(['master'])) } as never,
    workflowGate,
  );
  return {
    fulfillments: wired.fulfillments,
    plan: (
      id: string,
      opts: { shippingProfileId: string; expectedManifestVersion: number; expectedReservationVersion: number },
      idem: string,
      actor: { id: string; roles: string[] },
      tx: DbTx,
    ) => planning.plan(id, opts, idem, actor, tx),
  } as unknown as SeedDeps;
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

// planned shipment 에 대해 registered→used 운송장 1행을 직접 시드한다(발송 시뮬레이션, Task 7 recall 통합테스트가 재사용).
// tx 는 이 파일의 다른 시드 함수(seedPlannedShipmentForWaybill)와 동일하게 DbTx — 호출자는 db.transaction((tx) =>
// ...(tx as never)) 패턴으로 넘긴다. recipientHash 는 canonicalFulfillmentRequestHash(WAYBILL_RECIPIENT) 로 계산해야
// assertDispatchable 의 recipient 일치 검사를 통과한다(플랜 2 불변식) — waybill.reader.ts#recipientHashOf 가 쓰는
// 것과 동일한 해시 함수(waybill 모듈 canonical import 경로)다.
export async function seedUsedWaybillForShipment(
  tx: DbTx,
  shipmentId: string,
  manifestVersion: number,
  opts: { carrier?: 'HANJIN'; trackingNo?: string } = {},
): Promise<WaybillRow> {
  const [row] = await tx
    .insert(wmsTables.waybills)
    .values({
      shipmentId,
      source: 'manual',
      carrier: opts.carrier ?? 'HANJIN',
      status: 'used',
      trackingNo: opts.trackingNo ?? `used-${randomUUID().slice(0, 8)}`,
      manifestVersion,
      recipientHash: canonicalFulfillmentRequestHash(WAYBILL_RECIPIENT),
    })
    .returning();
  return row;
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
