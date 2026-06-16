// TODO(#433): Core productMasterVersions에 isMembersOnly 컬럼 추가 및 Storefront 필터 연동 후 이 파일 전체 제거
// https://github.com/LCNINE/almondyoung-server/issues/433
// 참고: isMembershipOnly(멤버십가 숨김)는 이미 구현 완료. 이 파일은 그것과 다른 기능인 '상품 자체 노출 제한'의 임시 처리임.
import type { HttpTypes } from "@medusajs/types"

const MEMBERSHIP_RESTRICTED_MASTER_IDS = new Set([
  "ba8c971b-28d5-49bf-b5b4-f8fdc5ff8e50", // [멤버십 전용] 용접 글루 5g
])

export function isProductMembershipRestricted(
  product: HttpTypes.StoreProduct
): boolean {
  const pimMasterId = product.metadata?.pimMasterId as string | undefined
  if (!pimMasterId) return false
  return MEMBERSHIP_RESTRICTED_MASTER_IDS.has(pimMasterId)
}

export function filterMembershipRestrictedProducts(
  products: HttpTypes.StoreProduct[],
  isMembership: boolean
): HttpTypes.StoreProduct[] {
  if (isMembership) return products
  return products.filter((p) => !isProductMembershipRestricted(p))
}
