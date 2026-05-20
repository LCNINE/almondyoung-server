import { Suspense } from "react"
import type { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import { CategoryBreadcrumb } from "../components/breadcrumb"
import RefinementList from "../components/refinement-list"
import { SortOptions } from "../components/refinement-list/sort-products"
import { SubCategoryNav } from "../components/sub-category-nav"
import CategoryProducts from "./category-products"
import { ProductsSkeleton } from "../../../components/skeletons/products-skeleton"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"

export function CategoryTemplate({
  sortBy,
  countryCode,
  category,
  segments,
}: {
  sortBy?: SortOptions
  countryCode: string
  category?: HttpTypes.StoreProductCategory
  segments?: string[]
}) {
  const t = useTranslations("category.products")
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
          <Suspense
            fallback={
              <div className="flex flex-wrap gap-6">
                {category!.category_children!.map((child) => (
                  <div
                    key={child.id}
                    className="flex flex-col items-center gap-2"
                  >
                    <div className="h-24 w-24 animate-pulse rounded-full bg-gray-200" />
                    <span className="text-sm text-gray-700">{child.name}</span>
                  </div>
                ))}
              </div>
            }
          >
            <SubCategoryNav
              categories={category!.category_children!}
              parentHandle={segments?.join("/")}
            />
          </Suspense>
        </div>
      )}

      <div className="flex justify-end py-2">
        <RefinementList sortBy={sort} />
      </div>

      <div className="w-full">
        <ErrorBoundary fallback={<div>{t("loadFailed")}</div>}>
          <Suspense fallback={<ProductsSkeleton />}>
            <CategoryProducts
              sortBy={sort}
              countryCode={countryCode}
              categoryIds={category ? collectCategoryIds(category) : undefined}
            />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}
