import { listActiveTimeSales } from "@/lib/api/medusa/time-sale"
import { listCategories } from "@/lib/api/medusa/categories"
import { listProducts } from "@/lib/api/medusa/products"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getRegion } from "@/lib/api/medusa/regions"
import { FIXED_CATEGORIES } from "@/lib/constants/categories"
import { PRODUCT_LIST_FIELDS_WITH_CATEGORIES } from "@lib/data/product-fields"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"
import { deriveTimeSaleTabs } from "@/lib/utils/time-sale-tabs"
import { getWishlist } from "@lib/api/users/wishlist"
import { getTranslations } from "next-intl/server"
import { TimeSaleSection } from "../../components/sections/time-sale-section"

/** 세일 상품은 수십 개 규모라 한 번에 받는다. 넘치면 캐러셀이 잘라 보여준다. */
const MAX_PRODUCTS = 100

/** 홈에는 세일마다 데스크톱 두 줄(lg 5열)만 내보낸다. 나머지는 "더보기" 로 전용 페이지에서 본다. */
const HOME_ROWS = 10

export async function TimeSaleWrapper({
  countryCode,
}: {
  countryCode: string
}) {
  const sales = (await listActiveTimeSales()).filter(
    (sale) => sale.endsAt && sale.productIds.length > 0
  )
  if (sales.length === 0) return null

  const region = await getRegion(countryCode)

  // 세일이 여럿이어도 상품 조회는 한 번이다 — 세일마다 부르면 홈 렌더에 Medusa 왕복이 세일 수만큼
  // 붙는데, 세일은 상품이 겹치는 일도 있어 같은 상품을 두 번 받게 된다.
  const allProductIds = Array.from(
    new Set(sales.flatMap((sale) => sale.productIds))
  ).slice(0, MAX_PRODUCTS)

  const {
    response: { products },
  } = await listProducts({
    queryParams: {
      id: allProductIds,
      limit: MAX_PRODUCTS,
      // 탭을 상품의 카테고리에서 역산하므로 기본 필드에 카테고리를 얹는다.
      fields: PRODUCT_LIST_FIELDS_WITH_CATEGORIES,
    },
    regionId: region?.id,
  })

  if (products.length === 0) return null

  const [customer, categories, t] = await Promise.all([
    retrieveCustomer(),
    listCategories(),
    getTranslations("home.timeSale"),
  ])

  const rootHandles = new Set<string>(
    FIXED_CATEGORIES.map((category) => category.handle)
  )
  const sources = categories
    .filter((category) => rootHandles.has(category.handle))
    .map((category) => {
      const fixed = FIXED_CATEGORIES.find(
        (item) => (item.handle as string) === category.handle
      )!
      return {
        key: fixed.key,
        name: category.name,
        handle: category.handle,
        categoryIds: collectCategoryIds(category),
      }
    })

  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const wishlistIds = new Set(wishlist.map((item) => item.productId))

  // `/store/time-sale` 이 판매순 → 리뷰순 → 최신순으로 준 순서를 지킨다. `listProducts` 는 id
  // 필터라 그 순서를 보존하지 않으므로 여기서 되돌린다.
  const byId = new Map(products.map((product) => [product.id, product]))
  const sections = sales.map((sale) => ({
    sale,
    products: sale.productIds
      .map((id) => byId.get(id))
      .filter((product): product is (typeof products)[number] => Boolean(product))
      .slice(0, HOME_ROWS),
  }))

  return (
    <>
      {sections
        .filter((section) => section.products.length > 0)
        .map((section) => (
          <TimeSaleSection
            key={section.sale.title}
            title={sections.length > 1 ? section.sale.title : undefined}
            endsAt={section.sale.endsAt!}
            products={section.products}
            tabs={deriveTimeSaleTabs(
              section.products.map((product) => ({
                id: product.id,
                categoryIds: (product.categories ?? []).map(
                  (category) => category.id
                ),
              })),
              sources,
              t("allTab")
            )}
            customer={customer}
            wishlistIds={wishlistIds}
          />
        ))}
    </>
  )
}
