import { Suspense } from "react"
import type { HttpTypes } from "@medusajs/types"
import { CategoryBreadcrumb } from "../components/breadcrumb"
import RefinementList from "../components/refinement-list"
import { SortOptions } from "../components/refinement-list/sort-products"
import { SubCategoryNav } from "../components/sub-category-nav"
import PaginatedProducts from "./paginated-products"
import { ProductsSkeleton } from "../../../components/skeletons/products-skeleton"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"

export function CategoryTemplate({
  sortBy,
  page,
  countryCode,
  category,
  segments,
}: {
  sortBy?: SortOptions
  page?: string
  countryCode: string
  category?: HttpTypes.StoreProductCategory
  segments?: string[]
}) {
  const pageNumber = page ? parseInt(page) : 1
  const sort = sortBy || "created_at"

  const hasChildren =
    category?.category_children && category.category_children.length > 0

  return (
    <div className="container mx-auto">
      {/* 브레드크럼 (하위 카테고리에서만 표시) */}
      {category?.parent_category && <CategoryBreadcrumb category={category} />}

      {/* 카테고리 제목 */}
      {category && <h1 className="mb-6 text-2xl font-bold">{category.name}</h1>}

      {/* 하위 카테고리 썸네일 */}
      {hasChildren && (
        <div className="mb-8">
          <SubCategoryNav
            categories={category.category_children!}
            parentHandle={segments?.join("/")}
          />
        </div>
      )}

      <div className="flex justify-end py-2">
        <RefinementList sortBy={sort} />
      </div>

      <div className="w-full">
        <ErrorBoundary fallback={<div>상품 목록을 불러오지 못했습니다.</div>}>
          <Suspense fallback={<ProductsSkeleton />}>
            <PaginatedProducts
              sortBy={sort}
              page={pageNumber}
              countryCode={countryCode}
              categoryIds={category ? collectCategoryIds(category) : undefined}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}
