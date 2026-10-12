import { getTranslations } from "next-intl/server"
import { ConfiguredTimeSale } from "@/domains/home/components/sections/time-sale-section/configured"
import { buildSaleProducts } from "@/domains/home/template/time-sale/sale-products"
import { fetchProductsByIds } from "@/domains/home/template/time-sale/fetch-products"
import { listCategories } from "@/lib/api/medusa/categories"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getRegion } from "@/lib/api/medusa/regions"
import type { TimeSaleOverview } from "@/lib/api/medusa/time-sale"
import {
  earliestEnd,
  orderedProducts,
  paginate,
} from "@/lib/utils/time-sale-merge"
import { buildPager, morePageSize } from "@/lib/utils/time-sale-pagination"
import {
  ALL_TAB_KEY,
  buildTabSources,
  deriveTimeSaleTabs,
} from "@/lib/utils/time-sale-tabs"
import { getWishlist } from "@lib/api/users/wishlist"

/**
 * 진행 중 세일 상품 전체. 홈 섹션은 상위 10개만 보이므로 «더보기» 가 여기로 온다.
 *
 * 상품 수백 개를 한 번에 받지 않는다 — id 목록(서버가 정렬·카테고리까지 준다)을 탭으로 거른 뒤
 * 한 페이지만 `/store/products` 로 받는다. 그래야 멤버십가 은닉·가격 계산이 다른 목록과 같다.
 */
export async function TimeSaleAllTemplate({
  overview,
  countryCode,
  tabKey,
  page,
}: {
  overview: TimeSaleOverview
  countryCode: string
  tabKey: string
  page: number
}) {
  const { settings, sales } = overview
  const endsAt = earliestEnd(sales)
  if (!settings.environment.more || !endsAt) return null

  const t = await getTranslations("home.timeSale")
  const all = orderedProducts(overview)
  const categories = await listCategories()

  const href = (key: string, p: number) => {
    const params = new URLSearchParams()
    if (key !== ALL_TAB_KEY) params.set("tab", key)
    if (p > 1) params.set("page", String(p))
    const query = params.toString()
    return `/${countryCode}/time-sale${query ? `?${query}` : ""}`
  }

  const tabs = deriveTimeSaleTabs(
    all,
    buildTabSources(categories),
    t("allTab")
  ).map((tab) => ({
    ...tab,
    href: href(tab.key, 1),
  }))
  const activeTab = tabs.find((tab) => tab.key === tabKey) ?? tabs[0]
  const activeIds = activeTab ? new Set(activeTab.productIds) : null
  const filtered = activeIds ? all.filter((p) => activeIds.has(p.id)) : all
  const pageSize = morePageSize(settings) ?? 40
  const {
    items,
    page: current,
    totalPages,
  } = paginate(filtered, page, pageSize)

  const [region, customer] = await Promise.all([
    getRegion(countryCode),
    retrieveCustomer(),
  ])
  const ids = items.map((p) => p.id)
  const [products, wishlist] = await Promise.all([
    fetchProductsByIds(ids, region?.id),
    customer ? getWishlist().catch(() => []) : Promise.resolve([]),
  ])
  const isMember =
    customer?.groups?.some(
      (group) => group.id === process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID
    ) ?? false
  const listLayout = settings.styles.more.pc.components.find(
    (c) => c.type === "grid" || c.type === "carousel"
  )

  return (
    <ConfiguredTimeSale
      settings={settings}
      surface="more"
      startsAt={sales.reduce(
        (min, sale) =>
          sale.startsAt && sale.startsAt < min ? sale.startsAt : min,
        endsAt
      )}
      endsAt={endsAt}
      countryCode={countryCode}
      tabs={tabs}
      activeTabKey={activeTab?.key}
      productCount={filtered.length}
      pager={
        totalPages > 1
          ? buildPager(
              current,
              totalPages,
              (p) => href(activeTab?.key ?? ALL_TAB_KEY, p),
              listLayout?.options.pageWindow
            )
          : undefined
      }
      products={buildSaleProducts({
        sales,
        ids,
        products,
        countryCode,
        isMember,
        wishlistIds: wishlist.map((item) => item.productId),
      })}
    />
  )
}
