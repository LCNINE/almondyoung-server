import type { CustomerReturn, CustomerReturnStage } from "@/lib/types/ui/returns"

/** 교환 문구가 있는 단계. 교환에 refunded 가 오면(차액 환불 등) 반품 문구로 둔다. */
const EXCHANGE_STAGES: ReadonlySet<CustomerReturnStage> = new Set<CustomerReturnStage>([
  "requested",
  "processing",
  "exchanged",
  "canceled",
])

/** 키는 네임스페이스 `mypage.order.returns` 기준 상대 경로다. `exchanged` 는 종류와 무관하게 교환 문구. */
export function returnStageKey(stage: CustomerReturnStage, kind: CustomerReturn["kind"]): string {
  if (stage === "exchanged" || (kind === "exchange" && EXCHANGE_STAGES.has(stage))) return `exchangeStage.${stage}`
  return `stage.${stage}`
}

/** 항목 종류 표지(«반품»/«교환») 키. */
export function returnKindKey(kind: CustomerReturn["kind"]): string {
  return `kind.${kind}`
}

export interface OrderReturnItemRow {
  title: string
  variantTitle: string | null
  quantity: number
}

/** 주문에 없는 품목 id 도 빼지 않는다 — 반품 수량이 보이지 않게 되는 쪽이 더 나쁘다. */
export function returnItemRows(
  ret: CustomerReturn,
  items: Array<{ id: string; title: string; variantTitle: string | null }>
): OrderReturnItemRow[] {
  return ret.items.map((r) => {
    const found = items.find((i) => i.id === r.itemId)
    return {
      title: found?.title ?? "",
      variantTitle: found?.variantTitle ?? null,
      quantity: r.quantity,
    }
  })
}

const CANCEL_REJECT_KEYS: Record<string, string> = {
  return_arrived: "cancelReject.returnArrived",
  return_already_received: "cancelReject.returnArrived",
  return_prepaid: "cancelReject.returnPrepaid",
  return_picked_up: "cancelReject.returnPickedUp",
  exchange_released: "cancelReject.exchangeReleased",
  not_our_return: "cancelReject.notOurReturn",
}

/** 교환 취소는 환불·반품 말투가 맞지 않는 거절만 따로 둔다. */
const EXCHANGE_CANCEL_REJECT_KEYS: Record<string, string> = {
  return_picked_up: "cancelReject.exchangePickedUp",
  not_our_return: "cancelReject.exchangeNotOurs",
}

/** 반품 취소 거절 문구 키. 공용 `reject.*` 의 일반 문구는 «신청 실패»라 취소에는 맞지 않아 별도 키를 쓴다. */
export function cancelRejectKey(reason: string, kind: CustomerReturn["kind"] = "return"): string {
  if (kind === "exchange" && Object.prototype.hasOwnProperty.call(EXCHANGE_CANCEL_REJECT_KEYS, reason)) {
    return EXCHANGE_CANCEL_REJECT_KEYS[reason]
  }
  return Object.prototype.hasOwnProperty.call(CANCEL_REJECT_KEYS, reason)
    ? CANCEL_REJECT_KEYS[reason]
    : "cancelFailed"
}
