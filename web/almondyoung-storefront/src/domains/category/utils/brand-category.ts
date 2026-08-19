import { BRAND_CATEGORY_HANDLE } from "../../../lib/constants/brand"

interface BrandCheckCategory {
  parent_category_id?: string | null
  parent_category?: { handle?: string | null } | null
}

interface BrandTreeNode {
  id: string
  handle: string
  category_children?: BrandTreeNode[] | null
}

/**
 * "브랜드" 루트 카테고리의 자손(자식·손자 이하 전부) id 집합.
 * 브랜드관이 중간 그룹(래쉬브랜드관…)을 갖는 트리로 재편돼도 브랜드형 헤더
 * 판정이 깨지지 않도록, 직계 자식이 아니라 자손 전체를 모은다.
 */
export function collectBrandDescendantIds(
  rootCategories: BrandTreeNode[],
  brandRootHandle: string = BRAND_CATEGORY_HANDLE
): Set<string> {
  const brandRoot = rootCategories.find((c) => c.handle === brandRootHandle)
  const ids = new Set<string>()
  const walk = (nodes: BrandTreeNode[] | null | undefined) => {
    for (const n of nodes ?? []) {
      ids.add(n.id)
      walk(n.category_children)
    }
  }
  walk(brandRoot?.category_children)
  return ids
}

/**
 * 부모가 브랜드 루트인 직계 자식 판정. 루트 트리 조회가 실패했을 때의 폴백 —
 * 응답에 실린 parent_category / parent_category_id 만으로 판정한다.
 */
export function isBrandChildCategory(
  category: BrandCheckCategory,
  brandRootId: string | null
): boolean {
  if (brandRootId && category.parent_category_id === brandRootId) return true
  return category.parent_category?.handle === BRAND_CATEGORY_HANDLE
}
