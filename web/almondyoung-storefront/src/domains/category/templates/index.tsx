import { Suspense } from "react"
import type { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import { CategoryBreadcrumb } from "../components/breadcrumb"
import { CategoryPageHeading } from "../components/page-heading"
import RefinementList from "../components/refinement-list"
import type { SortOptions } from "../components/refinement-list/sort-products"
import { CategorySubNav } from "../components/category-sub-nav"
import CategoryProducts from "./category-products"
import { ProductsSkeleton } from "../../../components/skeletons/products-skeleton"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"
import { normalizeCategorySort, normalizePageSize } from "../utils/sort-mapping"

const ALL_PRODUCTS_CATEGORY_HANDLE = "cafe24-cat-499"

export function CategoryTemplate({
  sortBy,
  limit,
  countryCode,
  category,
  segments,
}: {
  sortBy?: SortOptions
  limit?: string
  countryCode: string
  category?: HttpTypes.StoreProductCategory
  segments?: string[]
}) {
  const t = useTranslations("category.products")
  const sort = normalizeCategorySort(sortBy)
  const pageSize = normalizePageSize(limit)

  const hasChildren =
    category?.category_children && category.category_children.length > 0

  return (
    <div className="container mx-auto">
      {category && <CategoryBreadcrumb category={category} />}

      {/* 카테고리 제목 — 브랜드 카테고리면 로고·소개가 붙은 브랜드형 헤더로 */}
      {category && (
        <Suspense
          fallback={
            <h1 className="mb-6 text-2xl font-bold">{category.name}</h1>
          }
        >
          <CategoryPageHeading category={category} />
        </Suspense>
      )}

      {/* 하위 카테고리 썸네일 */}
      {hasChildren && (
        <div className="mb-8">
          <Suspense
            fallback={
              <div className="flex flex-wrap gap-1">
                {category!.category_children!.map((child) => (
                  <div
                    key={child.id}
                    className="flex flex-col items-center gap-2 rounded-2xl px-4 pt-4 pb-3"
                  >
                    <div className="h-24 w-24 animate-pulse rounded-full bg-gray-200" />
                    <span className="text-sm text-gray-700">{child.name}</span>
                  </div>
                ))}
              </div>
            }
          >
            <CategorySubNav
              category={category!}
              parentHandle={segments?.join("/")}
            />
          </Suspense>
        </div>
      )}

      <div className="py-2">
        <RefinementList sortBy={sort} pageSize={pageSize} />
      </div>

      <div className="w-full">
        <ErrorBoundary fallback={<div>{t("loadFailed")}</div>}>
          <Suspense fallback={<ProductsSkeleton />}>
            <CategoryProducts
              sortBy={sort}
              limit={pageSize}
              countryCode={countryCode}
              categoryIds={
                category && category.handle !== ALL_PRODUCTS_CATEGORY_HANDLE
                  ? collectCategoryIds(category)
                  : undefined
              }
            />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}
