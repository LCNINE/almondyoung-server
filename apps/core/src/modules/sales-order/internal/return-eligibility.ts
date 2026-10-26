import { completedSetUnits } from '../line-quantities/line-sales-units';
import type { LineQuantities } from '../line-quantities/line-quantities.reader';
import type { ParcelClaimEligibility } from '../line-quantities/parcel-claim-eligibility.reader';

/** Medusa 줄(`channel_order_item_id`) 하나의 배송 사실. 반품·교환으로 빠진 수량은 빼지 않는다 — 그건 Medusa 가 자기 장부로 뺀다. */
export interface ReturnEligibilityLine {
  channelOrderItemId: string;
  deliveredUnits: number;
  /** ISO 문자열. 배송완료 소포가 없으면 null. */
  lastDeliveredAt: string | null;
}

export interface ReturnEligibilityResponse {
  found: boolean;
  lines: ReturnEligibilityLine[];
}

/**
 * 줄별 배송완료 판매 단위와 마지막 배송완료 시각을 조립한다. 순수 함수 — 산술은 `completedSetUnits` 에 맡긴다.
 * `claimable` 이 아니라 `delivered` 를 쓴다: 청구 차감은 Medusa 가 하므로 여기서 또 빼면 이중 차감이다.
 * 채널 줄 id 가 없는 줄은 Medusa 가 가리킬 수 없어 뺀다. 순서는 입력 순.
 */
export function toReturnEligibilityLines(
  lines: Array<{ channelOrderItemId: string | null; quantities: LineQuantities }>,
  parcels: ParcelClaimEligibility[],
): ReturnEligibilityLine[] {
  const lastDeliveredAtByLine = new Map<string, Date>();
  for (const parcel of parcels) {
    const current = lastDeliveredAtByLine.get(parcel.salesOrderLineId);
    if (current === undefined || parcel.deliveredAt > current) {
      lastDeliveredAtByLine.set(parcel.salesOrderLineId, parcel.deliveredAt);
    }
  }
  return lines.flatMap((line) => {
    if (line.channelOrderItemId === null) return [];
    return [
      {
        channelOrderItemId: line.channelOrderItemId,
        deliveredUnits: completedSetUnits(line.quantities, (sku) => sku.delivered),
        lastDeliveredAt: lastDeliveredAtByLine.get(line.quantities.salesOrderLineId)?.toISOString() ?? null,
      },
    ];
  });
}
