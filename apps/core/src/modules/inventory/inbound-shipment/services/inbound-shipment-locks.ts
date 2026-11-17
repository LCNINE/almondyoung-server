import { and, eq } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import { DbTx, wmsTables } from '../../schema/inventory.schema';

/**
 * 선적 문서의 잠금 — 순서는 언제나 선적 행 → 상자 행 → (커널: 회차 라인·원장). 두 매니저가 이 한 벌을 쓴다.
 * 커널은 문서 행을 잠그지 않으므로 역방향 간선이 없다(ADR-0039, spec §8.2).
 */
export async function lockInboundShipment(trx: DbTx, shipmentId: string) {
  const [shipment] = await trx
    .select()
    .from(wmsTables.inboundShipments)
    .where(eq(wmsTables.inboundShipments.id, shipmentId))
    .for('update');
  if (!shipment) throw new NotFoundError(`Inbound shipment not found: ${shipmentId}`);
  return shipment;
}

/** 선적 행을 잡은 뒤에만 부른다. 그 선적의 상자가 아니면 404. */
export async function lockInboundShipmentBox(trx: DbTx, shipmentId: string, boxId: string) {
  const [box] = await trx
    .select()
    .from(wmsTables.inboundShipmentBoxes)
    .where(and(eq(wmsTables.inboundShipmentBoxes.id, boxId), eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId)))
    .for('update');
  if (!box) throw new NotFoundError(`Inbound shipment box not found: ${boxId}`);
  return box;
}
