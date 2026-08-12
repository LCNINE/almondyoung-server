import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { ListToolbar } from "@/domains/shop-trade/components/list-toolbar"
import { ListingCard } from "@/domains/shop-trade/components/listing-card"
import { Pagination } from "@/domains/shop-trade/components/pagination"
import {
  hasActiveFilter,
  type ShopTradeListParams,
} from "@/domains/shop-trade/build-list-href"
import { listPublicShopListings } from "@/lib/api/pim/shop-listings"
import {
  SHOP_LISTING_BUSINESS_TYPES,
  SHOP_LISTING_DEAL_TYPES,
  SHOP_LISTING_REGIONS,
  SHOP_TRADE_DEFAULT_PAGE_SIZE,
  SHOP_TRADE_KEY_MONEY_BANDS,
  SHOP_TRADE_PAGE_SIZES,
  SHOP_TRADE_VIEWS,
  type ShopListingBusinessType,
  type ShopListingDealType,
  type ShopListingItem,
  type ShopListingRegion,
  type ShopTradeKeyMoneyBand,
  type ShopTradeView,
} from "@/lib/types/ui/shop-listing"

interface PageProps {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { countryCode } = await params
  const t = await getTranslations("shopTrade")

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    // 필터 쿼리스트링이 붙은 변형 URL 이 중복 색인되지 않게 고정
    alternates: { canonical: `/${countryCode}/shop-trade` },
    openGraph: { title: t("metaTitle"), description: t("metaDescription") },
  }
}

function pick<T extends string>(
  raw: string | undefined,
  allowed: readonly T[]
): T | null {
  return allowed.includes(raw as T) ? (raw as T) : null
}

function parseParams(
  raw: Record<string, string | undefined>
): ShopTradeListParams {
  const requestedSize = Number(raw.size)
  const size = SHOP_TRADE_PAGE_SIZES.includes(
    requestedSize as (typeof SHOP_TRADE_PAGE_SIZES)[number]
  )
    ? requestedSize
    : SHOP_TRADE_DEFAULT_PAGE_SIZE

  const requestedPage = Number(raw.page)

  return {
    region: pick<ShopListingRegion>(raw.region, SHOP_LISTING_REGIONS),
    businessType: pick<ShopListingBusinessType>(
      raw.business,
      SHOP_LISTING_BUSINESS_TYPES
    ),
    dealType: pick<ShopListingDealType>(raw.deal, SHOP_LISTING_DEAL_TYPES),
    keyMoney: pick<ShopTradeKeyMoneyBand>(
      raw.keyMoney,
      SHOP_TRADE_KEY_MONEY_BANDS.map((band) => band.key)
    ),
    view: pick<ShopTradeView>(raw.view, SHOP_TRADE_VIEWS) ?? "grid",
    size,
    page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  }
}

function matches(
  listing: ShopListingItem,
  params: ShopTradeListParams
): boolean {
  if (params.region && listing.region !== params.region) return false
  if (params.businessType && listing.businessType !== params.businessType)
    return false
  if (params.dealType && listing.dealType !== params.dealType) return false

  if (params.keyMoney) {
    const band = SHOP_TRADE_KEY_MONEY_BANDS.find(
      (b) => b.key === params.keyMoney
    )
    // 권리금 미기재(협의)는 금액 구간으로 거를 수 없으니 제외한다
    if (!band || listing.keyMoney === null) return false
    if ("min" in band && band.min !== undefined && listing.keyMoney < band.min)
      return false
    if ("max" in band && band.max !== undefined && listing.keyMoney >= band.max)
      return false
  }

  return true
}

export default async function ShopTradePage({ searchParams }: PageProps) {
  const t = await getTranslations("shopTrade")
  const listParams = parseParams(await searchParams)

  let all: ShopListingItem[] = []
  let failed = false

  try {
    all = await listPublicShopListings()
  } catch (error) {
    console.error("[shop-trade] failed to load listings:", error)
    failed = true
  }

  const filtered = all.filter((listing) => matches(listing, listParams))
  const totalPages = Math.max(1, Math.ceil(filtered.length / listParams.size))
  const page = Math.min(listParams.page, totalPages)
  const listings = filtered.slice(
    (page - 1) * listParams.size,
    page * listParams.size
  )
  const isList = listParams.view === "list"

  return (
    <div className="container mx-auto max-w-[1360px] px-3.5 py-6 xl:px-[40px]">
      <SiteBreadcrumb className="mb-4" items={[{ label: t("title") }]} />
      <h1 className="text-foreground mb-6 text-2xl font-bold">{t("title")}</h1>

      <ListToolbar params={{ ...listParams, page }} total={filtered.length} />

      {failed && (
        <p className="text-muted-foreground py-16 text-center text-sm">
          {t("loadFail")}
        </p>
      )}

      {!failed && listings.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-muted-foreground text-sm">
            {hasActiveFilter(listParams) ? t("emptyFiltered") : t("empty")}
          </p>
          {hasActiveFilter(listParams) && (
            <LocalizedClientLink
              href="/shop-trade"
              className="border-border text-foreground hover:bg-muted mt-4 inline-block rounded-lg border px-4 py-2 text-sm transition-colors"
            >
              {t("filterReset")}
            </LocalizedClientLink>
          )}
        </div>
      )}

      <ul
        className={
          isList
            ? "divide-border divide-y border-y"
            : "grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4"
        }
      >
        {listings.map((listing) => (
          <li key={listing.id}>
            <ListingCard listing={listing} variant={listParams.view} />
          </li>
        ))}
      </ul>

      <Pagination params={{ ...listParams, page }} totalPages={totalPages} />
    </div>
  )
}
