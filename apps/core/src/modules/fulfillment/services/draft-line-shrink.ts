import { DbTx } from '../../inventory/schema/inventory.schema';
import { selectConfirmedReservationQtyByLine, ShipmentLineRow, ShipmentRow } from './shipment-aggregate';
import type { ShipmentReservationService } from './shipment-reservation.service';
import type { ManifestWriter } from '../shipment/shipment-manifest-edit';

export function confirmedReservationReleaseForCancellation(
  lineQty: number,
  confirmedQty: number,
  cancelQty: number,
): number {
  return Math.max(0, cancelQty - (lineQty - confirmedQty));
}

/**
 * 작성 중 박스의 줄을 줄인다 — 남는 줄 수량을 넘는 확정 예약만 먼저 놓고, 줄을 줄이거나 통째로 빠지는 줄은 묘비 박스로
 * 옮긴다(줄 수량 0 은 CHECK 가 막는다). FO 항목은 건드리지 않는다: 고객 취소는 canceledQty 를, 구성 변경은 qty 를 줄이고
 * 그 차이가 «고객 취소»로 읽히느냐를 가른다(#1063 스펙 §6.3). 박스 상태는 호출자 몫이고, manifestVersion·recompute 는
 * 구성 편집의 문(`editShipmentManifest`)이 끝맺음에서 한다 — 그래서 문이 준 쓰기 도구로만 줄을 바꾼다.
 * 예약 해제(releasePartial)가 불변식을 검사하므로 줄·FO 항목을 바꾸기 전에 끝낸다.
 */
export async function shrinkDraftLines(
  reservations: ShipmentReservationService,
  writer: ManifestWriter,
  input: {
    shipment: ShipmentRow;
    lines: ReadonlyArray<{ line: ShipmentLineRow; qty: number }>;
    reason: string;
    actorId: string;
    wholeShipment: boolean;
  },
  tx: DbTx,
): Promise<{ tombstone: ShipmentRow | null }> {
  const confirmed = await selectConfirmedReservationQtyByLine(
    tx,
    input.lines.map((entry) => entry.line.id),
  );
  for (const { line, qty } of input.lines) {
    const releaseQty = confirmedReservationReleaseForCancellation(line.qty, confirmed.get(line.id) ?? 0, qty);
    if (releaseQty > 0) await reservations.releasePartial(line.id, releaseQty, input.reason, tx);
  }
  // 박스 전체를 비우는 취소는 줄을 옮기지 않고 박스째 canceled 로 둔다(호출자가 상태를 바꾼다)
  if (input.wholeShipment) return { tombstone: null };

  let tombstone: ShipmentRow | null = null;
  if (input.lines.some(({ line, qty }) => qty === line.qty)) {
    // 묘비 상자는 **의도적으로 비번을 안 받는다.** 송장을 발행하지 않고 배송되지도 않으므로 실을 이유가 없고,
    // 실으면 배송 완료 파기가 영영 도달하지 않는 사본이 하나 더 생긴다(백스톱 배치만 남는다).
    tombstone = await writer.createShipment({
      warehouseId: input.shipment.warehouseId,
      status: 'canceled',
      shippingProfileId: input.shipment.shippingProfileId,
      recipientSnapshot: input.shipment.recipientSnapshot,
      entrancePassword: null,
      openedBy: input.actorId,
      openedAt: new Date(),
    });
  }
  for (const { line, qty } of input.lines) {
    if (qty === line.qty && tombstone) {
      await writer.moveLine(line.id, input.shipment.id, tombstone.id);
    } else {
      await writer.setLineQty(line.id, input.shipment.id, line.qty - qty);
    }
  }
  return { tombstone };
}
