import type { CustomerReturn, CustomerReturnProgress } from "@/lib/types/ui/returns"

export type ReturnStepKey = "requested" | "pickedUp" | "inspected" | "refunded" | "exchanged"

/**
 * 반품 상세의 진행 단계. Medusa 단계만으로도 앞 단계가 끝났음을 알 수 있다 —
 * processing 은 창고가 받아 검수까지 마친 뒤다(정산이 검수 때 열린다). core 진행은 회수·도착을 더 일찍 알려 준다.
 */
export function returnSteps(
  ret: Pick<CustomerReturn, "kind" | "stage">,
  progress: Pick<CustomerReturnProgress, "pickupStatus" | "arrivedAt" | "inspectedAt"> | null
): { key: ReturnStepKey; done: boolean }[] {
  const finished = ret.stage === "refunded" || ret.stage === "exchanged"
  const inspected = finished || ret.stage === "processing" || Boolean(progress?.inspectedAt)
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
