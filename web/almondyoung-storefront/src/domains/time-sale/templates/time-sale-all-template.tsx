import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { TimeSaleCountdown } from "@/components/shared/time-sale-countdown"
import { TimeSaleDeadline } from "@/components/shared/time-sale-deadline"
import ProductCard from "@/domains/products/components/product-card"
import { listCategories } from "@/lib/api/medusa/categories"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import type { TimeSaleOverview } from "@/lib/api/medusa/time-sale"
import { cn } from "@/lib/utils"
import { getIsMembershipOnly } from "@/lib/utils/product-card"
import { earliestEnd, orderedProducts, paginate, productEndsAt } from "@/lib/utils/time-sale-merge"
import { ALL_TAB_KEY, buildTabSources, deriveTimeSaleTabs } from "@/lib/utils/time-sale-tabs"
import { getWishlist } from "@lib/api/users/wishlist"
import type { CustomerGroup } from "@/lib/types/dto/medusa"

const PAGE_SIZE = 40

/**
 * 진행 중 세일 상품 전체. 홈 섹션은 상위 10개만 보이므로 «더보기» 가 여기로 온다.
 *
 * 상품 수백 개를 한 번에 받지 않는다 — id 목록(서버가 정렬·카테고리까지 준다)을 탭으로 거른 뒤
 * 한 페이지(40개)만 `/store/products` 로 받는다. 그래야 멤버십가 은닉·가격 계산이 다른 목록과 같다.
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
  const t = await getTranslations("home.timeSale")
  const sales = overview.sales
  const all = orderedProducts(overview)
  const endsAt = earliestEnd(sales)
  const endsByProduct = productEndsAt(sales)

  const categories = await listCategories()
  const tabs = deriveTimeSaleTabs(all, buildTabSources(categories), t("allTab"))
  const activeTab = tabs.find((tab) => tab.key === tabKey) ?? tabs[0]
  const activeIds = activeTab ? new Set(activeTab.productIds) : null
  const filtered = activeIds ? all.filter((p) => activeIds.has(p.id)) : all
  const { items, page: current, totalPages } = paginate(filtered, page, PAGE_SIZE)

  const [region, customer] = await Promise.all([getRegion(countryCode), retrieveCustomer()])
  const ids = items.map((p) => p.id)
  const [listed, wishlist] = await Promise.all([
    ids.length
      ? listProducts({ queryParams: { id: ids, limit: ids.length }, regionId: region?.id })
      : Promise.resolve(null),
    customer ? getWishlist().catch(() => []) : Promise.resolve([]),
  ])
  const byId = new Map((listed?.response.products ?? []).map((product) => [product.id, product]))
  // `listProducts` 는 id 필터라 순서를 보존하지 않는다 — 서버가 준 순서로 되돌린다.
  const products = ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
  const wishlistIds = new Set(wishlist.map((item) => item.productId))
  const isMembership =
    customer?.groups?.some(
      (group: CustomerGroup) => group.id === process.env.NEXT_PUBLIC_MEDUSA_MEMBERSHIP_GROUP_ID
    ) ?? false

  const href = (key: string, p: number) => {
    const params = new URLSearchParams()
    if (key !== ALL_TAB_KEY) params.set("tab", key)
    if (p > 1) params.set("page", String(p))
    const query = params.toString()
    return `/time-sale${query ? `?${query}` : ""}`
  }

  return (
    <section>
      <h1 className="text-xl font-bold text-foreground">{t("allTitle")}</h1>
      {endsAt && <TimeSaleDeadline endsAt={endsAt} className="mt-2" />}

      {tabs.length > 0 && (
        <nav className="mt-4 flex gap-2 overflow-x-auto">
          {tabs.map((tab) => (
            <LocalizedClientLink
              key={tab.key}
              href={href(tab.key, 1)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm",
                tab.key === activeTab?.key ? "border-foreground bg-foreground text-background" : "border-border"
              )}
            >
              {tab.name}
            </LocalizedClientLink>
          ))}
        </nav>
      )}

      <p className="mt-4 text-sm text-muted-foreground">{t("productCount", { count: filtered.length })}</p>

      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-4 lg:grid-cols-5">
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard
              product={product}
              isMembership={isMembership}
              isMembershipOnly={getIsMembershipOnly(product)}
              isWishlisted={wishlistIds.has(product.id)}
              enablePhotoSwipe={false}
              overlay={
                <TimeSaleCountdown
                  endsAt={endsByProduct.get(product.id) ?? endsAt ?? ""}
                  compact
                  clockOnly
                  className="absolute inset-x-0 bottom-0 z-10 bg-black/55 py-1 text-center text-[13px] font-semibold text-white tabular-nums"
                />
              }
            />
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <nav className="mt-8 flex flex-wrap justify-center gap-1">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <LocalizedClientLink
              key={p}
              href={href(activeTab?.key ?? ALL_TAB_KEY, p)}
              className={cn(
                "min-w-9 rounded-md px-2 py-1.5 text-center text-sm",
                p === current ? "bg-foreground text-background" : "text-muted-foreground"
              )}
            >
              {p}
            </LocalizedClientLink>
          ))}
        </nav>
      )}
    </section>
  )
}
