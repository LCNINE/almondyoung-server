/**
 * 반품 사유·거절 문구 표. 정본은 Medusa(`apps/medusa/src/workflows/orders/returns/`)이고
 * `scripts/storefront/medusa-return-parity.spec.ts` 가 소스 텍스트로 대조한다 — 한쪽만 고치면 그 스펙이 빨개진다.
 *
 * 키 문자열은 네임스페이스 `mypage.order.returnRequest` 기준 상대 경로다
 * (`useTranslations("mypage.order.returnRequest")` 로 부른다).
 */

/** 고객이 고를 수 있는 사유 — Medusa `customerSelectable: true` 행과 같은 값·순서·부담 주체. */
export const CUSTOMER_RETURN_REASONS: ReadonlyArray<{ value: string; feeBearer: "customer" | "seller" }> = [
  { value: "change_of_mind", feeBearer: "customer" },
  { value: "defective", feeBearer: "seller" },
  { value: "not_as_described", feeBearer: "seller" },
  { value: "wrong_item", feeBearer: "seller" },
  { value: "damaged_in_shipping", feeBearer: "seller" },
]

/** 사유 이름 — CS 가 접수한 `other` 도 반품 칸에 보이므로 Medusa 여섯 전부. */
export const RETURN_REASON_LABEL_KEYS: Record<string, string> = {
  change_of_mind: "reason.changeOfMind",
  defective: "reason.defective",
  not_as_described: "reason.notAsDescribed",
  wrong_item: "reason.wrongItem",
  damaged_in_shipping: "reason.damagedInShipping",
  other: "reason.other",
}

/** Medusa `ReturnRejectReason` 전부. */
export const RETURN_REJECT_MESSAGE_KEYS: Record<string, string> = {
  order_canceled: "reject.orderCanceled",
  item_not_in_order: "reject.itemNotInOrder",
  not_delivered: "reject.notDelivered",
  quantity_exceeds_returnable: "reject.quantityExceedsReturnable",
  window_closed: "reject.windowClosed",
  window_override_reason_required: "reject.windowOverrideReasonRequired",
  reason_not_found: "reject.reasonNotFound",
  reason_not_selectable: "reject.reasonNotSelectable",
  fee_bearer_required: "reject.feeBearerRequired",
  request_id_conflict: "reject.requestIdConflict",
  return_option_missing: "reject.returnOptionMissing",
  return_already_received: "reject.returnAlreadyReceived",
  not_our_return: "reject.notOurReturn",
  return_arrived: "reject.returnArrived",
  return_prepaid: "reject.returnPrepaid",
  return_picked_up: "reject.returnPickedUp",
  exchange_requires_seller_fault: "reject.exchangeRequiresSellerFault",
  exchange_released: "reject.exchangeReleased",
}

const has = (table: Record<string, string>, key: string) => Object.prototype.hasOwnProperty.call(table, key)

export function reasonLabelKey(value: string): string {
  return has(RETURN_REASON_LABEL_KEYS, value) ? RETURN_REASON_LABEL_KEYS[value] : "reason.unknown"
}

export function rejectMessageKey(reason: string): string {
  return has(RETURN_REJECT_MESSAGE_KEYS, reason) ? RETURN_REJECT_MESSAGE_KEYS[reason] : "reject.generic"
}
