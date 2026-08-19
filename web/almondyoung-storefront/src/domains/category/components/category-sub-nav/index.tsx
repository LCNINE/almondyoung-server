import {
  isBrandTileNode,
} from "@/domains/home/template/brand-showcase/select-brand-tiles"
import { BRAND_CATEGORY_HANDLE } from "@/lib/constants/brand"
import { listRootCategoriesCached } from "@/lib/data/category"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { BrandDirectory } from "../brand-directory"
import { SubCategoryNav } from "../sub-category-nav"
import { collectBrandDescendantIds } from "../../utils/brand-category"

interface CategorySubNavProps {
  category: StoreProductCategoryTree
  parentHandle?: string
}

/**
 * 카테고리 페이지의 하위 카테고리 영역 분기.
 * - 브랜드관 루트·그룹(브랜드 아님) → 브랜드 디렉토리(섹션별 로고 타일 그리드)
 * - 그 외(일반 카테고리, 하위 분류를 가진 브랜드) → 기존 원형 내비 그대로
 */
export async function CategorySubNav({
  category,
  parentHandle,
}: CategorySubNavProps) {
  // 브랜드관 루트는 무조건 디렉토리. 자손은 그룹(브랜드 아님)일 때만 디렉토리 —
  // 브랜드가 하위 분류를 갖는 경우는 기존 내비를 유지한다.
  let isDirectory = category.handle === BRAND_CATEGORY_HANDLE
  if (!isDirectory) {
    try {
      const roots = await listRootCategoriesCached()
      isDirectory =
        collectBrandDescendantIds(roots, BRAND_CATEGORY_HANDLE).has(
          category.id
        ) && !isBrandTileNode(category)
    } catch {
      // 루트 트리 조회 실패 → 기존 내비로 폴백
    }
  }

  if (isDirectory) {
    return <BrandDirectory category={category} basePath={parentHandle} />
  }

  return (
    <SubCategoryNav
      categories={category.category_children ?? []}
      parentHandle={parentHandle}
    />
  )
}
