import { getTimeSaleOverview } from "@/lib/api/medusa/time-sale"
import { listCategories } from "@/lib/api/medusa/categories"
import { listProducts } from "@/lib/api/medusa/products"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getRegion } from "@/lib/api/medusa/regions"
import { PRODUCT_LIST_FIELDS_WITH_CATEGORIES } from "@lib/data/product-fields"
import { earliestEnd, orderedProducts, productEndsAt } from "@/lib/utils/time-sale-merge"
import { buildTabSources, deriveTimeSaleTabs } from "@/lib/utils/time-sale-tabs"
import { filterSoldOut } from "@/domains/products/components/product-card/quantity/stock-status"
import { getWishlist } from "@lib/api/users/wishlist"
import { getTranslations } from "next-intl/server"
import { TimeSaleSection } from "../../components/sections/time-sale-section"

/** 홈은 상위 HOME_ROWS 칸만 쓰지만 품절을 빼고 다음 상품을 당겨 올려야 하므로 넉넉히 받는다. */
const MAX_PRODUCTS = 100

/** 홈에는 데스크톱 두 줄(lg 5열)만 내보낸다. 나머지는 "더보기" 로 전용 페이지에서 본다. */
const HOME_ROWS = 10

export async function TimeSaleWrapper({
  countryCode,
  background,
}: {
  countryCode: string
  background?: "white" | "muted"
}) {
  const overview = await getTimeSaleOverview()
  const sales = overview.sales.filter((sale) => sale.endsAt && sale.productIds.length > 0)
  const endsAt = earliestEnd(sales)
  if (!endsAt) return null

  const region = await getRegion(countryCode)
  const candidateIds = orderedProducts({ sales, products: overview.products })
    .slice(0, MAX_PRODUCTS)
    .map((product) => product.id)

  const {
    response: { products: fetched },
  } = await listProducts({
    queryParams: {
      id: candidateIds,
      limit: MAX_PRODUCTS,
      // 탭을 상품의 카테고리에서 역산하므로 기본 필드에 카테고리를 얹는다.
      fields: PRODUCT_LIST_FIELDS_WITH_CATEGORIES,
    },
    regionId: region?.id,
  })

  // `listProducts` 는 id 필터라 순서를 보존하지 않는다 — 서버가 준 순서로 되돌린다.
  const byId = new Map(filterSoldOut(fetched).map((product) => [product.id, product]))
  const products = candidateIds
    .map((id) => byId.get(id))
    .filter((product): product is NonNullable<typeof product> => Boolean(product))
    .slice(0, HOME_ROWS)
  if (products.length === 0) return null

  const [customer, categories, t] = await Promise.all([
    retrieveCustomer(),
    listCategories(),
    getTranslations("home.timeSale"),
  ])
  const sources = buildTabSources(categories)

  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const wishlistIds = new Set(wishlist.map((item) => item.productId))

  return (
    <TimeSaleSection
      endsAt={endsAt}
      productEndsAt={Object.fromEntries(productEndsAt(sales))}
      products={products}
      tabs={deriveTimeSaleTabs(
        products.map((product) => ({
          id: product.id,
          categoryIds: (product.categories ?? []).map((category) => category.id),
        })),
        sources,
        t("allTab")
      )}
      customer={customer}
      wishlistIds={wishlistIds}
      background={background}
    />
  )
}
