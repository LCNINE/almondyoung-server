import { eq } from 'drizzle-orm';
import { ShipmentPlanningService } from '../../../apps/core/src/modules/fulfillment/services/shipment-planning.service';
import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS } from './constants';

/**
 * 시드 작업자 신원. core 는 operator_id 에 FK 를 걸지 않으므로 (스펙 §4.4)
 * 고정 UUID 를 써도 무방하고, 결정론 규약상 그래야 한다. 이 파일이 쓰는 UUID 접두(019d0008)의
 * 전체 할당 목록은 constants.ts 상단 레지스트리 참고.
 */
export const SEED_ACTOR = { id: '019d0008-0001-7000-a000-000000000001', roles: ['master'] };

/**
 * 앞쪽 절반만 planned 로 올려 draft/planned 두 상태를 모두 남긴다.
 *
 * planned 가 된 id 를 돌려주는 이유: 이어지는 `seedOutboundReady` 가 정확히 이 집합에만 배치·
 * 운송장을 붙여야 하는데, 호출자가 같은 slice 를 다시 계산하면 두 곳이 갈라질 수 있다.
 */
export async function planShipments(
  planning: ShipmentPlanningService,
  shipmentIds: string[],
  tx: DbTx,
): Promise<string[]> {
  const target = shipmentIds.slice(0, Math.floor(shipmentIds.length / 2));
  await planEach(planning, target, 'dev-seed-plan', tx);
  return target;
}

/** 넘긴 shipment 를 전부 planned 로 올린다. 멱등 키는 `${keyPrefix}-000N` — 결정론 규약. */
export async function planEach(
  planning: ShipmentPlanningService,
  shipmentIds: string[],
  keyPrefix: string,
  tx: DbTx,
): Promise<void> {
  for (const [index, shipmentId] of shipmentIds.entries()) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    await planning.plan(
      shipmentId,
      {
        shippingProfileId: SEED_IDS.deliveryProfile,
        expectedManifestVersion: shipment.manifestVersion,
        expectedReservationVersion: shipment.reservationVersion,
      },
      `${keyPrefix}-${String(index + 1).padStart(4, '0')}`,
      SEED_ACTOR,
      tx,
    );
  }
}
