import type { CustomerReturn, CustomerReturnProgress } from "@/lib/types/ui/returns"

export type ReturnStepKey = "requested" | "pickedUp" | "inspected" | "refunded" | "exchanged"

/**
 * 반품 상세의 진행 단계. 회수·검수는 물건이 실제로 왔다는 근거로만 끝낸다 —
 * processing 은 창고가 받아 검수까지 마친 뒤다(정산이 검수 때 열린다). 선환불만 끝난 반품은 마지막 단계(환불)만 끝났고
 * 회수·검수는 core 진행·받은 때로 따로 본다.
 */
export function returnSteps(
  ret: Pick<CustomerReturn, "kind" | "stage" | "refund">,
  progress: Pick<CustomerReturnProgress, "pickupStatus" | "arrivedAt" | "inspectedAt"> | null
): { key: ReturnStepKey; done: boolean }[] {
  const finished = ret.stage === "refunded" || ret.stage === "exchanged"
  const settled = ret.stage === "exchanged" || (ret.stage === "refunded" && ret.refund?.kind !== "prepaid")
  const inspected =
    settled || ret.stage === "processing" || Boolean(progress?.inspectedAt) || Boolean(ret.refund?.receivedAt)
  const pickedUp = inspected || progress?.pickupStatus === "picked_up" || Boolean(progress?.arrivedAt)
  return [
    { key: "requested", done: true },
    { key: "pickedUp", done: pickedUp },
    { key: "inspected", done: inspected },
    { key: ret.kind === "exchange" ? "exchanged" : "refunded", done: finished },
  ]
}

/** 반품한 수량만큼의 금액 — 줄의 처음 낸 금액을 수량으로 나눈다 */
export function returnedAmount(lineTotal: number, lineQuantity: number, returnedQuantity: number): number {
  if (lineQuantity <= 0) return 0
  return Math.round((lineTotal * returnedQuantity) / lineQuantity)
}

export type PickupLabelKey = "none" | "requested" | "pickedUp" | "cancelled"

/** 회수 상태 문구 키. 창고에 도착했으면 회수 행이 없어도(직접 보낸 경우) 회수 완료다 */
export function pickupLabelKey(progress: Pick<CustomerReturnProgress, "pickupStatus" | "arrivedAt">): PickupLabelKey {
  if (progress.pickupStatus === "picked_up" || progress.arrivedAt) return "pickedUp"
  if (progress.pickupStatus === "requested") return "requested"
  if (progress.pickupStatus === "cancelled") return "cancelled"
  return "none"
}
