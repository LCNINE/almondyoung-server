import { BRAND_CATEGORY_HANDLE } from "@/lib/constants/brand"
import { listRootCategoriesCached } from "@/lib/data/category"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { BrandHeader } from "../brand-header"
import {
  collectBrandDescendantIds,
  isBrandChildCategory,
} from "../../utils/brand-category"

/**
 * 카테고리 페이지 상단 헤딩. 브랜드관("브랜드" 루트)의 자손이면 브랜드형
 * 헤더(로고·이름·소개)로, 아니면 기존과 동일한 h1 로 렌더링한다.
 * 자손 판정이라 브랜드관 아래에 중간 그룹이 생겨도 그대로 동작한다.
 *
 * 브랜드관 트리는 헤더 메가메뉴가 같은 요청에서 이미 캐시한
 * listRootCategoriesCached 에서 얻으므로 Medusa 왕복이 늘지 않는다.
 */
export async function CategoryPageHeading({
  category,
}: {
  category: StoreProductCategoryTree
}) {
  let isBrand = false
  try {
    const roots = await listRootCategoriesCached()
    isBrand = collectBrandDescendantIds(roots, BRAND_CATEGORY_HANDLE).has(
      category.id
    )
  } catch {
    // 루트 트리 조회 실패 → 응답에 실린 부모 정보만으로 폴백 판정
    isBrand = isBrandChildCategory(category, null)
  }

  if (isBrand) {
    return <BrandHeader category={category} />
  }

  return <h1 className="mb-6 text-2xl font-bold">{category.name}</h1>
}
