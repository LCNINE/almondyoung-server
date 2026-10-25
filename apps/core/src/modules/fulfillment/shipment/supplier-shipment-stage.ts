import type { ShipmentStatus } from './shipment-transitions';

/**
 * 입점사 상자의 단계 — 단 하나의 정의 (K3 PR4, N6). 입점사 상자 = `shipments.supplier_id IS NOT NULL`(`shipment-owner.ts`).
 *   pending   = draft, 넘김 묶음 없음(`supplier_handoff_id IS NULL`) — 아직 입점사에게 안 넘겼다
 *   forwarded = draft 또는 recovery_required, 넘김 묶음 있음 — 넘겼을 뿐 발송이 아니다(되돌리는 중인 상자도 여기)
 *   shipped   = shipped — 입점사가 발송했다. 배송완료 감지가 없어 그 뒤 단계는 없다(스펙 §4.6)
 *   null      = canceled·superseded — 단계가 없다(셀 대상이 아니다)
 * 그 밖(planned·in_transit·delivered·failed, 넘김 없는 recovery_required)은 입점사 상자가 타지 않는 전이라 Error 다
 * (스펙 §4.4 — 입점사 상자는 draft → shipped → recovery_required(DISPATCH_RECALL_PENDING) → draft 만 쓰고, 발송 전엔 넘긴다).
 *
 * 같은 술어를 SQL 로 쓰는 곳 — 술어를 바꾸면 함께 바꾼다:
 *   - `sales-order/line-quantities/line-quantities.sql.ts` 의 K6 수량 사실(`forwarded`·`partner_completed`)
 *   - `fulfillment/order-progress/order-progress.judge-sql.ts` 의 정체 보드 입점사 상자 판정
 *   - `channel-order-change.reader.ts` 의 채널 주소 변경 거절(넘긴 열린 입점사 상자)
 *   - 직배 목록 읽기(`SupplierShipmentQueueReader`)의 대기·넘김 상자
 */
export type SupplierShipmentStage = 'pending' | 'forwarded' | 'shipped';

export function supplierShipmentStage(box: {
  id: string;
  status: ShipmentStatus;
  supplierHandoffId: string | null;
}): SupplierShipmentStage | null {
  const forwarded = box.supplierHandoffId !== null;
  switch (box.status) {
    case 'canceled':
    case 'superseded':
      return null;
    case 'shipped':
      return 'shipped';
    case 'draft':
      return forwarded ? 'forwarded' : 'pending';
    case 'recovery_required':
      if (forwarded) return 'forwarded';
      break;
    case 'planned':
    case 'in_transit':
    case 'delivered':
    case 'failed':
      break;
  }
  throw new Error(
    `Supplier shipment ${box.id} has status ${box.status} (handoff ${box.supplierHandoffId ?? 'none'}) outside the supplier lifecycle`,
  );
}
