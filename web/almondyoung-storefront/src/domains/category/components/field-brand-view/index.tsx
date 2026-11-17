import { ChevronDown, X } from "lucide-react"
import { getTranslations } from "next-intl/server"
import type { HttpTypes } from "@medusajs/types"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import { BrandTile } from "@/domains/home/template/brand-showcase/brand-tile"
import { getCategoryThumbnail } from "@/domains/category/utils/category-thumbnail"
import { groupFieldProductsByBrand } from "@/domains/category/utils/field-brand"
import { listProductCategoryMemberships } from "@/lib/api/medusa/products"
import { BRAND_CATEGORY_HANDLE } from "@/lib/constants/brand"
import { listRootCategoriesCached } from "@/lib/data/category"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import RefinementList from "../refinement-list"
import type { SortOptions } from "../refinement-list/sort-products"
import CategoryProducts from "../../templates/category-products"

const COLLAPSED_TILE_COUNT = 18

const GRID_CLASS =
  "grid grid-cols-4 gap-x-3 gap-y-5 sm:grid-cols-5 md:grid-cols-7 md:gap-x-4 lg:grid-cols-9"

interface FieldBrandViewProps {
  category: HttpTypes.StoreProductCategory
  selectedBrandHandle?: string
  basePath: string
  sortBy: SortOptions
  rawSortBy?: string
  rawLimit?: string
  pageSize: number
  page: number
  countryCode: string
}

function findCategory(
  nodes: StoreProductCategoryTree[] | null | undefined,
  id: string | null | undefined
): StoreProductCategoryTree | undefined {
  for (const node of nodes ?? []) {
    if (node.id === id) return node

    const found = findCategory(node.category_children, id)
    if (found) return found
  }
}

/**
 * 분야 아래 "○○ 브랜드" 카테고리 화면. 부모 분야의 상품을 브랜드관 브랜드별로 묶어
 * 로고 타일로 보여주고, 타일을 고르면 같은 페이지에서 그 브랜드의 분야 상품만 남긴다.
 */
export async function FieldBrandView({
  category,
  selectedBrandHandle,
  basePath,
  sortBy,
  rawSortBy,
  rawLimit,
  pageSize,
  page,
  countryCode,
}: FieldBrandViewProps) {
  const [t, tProducts, roots] = await Promise.all([
    getTranslations("category.fieldBrands"),
    getTranslations("category.products"),
    listRootCategoriesCached(),
  ])

  const field = findCategory(roots, category.parent_category_id)
  const brandRoot = roots.find((c) => c.handle === BRAND_CATEGORY_HANDLE)
  const fieldCategoryIds = field ? collectCategoryIds(field) : [category.id]

  // ponytail: 브랜드관 직계 자식만 브랜드로 본다. 중간 그룹이 생기면 자손 전체로 넓힐 것.
  const brands = groupFieldProductsByBrand(
    await listProductCategoryMemberships(fieldCategoryIds),
    brandRoot?.category_children ?? []
  )
  const selected = brands.find((b) => b.category.handle === selectedBrandHandle)
  const fieldName = field?.name ?? category.name

  const hrefFor = (brandHandle?: string) => {
    const params = new URLSearchParams()
    if (brandHandle) params.set("brand", brandHandle)
    if (rawSortBy) params.set("sortBy", rawSortBy)
    if (rawLimit) params.set("limit", rawLimit)
    const query = params.toString()

    return query ? `${basePath}?${query}` : basePath
  }

  const renderTile = ({
    category: brand,
    productIds,
  }: (typeof brands)[number]) => {
    const thumbnail = getCategoryThumbnail(brand)
    const isSelected = brand.id === selected?.category.id

    return (
      <BrandTile
        key={brand.id}
        name={brand.name}
        href={hrefFor(isSelected ? undefined : brand.handle)}
        thumbnailUrl={thumbnail ? getThumbnailUrl(thumbnail) : null}
        selected={isSelected}
        caption={t("productCount", { count: productIds.length })}
      />
    )
  }

  const visible = brands.slice(0, COLLAPSED_TILE_COUNT)
  const hidden = brands.slice(COLLAPSED_TILE_COUNT)
  // 고른 브랜드가 접힌 쪽에 있으면 펼친 채로 보여준다
  const hiddenHasSelected = hidden.some(
    (b) => b.category.id === selected?.category.id
  )

  return (
    <>
      {brands.length > 0 && (
        <section className="mb-6">
          <p className="text-muted-foreground mb-4 text-sm">
            {t("summary", { field: fieldName, count: brands.length })}
          </p>
          <div className={GRID_CLASS}>{visible.map(renderTile)}</div>
          {hidden.length > 0 && (
            <details className="group mt-5" open={hiddenHasSelected}>
              <div className={`${GRID_CLASS} mt-4`}>
                {hidden.map(renderTile)}
              </div>
              <summary className="flex cursor-pointer list-none items-center justify-center gap-1 border-t border-gray-100 pt-4 text-sm text-gray-600 hover:text-black">
                <span className="group-open:hidden">
                  {t("more", { count: hidden.length })}
                </span>
                <span className="hidden group-open:inline">
                  {t("collapse")}
                </span>
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
            </details>
          )}
        </section>
      )}

      {selected && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <LocalizedClientLink
            href={hrefFor()}
            aria-label={t("clear", { brand: selected.category.name })}
            className="bg-foreground text-background inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold"
          >
            {selected.category.name}
            <X className="h-3.5 w-3.5" />
          </LocalizedClientLink>
          <span className="text-muted-foreground text-sm">
            {t("selectedHint", {
              brand: selected.category.name,
              field: fieldName,
            })}
          </span>
        </div>
      )}

      <div className="py-2">
        <RefinementList sortBy={sortBy} pageSize={pageSize} />
      </div>

      <div className="w-full">
        <ErrorBoundary fallback={<div>{tProducts("loadFailed")}</div>}>
          <CategoryProducts
            key={selected?.category.id ?? "all"}
            sortBy={sortBy}
            limit={pageSize}
            page={page}
            paginationBaseUrl={selected ? undefined : basePath}
            countryCode={countryCode}
            categoryIds={selected ? undefined : fieldCategoryIds}
            productsIds={selected?.productIds}
          />
        </ErrorBoundary>
      </div>
    </>
  )
}
