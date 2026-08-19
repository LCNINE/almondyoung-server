import { BRAND_CATEGORY_HANDLE } from "@/lib/constants/brand"
import { listRootCategoriesCached } from "@/lib/data/category"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { BrandHeader } from "../brand-header"
import { isBrandChildCategory } from "../../utils/brand-category"

/**
 * 카테고리 페이지 상단 헤딩. 브랜드 카테고리("브랜드" 루트의 자식)면 브랜드형
 * 헤더(로고·이름·소개)로, 아니면 기존과 동일한 h1 로 렌더링한다.
 *
 * 브랜드 루트 id 는 헤더 메가메뉴가 같은 요청에서 이미 캐시한
 * listRootCategoriesCached 에서 얻으므로 Medusa 왕복이 늘지 않는다.
 */
export async function CategoryPageHeading({
  category,
}: {
  category: StoreProductCategoryTree
}) {
  let brandRootId: string | null = null
  try {
    const roots = await listRootCategoriesCached()
    brandRootId =
      roots.find((c) => c.handle === BRAND_CATEGORY_HANDLE)?.id ?? null
  } catch {
    // 루트 트리 조회 실패 → 일반 헤딩으로 폴백 (카테고리 페이지 자체는 유지)
  }

  if (isBrandChildCategory(category, brandRootId)) {
    return <BrandHeader category={category} />
  }

  return <h1 className="mb-6 text-2xl font-bold">{category.name}</h1>
}
