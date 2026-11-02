import type {
  CustomerReturn,
  CustomerReturnProgress,
} from "@/lib/types/ui/returns"
import { originalLineTotal } from "../list/item-return-status"

export function receiptItemAmounts(
  items: (Parameters<typeof originalLineTotal>[0] & { id: string })[],
  returnedItems: CustomerReturn["items"],
  refundedItemTotal: number
): { itemTotal: number; discount: number | null } {
  let gross = 0
  let net = 0

  for (const returned of returnedItems) {
    const item = items.find((candidate) => candidate.id === returned.itemId)

    if (!item || !item.quantity || item.quantity < returned.quantity) {
      return { itemTotal: refundedItemTotal, discount: null }
    }

    gross += returnedAmount(
      originalLineTotal({ ...item, adjustments: [] }),
      item.quantity,
      returned.quantity
    )
    net += returnedAmount(
      originalLineTotal(item),
      item.quantity,
      returned.quantity
    )
  }

  if (net !== refundedItemTotal || gross < net) {
    return { itemTotal: refundedItemTotal, discount: null }
  }

  return { itemTotal: gross, discount: gross - net }
}

/** 반품한 수량만큼의 금액 — 줄의 처음 낸 금액을 수량으로 나눈다 */
export function returnedAmount(
  lineTotal: number,
  lineQuantity: number,
  returnedQuantity: number
): number {
  if (lineQuantity <= 0) {
    return 0
  }

  return Math.round((lineTotal * returnedQuantity) / lineQuantity)
}

export type PickupLabelKey = "none" | "requested" | "pickedUp" | "cancelled"

/** 회수 상태 문구 키. 창고에 도착했으면 회수 행이 없어도(직접 보낸 경우) 회수 완료다 */
export function pickupLabelKey(
  progress: Pick<CustomerReturnProgress, "pickupStatus" | "arrivedAt">
): PickupLabelKey {
  if (progress.pickupStatus === "picked_up" || progress.arrivedAt) {
    return "pickedUp"
  }

  if (progress.pickupStatus === "requested") {
    return "requested"
  }

  if (progress.pickupStatus === "cancelled") {
    return "cancelled"
  }

  return "none"
}
