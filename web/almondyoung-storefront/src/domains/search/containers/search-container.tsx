import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getMembershipGroupIdFromEnv } from "@/lib/utils/membership-group"
import { getRegion } from "@lib/api/medusa/regions"
import { getWishlist } from "@lib/api/users/wishlist"
import { SearchPageClient } from "../components/search-page-client"
import { resolveBrandBanner } from "../data/brand-banner"
import { fetchSearchResults, type SearchSort } from "../data/search-results"

interface SearchContainerProps {
  searchParams: Promise<{
    q?: string
    page?: string
    sort?: string | string[]
    categoryIds?: string | string[]
    brands?: string | string[]
    minPrice?: string
    maxPrice?: string
  }>
  params: Promise<{
    countryCode: string
  }>
}

const PAGE_SIZE = 20

export async function SearchContainer({
  searchParams,
  params,
}: SearchContainerProps) {
  const [
    { q, page, sort, categoryIds, brands, minPrice, maxPrice },
    { countryCode },
  ] = await Promise.all([searchParams, params])

  const keyword = q?.trim() || ""

  const [region, customer] = await Promise.all([
    getRegion(countryCode),
    retrieveCustomer().catch(() => null),
  ])

  const isMembership = !!customer?.groups?.some(
    (group) => group.id === getMembershipGroupIdFromEnv()
  )

  const [wishlist, searchResult, brandBanner] = await Promise.all([
    // 로그인한 경우에만 위시리스트 조회
    customer ? getWishlist().catch(() => []) : Promise.resolve([]),
    fetchSearchResults({
      keyword,
      page: Math.max(1, parseInt(page ?? "1", 10) || 1),
      size: PAGE_SIZE,
      sort: normalizeSearchSort(sort),
      categoryIds: toQueryArray(categoryIds),
      brands: toQueryArray(brands),
      minPrice: minPrice ? parseInt(minPrice, 10) : undefined,
      maxPrice: maxPrice ? parseInt(maxPrice, 10) : undefined,
      isMembership,
      regionId: region?.id,
    }),
    resolveBrandBanner(keyword),
  ])

  return (
    <SearchPageClient
      keyword={keyword}
      brandBanner={brandBanner}
      searchResult={searchResult}
      countryCode={countryCode}
      regionId={region?.id}
      isMembership={isMembership}
      isLoggedIn={!!customer}
      wishlistIds={wishlist.map((item) => item.productId)}
    />
  )
}

function toQueryArray(value?: string | string[]): string[] | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) {
    const list = value.flatMap((item) => item.split(","))
    const filtered = list.map((item) => item.trim()).filter(Boolean)
    return filtered.length > 0 ? filtered : undefined
  }
  const filtered = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return filtered.length > 0 ? filtered : undefined
}

function normalizeSearchSort(value?: string | string[]): SearchSort {
  const sortValue = Array.isArray(value) ? value[0] : value
  switch (sortValue) {
    case "newest":
      return "newest"
    case "price-asc":
    case "price_asc":
      return "price_asc"
    case "price-desc":
    case "price_desc":
      return "price_desc"
    case "review":
      return "review"
    case "relevance":
    default:
      return "relevance"
  }
}
