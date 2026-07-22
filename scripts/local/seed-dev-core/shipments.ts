import { eq } from 'drizzle-orm';
import { ShipmentPlanningService } from '../../../apps/core/src/modules/fulfillment/services/shipment-planning.service';
import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS } from './constants';

/**
 * 시드 작업자 신원. core 는 operator_id 에 FK 를 걸지 않으므로 (스펙 §4.4)
 * 고정 UUID 를 써도 무방하고, 결정론 규약상 그래야 한다.
 */
export const SEED_ACTOR = { id: '019d0008-0001-7000-a000-000000000001', roles: ['master'] };

/** 앞쪽 절반만 planned 로 올려 draft/planned 두 상태를 모두 남긴다. */
export async function planShipments(planning: ShipmentPlanningService, shipmentIds: string[], tx: DbTx): Promise<void> {
  const target = shipmentIds.slice(0, Math.floor(shipmentIds.length / 2));

  for (const [index, shipmentId] of target.entries()) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    await planning.plan(
      shipmentId,
      {
        shippingProfileId: SEED_IDS.deliveryProfile,
        expectedManifestVersion: shipment.manifestVersion,
        expectedReservationVersion: shipment.reservationVersion,
      },
      `dev-seed-plan-${String(index + 1).padStart(4, '0')}`,
      SEED_ACTOR,
      tx,
    );
  }
}
