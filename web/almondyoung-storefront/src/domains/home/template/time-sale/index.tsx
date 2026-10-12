import { getTimeSaleOverview } from "@/lib/api/medusa/time-sale"
import { listCategories } from "@/lib/api/medusa/categories"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getRegion } from "@/lib/api/medusa/regions"
import { earliestEnd, orderedProducts } from "@/lib/utils/time-sale-merge"
import { buildTabSources, deriveTimeSaleTabs } from "@/lib/utils/time-sale-tabs"
import { filterSoldOut } from "@/domains/products/components/product-card/quantity/stock-status"
import { getWishlist } from "@lib/api/users/wishlist"
import { getTranslations } from "next-intl/server"
import { ConfiguredTimeSale } from "../../components/sections/time-sale-section/configured"
import { buildSaleProducts } from "./sale-products"
import { fetchProductsByIds } from "./fetch-products"

/** 홈은 상위 HOME_ROWS 칸만 쓰지만 품절을 빼고 다음 상품을 당겨 올려야 하므로 넉넉히 받는다. */
const MAX_PRODUCTS = 100

/** 홈에는 데스크톱 두 줄(lg 5열)만 내보낸다. 나머지는 "더보기" 로 전용 페이지에서 본다. */
const HOME_ROWS = 10

export async function TimeSaleWrapper({
  countryCode,
}: {
  countryCode: string
  background?: "white" | "muted"
}) {
  const overview = await getTimeSaleOverview()
  if (!overview.settings.environment.main) return null

  const sales = overview.sales.filter(
    (sale) => sale.endsAt && sale.productIds.length > 0
  )
  const endsAt = earliestEnd(sales)
  if (!endsAt) return null

  const region = await getRegion(countryCode)
  const candidates = orderedProducts({
    sales,
    products: overview.products,
  }).slice(0, MAX_PRODUCTS)
  const fetched = await fetchProductsByIds(
    candidates.map((product) => product.id),
    region?.id
  )

  // 서버가 준 순서(판매순 → 리뷰순 → 최신순)에서 품절을 빼고 앞에서부터 채운다.
  const available = new Set(filterSoldOut(fetched).map((product) => product.id))
  const shown = candidates
    .filter((product) => available.has(product.id))
    .slice(0, HOME_ROWS)
  if (shown.length === 0) return null

  const [customer, categories, t] = await Promise.all([
    retrieveCustomer(),
    listCategories(),
    getTranslations("home.timeSale"),
  ])
  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const isMember =
    customer?.groups?.some(
      (group) => group.id === process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID
    ) ?? false

  return (
    <ConfiguredTimeSale
      settings={overview.settings}
      surface="main"
      startsAt={sales.reduce(
        (min, sale) =>
          sale.startsAt && sale.startsAt < min ? sale.startsAt : min,
        endsAt
      )}
      endsAt={endsAt}
      countryCode={countryCode}
      tabs={deriveTimeSaleTabs(shown, buildTabSources(categories), t("allTab"))}
      products={buildSaleProducts({
        sales,
        ids: shown.map((product) => product.id),
        products: fetched,
        countryCode,
        isMember,
        wishlistIds: wishlist.map((item) => item.productId),
      })}
    />
  )
}
