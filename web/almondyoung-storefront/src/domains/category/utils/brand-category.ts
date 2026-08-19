import { BRAND_CATEGORY_HANDLE } from "../../../lib/constants/brand"

interface BrandCheckCategory {
  parent_category_id?: string | null
  parent_category?: { handle?: string | null } | null
}

/**
 * "브랜드" 루트 카테고리의 직계 자식(=브랜드 카테고리)인지 판정한다.
 * 새 플래그 없이 부모가 브랜드 루트인지로만 본다.
 *
 * - brandRootId: 요청 캐시된 루트 트리에서 찾은 브랜드 루트의 Medusa id (없으면 null)
 * - parent_category 가 응답에 실려 있으면 handle 로도 판정한다 (id 조회 실패 대비)
 */
export function isBrandChildCategory(
  category: BrandCheckCategory,
  brandRootId: string | null
): boolean {
  if (brandRootId && category.parent_category_id === brandRootId) return true
  return category.parent_category?.handle === BRAND_CATEGORY_HANDLE
}
