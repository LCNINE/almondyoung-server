/**
 * 장바구니 수량 변경 요청을 서버에 보내기 전에 판정한다.
 *
 * 담은 뒤 재고가 줄어 이미 상한을 넘긴 라인(담긴 10개, 남은 재고 5개)에서 "-" 를 누르면
 * 9개가 되는데, 9개도 여전히 재고를 넘어 Medusa 가 거절한다. 8·7·6 도 마찬가지라
 * 한 칸씩 내리는 경로가 전부 막힌다. 이때 고객이 원하는 건 "하나 줄이기" 가 아니라
 * "살 수 있는 상태로 만들기" 이므로 상한까지 한 번에 내린다.
 */

export type QuantityChange =
  | { type: "apply"; quantity: number; clampedToMax: boolean }
  | { type: "reject"; reason: "belowMin" }
  /**
   * 품절이면 줄이는 요청도 서버가 거절한다. 다만 고객이 방금 무엇을 눌렀는지에 따라 할 말이
   * 달라서(늘리려 했나 / 줄이려 했나) 방향을 같이 돌려준다.
   */
  | { type: "reject"; reason: "soldOut"; isIncrease: boolean }
  /** 안내 문구에 남은 수량을 넣어야 하므로 상한을 같이 돌려준다. */
  | { type: "reject"; reason: "exceedsMax"; max: number }

type ResolveInput = {
  /** 고객이 요청한 수량 */
  requested: number
  /** 현재 담겨 있는 수량 */
  current: number
  /** 남은 구매 가능 수량. undefined 면 상한이 없다(재고 미추적/백오더) */
  maxQuantity?: number
}

export function resolveQuantityChange({
  requested,
  current,
  maxQuantity,
}: ResolveInput): QuantityChange {
  if (!Number.isFinite(requested) || requested < 1) {
    return { type: "reject", reason: "belowMin" }
  }

  if (maxQuantity === undefined) {
    return { type: "apply", quantity: requested, clampedToMax: false }
  }

  if (maxQuantity <= 0) {
    return { type: "reject", reason: "soldOut", isIncrease: requested > current }
  }

  if (requested <= maxQuantity) {
    return { type: "apply", quantity: requested, clampedToMax: false }
  }

  // 늘리려는 요청은 그대로 막고 남은 수량을 알려준다.
  if (requested > current) {
    return { type: "reject", reason: "exceedsMax", max: maxQuantity }
  }

  // 줄이려는 요청인데 목표치가 아직 상한을 넘는다. 상한까지 내려 한 번에 유효 상태로 만든다.
  return { type: "apply", quantity: maxQuantity, clampedToMax: true }
}
