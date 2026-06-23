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
