import { getCategoryThumbnail } from "@/domains/category/utils/category-thumbnail"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProductsSorted } from "@/lib/api/medusa/products"
import { BRAND_CATEGORY_HANDLE } from "@/lib/constants/brand"
import { listRootCategoriesCached } from "@/lib/data/category"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { getTranslations } from "next-intl/server"
import { SectionHead } from "../../components/header"
import { HomeSection } from "../../components/shared/home-section"
import { BrandHall, type BrandHallBrand } from "./brand-hall"
import {
  collectBrandCategoryIds,
  flattenBrandTiles,
  pickTopBrandProducts,
} from "./brand-hall-data"
import { selectBrandTiles } from "./select-brand-tiles"

// 6칸 2줄. 넘치면 더보기(브랜드관)로 보낸다. 브랜드마다 상품 요청이 하나씩 나가므로 상한이 곧 요청 수다.
const MAX_BRANDS = 12
const FEATURED_PER_BRAND = 3
// 회원 전용 노출·품절을 걷어내고도 3개를 채우려고 조금 더 받는다.
const FETCH_PER_BRAND = 8

/**
 * 홈 브랜드관 섹션. 브랜드 = 브랜드관 카테고리 아래 브랜드 노드(헤더 메가메뉴와 같은
 * listRootCategoriesCached 를 재사용). 브랜드마다 판매량순 상위 상품을 병렬로 받아
 * 클라이언트 카드에 넘긴다. 상품 요청은 listProductsSorted 의 1시간 캐시를 탄다.
 */
export async function BrandShowcaseWrapper() {
  const [rootCategories, customer, t] = await Promise.all([
    listRootCategoriesCached().catch(() => null),
    retrieveCustomer().catch(() => null),
    getTranslations("home.brands"),
  ])

  if (!rootCategories) return null

  const { groups } = selectBrandTiles(
    rootCategories,
    BRAND_CATEGORY_HANDLE,
    MAX_BRANDS
  )
  const tiles = flattenBrandTiles(groups, MAX_BRANDS)

  // 브랜드 카테고리가 없거나 비었으면 섹션 자체를 렌더링하지 않는다.
  if (tiles.length === 0) return null

  const isMembership =
    customer?.groups?.some(
      (group) => group.id === process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID
    ) ?? false

  const productLists = await Promise.all(
    tiles.map(({ category }) =>
      listProductsSorted({
        categoryId: collectBrandCategoryIds(category),
        sortBy: "sales_count",
        order: "desc",
        limit: FETCH_PER_BRAND,
      })
        .then(({ response }) => response.products)
        .catch(() => [])
    )
  )

  const brands: BrandHallBrand[] = tiles.map(
    ({ category, handlePath }, index) => {
      const logo = getCategoryThumbnail(category)

      return {
        id: category.id,
        name: category.name,
        href: `/category/${handlePath.join("/")}`,
        logoUrl: logo ? getThumbnailUrl(logo) : null,
        products: pickTopBrandProducts(
          productLists[index],
          isMembership,
          FEATURED_PER_BRAND
        ).map((product) => ({
          ...product,
          thumbnail: product.thumbnail
            ? getThumbnailUrl(product.thumbnail)
            : null,
        })),
      }
    }
  )

  return (
    <HomeSection className="lg:py-16">
      <SectionHead
        title={t("title")}
        subtitle={t("subtitle")}
        moreHref={`/category/${BRAND_CATEGORY_HANDLE}`}
      />

      <BrandHall brands={brands} />
    </HomeSection>
  )
}
