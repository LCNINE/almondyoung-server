import { getCategoryThumbnail } from "@/domains/category/utils/category-thumbnail"
import { BRAND_CATEGORY_HANDLE } from "@/lib/constants/brand"
import { listRootCategoriesCached } from "@/lib/data/category"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { getTranslations } from "next-intl/server"
import { SectionHead } from "../../components/header"
import { HomeSection } from "../../components/shared/home-section"
import { BrandHall, type BrandHallBrand } from "./brand-hall"
import { loadBrandFeaturedProducts } from "./brand-hall-actions"
import { collectBrandCategoryIds, flattenBrandTiles } from "./brand-hall-data"
import { selectBrandTiles } from "./select-brand-tiles"

// 6칸 2줄. 브랜드가 더 많으면 마지막 칸을 "전체 브랜드 +N" 으로 바꿔 브랜드관으로 보낸다.
const MAX_BRANDS = 12

/**
 * 홈 브랜드관 섹션. 브랜드 = 브랜드관 카테고리 아래 브랜드 노드(헤더 메가메뉴와 같은
 * listRootCategoriesCached 를 재사용). 상품은 처음 고른 브랜드만 서버에서 받고,
 * 다른 로고를 누르면 그때 loadBrandFeaturedProducts 로 받는다(브랜드 수와 요청 수를 떼어 둔다).
 */
export async function BrandShowcaseWrapper() {
  const [rootCategories, t] = await Promise.all([
    listRootCategoriesCached().catch(() => null),
    getTranslations("home.brands"),
  ])

  if (!rootCategories) return null

  const { groups } = selectBrandTiles(
    rootCategories,
    BRAND_CATEGORY_HANDLE,
    Number.MAX_SAFE_INTEGER
  )
  const allTiles = flattenBrandTiles(groups, Number.MAX_SAFE_INTEGER)

  // 브랜드 카테고리가 없거나 비었으면 섹션 자체를 렌더링하지 않는다.
  if (allTiles.length === 0) return null

  const hasMore = allTiles.length > MAX_BRANDS
  const tiles = allTiles.slice(0, hasMore ? MAX_BRANDS - 1 : MAX_BRANDS)

  const brands: BrandHallBrand[] = tiles.map(({ category, handlePath }) => {
    const logo = getCategoryThumbnail(category)

    return {
      id: category.id,
      name: category.name,
      href: `/category/${handlePath.join("/")}`,
      logoUrl: logo ? getThumbnailUrl(logo) : null,
      categoryIds: collectBrandCategoryIds(category),
    }
  })

  // 첫 화면에는 처음 고른 브랜드 상품만 싣는다. 나머지는 로고를 누를 때 불러온다
  const initialProducts = await loadBrandFeaturedProducts(brands[0].categoryIds)

  return (
    <HomeSection className="lg:py-16">
      <SectionHead
        title={t("title")}
        subtitle={t("subtitle")}
        moreHref={`/category/${BRAND_CATEGORY_HANDLE}`}
      />

      <BrandHall
        brands={brands}
        initialProducts={initialProducts}
        allBrandsHref={`/category/${BRAND_CATEGORY_HANDLE}`}
        moreCount={hasMore ? allTiles.length - tiles.length : 0}
      />
    </HomeSection>
  )
}
