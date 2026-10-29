import { completedSetUnits } from '../line-quantities/line-sales-units';
import type { LineQuantities } from '../line-quantities/line-quantities.reader';
import type { CustomerReturnKind, CustomerReturnStatus } from '../customer-return/customer-return.types';
import type { ParcelClaimEligibility } from '../line-quantities/parcel-claim-eligibility.reader';

/** Medusa 줄(`channel_order_item_id`) 하나의 배송 사실. 반품·교환으로 빠진 수량은 빼지 않는다 — 그건 Medusa 가 자기 장부로 뺀다. */
export interface ReturnEligibilityLine {
  channelOrderItemId: string;
  deliveredUnits: number;
  /** ISO 문자열. 배송완료 소포가 없으면 null. */
  lastDeliveredAt: string | null;
  /**
   * 교환할 수 있는 줄인가 = 인쇄 줄(`almond_design_id`)이 아니다(K8 PR11b N1). 인쇄 상품은 같은 것을 다시 만들어 보낼 수 없다.
   * 반품 가능 수량(`deliveredUnits`)과는 무관하다 — 인쇄 상품 «반품»은 그대로 된다
   */
  exchangeable: boolean;
}

/**
 * 그 주문의 반품 예정 기록 하나. Medusa 반품 취소가 «창고에 도착했는가»를 묻는 데 쓴다(K8 PR6 N11).
 * 교환(K8 PR11 N17)이면 «교환 상자가 열렸는가»도 — 열린 교환은 Medusa 가 취소를 거절한다.
 */
export interface ReturnEligibilityCustomerReturn {
  channelReturnId: string;
  status: CustomerReturnStatus;
  kind: CustomerReturnKind;
  /** `exchange_released_at` 가 있다. 반품이면 언제나 false */
  exchangeReleased: boolean;
}

export interface ReturnEligibilityResponse {
  found: boolean;
  lines: ReturnEligibilityLine[];
  /** 그 주문의 반품 예정 기록 전부(취소 포함). `found: false` 면 빈 배열. */
  customerReturns: ReturnEligibilityCustomerReturn[];
}

/**
 * 줄별 배송완료 판매 단위와 마지막 배송완료 시각을 조립한다. 순수 함수 — 산술은 `completedSetUnits` 에 맡긴다.
 * `claimable` 이 아니라 `delivered` 를 쓴다: 청구 차감은 Medusa 가 하므로 여기서 또 빼면 이중 차감이다.
 * 채널 줄 id 가 없는 줄은 Medusa 가 가리킬 수 없어 뺀다. 순서는 입력 순.
 */
export function toReturnEligibilityLines(
  lines: Array<{ channelOrderItemId: string | null; almondDesignId: string | null; quantities: LineQuantities }>,
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
        exchangeable: line.almondDesignId === null,
      },
    ];
  });
}

/**
 * 고객 actions 의 [교환] 판정(K8 PR11b N4) — 청구 가능한(claimable > 0) 소포 중 인쇄 줄이 아닌 것이 하나라도 있는가.
 * 자격 API 의 `exchangeable` 과 같은 기준(인쇄 줄 = `almond_design_id` 있음)이라 버튼과 Medusa 거절이 갈리지 않는다.
 */
export function hasExchangeableParcel(
  parcels: Array<{ salesOrderLineId: string; claimable: number }>,
  printLineIds: ReadonlySet<string>,
): boolean {
  return parcels.some((parcel) => parcel.claimable > 0 && !printLineIds.has(parcel.salesOrderLineId));
}
