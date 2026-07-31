/**
 * 카트에 담긴 variant 가 draft/미게시/삭제 상태라 Medusa 가 카트 작업
 * (배송수단 추가, 라인아이템 생성 등)을 거부할 때 나오는 에러를 다루는 유틸.
 */
const UNAVAILABLE_VARIANT_MESSAGE_REGEX =
  /do not exist or belong to a product that is not published/i

export function isUnavailableVariantError(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? ""
  return UNAVAILABLE_VARIANT_MESSAGE_REGEX.test(message)
}

/** Medusa confirmInventory 의 재고 부족 에러(품절)인지 판단한다. 문자열/에러 모두 허용. */
const INSUFFICIENT_INVENTORY_MESSAGE_REGEX =
  /does not have the required inventory/i

export function isInsufficientInventoryError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : ((error as { message?: string })?.message ?? "")
  return INSUFFICIENT_INVENTORY_MESSAGE_REGEX.test(message)
}

/** 에러 메시지에서 문제된 variant id 목록을 중복 제거해 추출한다. */
export function extractUnavailableVariantIds(error: unknown): string[] {
  const message = (error as { message?: string })?.message ?? ""
  const ids = message.match(/variant_[A-Za-z0-9]+/g) ?? []
  return Array.from(new Set(ids))
}

/**
 * variant 가 재고 기준으로 품절인지 판단한다.
 * 상품 상세의 `isInStock`/`hasStock` 과 동일 기준 — 재고관리를 켜고(manage_inventory),
 * 백오더 불가(allow_backorder=false)이며, 가용 재고가 0 이하이면 품절.
 *
 * 어드민 "수동 품절" 은 Medusa 재고를 0 으로 만들므로 이 함수로 잡힌다.
 * (상품은 여전히 published 라 publish 상태 기반 가드로는 안 잡힌다)
 */
/**
 * variant 에 남은 구매 가능 수량. 재고관리를 안 하거나 백오더 허용이면 상한이 없다는 뜻으로 null.
 *
 * 상한을 아는 화면(상품상세·장바구니)은 이 값으로 "N개 이하로 담아주세요" 처럼 구체적으로 안내한다.
 * Medusa 의 재고부족 에러는 `Some variant does not have the required inventory` 라 수량 정보가 없어,
 * 에러 문구를 파싱하는 방식으로는 안내할 수 없다.
 */
export function getAvailableQuantity(
  variant?: {
    manage_inventory?: boolean | null
    allow_backorder?: boolean | null
    inventory_quantity?: number | null
  } | null
): number | null {
  if (!variant) return null
  if (!variant.manage_inventory) return null
  if (variant.allow_backorder) return null
  return Math.max(0, variant.inventory_quantity ?? 0)
}

/**
 * 재고부족 응답을 어떤 안내로 바꿀지 결정한다.
 *
 * - `sold-out`: 남은 재고가 0 → 수량 안내("0개 이하로 담아주세요")는 말이 안 되므로 품절로 안내한다.
 * - `exceeds-stock`: 요청 수량이 남은 재고보다 많다 → "재고가 N개 남았어요" 로 수량을 알려줄 수 있다.
 * - `cart-sum`: 재고 안에서 요청했는데도 실패 → 장바구니에 이미 담긴 수량과 합쳐 넘긴 경우
 *   (또는 방금 재고가 줄었다). 남은 수량만 알려주면 "N개인데 왜 안 되냐" 가 되므로 다르게 안내한다.
 * - `unknown`: 남은 재고를 모르는 화면(상품카드 퀵담기 등) → 수량 없이 일반 재고부족 안내.
 */
export type StockShortageKind =
  | "sold-out"
  | "exceeds-stock"
  | "cart-sum"
  | "unknown"

export function describeStockShortage(input: {
  available?: number | null
  quantity?: number | null
}): StockShortageKind {
  const { available } = input
  if (available === null || available === undefined) return "unknown"
  if (available <= 0) return "sold-out"
  return (input.quantity ?? 1) > available ? "exceeds-stock" : "cart-sum"
}

/**
 * 라인아이템별 수량 상한 맵. **재고가 계산된 variant(=/store/products 응답)** 에서만 상한을 뽑는다.
 *
 * 카트 라인아이템에 붙어오는 variant 에는 Medusa 가 inventory_quantity 를 채워주지 않는다.
 * 그걸 폴백으로 쓰면 재고 0 으로 읽혀 "재고가 0개 남았어요" 를 띄우고 수량 증가를 통째로 막아버린다
 * (상품 조회가 실패하면 전 라인이 그렇게 된다). 그래서 조회 결과에 없는 variant 는 상한 없음으로 둔다 —
 * 잘못된 차단보다 서버 판정에 맡기는 쪽이 안전하다.
 */
export function buildAvailabilityMap(
  items: Array<{ variant_id?: string | null }>,
  variantById: Map<
    string,
    {
      manage_inventory?: boolean | null
      allow_backorder?: boolean | null
      inventory_quantity?: number | null
    }
  >
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const item of items) {
    if (!item.variant_id) continue
    const fetched = variantById.get(item.variant_id)
    if (!fetched) continue
    const available = getAvailableQuantity(fetched)
    if (available !== null) map[item.variant_id] = available
  }
  return map
}

export function isVariantSoldOut(
  variant?: {
    manage_inventory?: boolean | null
    allow_backorder?: boolean | null
    inventory_quantity?: number | null
  } | null
): boolean {
  if (!variant) return false
  if (!variant.manage_inventory) return false
  if (variant.allow_backorder) return false
  return (variant.inventory_quantity ?? 0) <= 0
}
