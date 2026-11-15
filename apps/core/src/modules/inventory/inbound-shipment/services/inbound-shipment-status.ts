import { eq } from 'drizzle-orm';
import { DbTx, InboundShipment, wmsTables } from '../../schema/inventory.schema';
import { deriveShipmentStatus } from './inbound-shipment.rules';

/**
 * 상자가 바뀐 뒤(확정·확정 취소·확정 뒤 처분 바꾸기) 선적 상태를 상자로 다시 정한다 (spec §8.4).
 * 선적 행을 잡은 뒤에만 부른다. 저절로 닫히면 사유 없이 `closed_at/by` 를 찍고, 닫힘이 아니면 `closed_*` 를
 * 비운다 — 사람이 닫았던 선적도 확정 취소가 다시 연다. 사람이 닫은 상태를 지켜야 하는 호출자는 부르지 않는다.
 */
export async function refreshInboundShipmentStatus(
  trx: DbTx,
  shipmentId: string,
  current: InboundShipment['status'],
  actorId: string,
  now: Date,
): Promise<InboundShipment['status']> {
  const boxes = await trx
    .select({
      disposition: wmsTables.inboundShipmentBoxes.disposition,
      status: wmsTables.inboundShipmentBoxes.status,
    })
    .from(wmsTables.inboundShipmentBoxes)
    .where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
  const status = deriveShipmentStatus(current, boxes, false);
  await trx
    .update(wmsTables.inboundShipments)
    .set(
      status === 'closed'
        ? { status, closedAt: now, closedBy: actorId, closedReason: null, updatedAt: now }
        : { status, closedAt: null, closedBy: null, closedReason: null, updatedAt: now },
    )
    .where(eq(wmsTables.inboundShipments.id, shipmentId));
  return status;
}
