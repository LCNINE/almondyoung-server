import type { CustomerReturn, CustomerReturnStage } from "@/lib/types/ui/returns"

/** 키는 네임스페이스 `mypage.order.returns` 기준 상대 경로다. */
export function returnStageKey(stage: CustomerReturnStage): string {
  return `stage.${stage}`
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

/** 반품 취소 거절 문구 키. 공용 `reject.*` 의 일반 문구는 «신청 실패»라 취소에는 맞지 않아 별도 키를 쓴다. */
export function cancelRejectKey(reason: string): string {
  return Object.prototype.hasOwnProperty.call(CANCEL_REJECT_KEYS, reason)
    ? CANCEL_REJECT_KEYS[reason]
    : "cancelFailed"
}
