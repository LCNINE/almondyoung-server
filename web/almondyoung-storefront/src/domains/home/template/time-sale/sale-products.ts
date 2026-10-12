import type { HttpTypes } from "@medusajs/types"
import type { SaleProduct } from "@packages/time-sale-ui"
import { filterSoldOut } from "@/domains/products/components/product-card/quantity/stock-status"
import { getProductPrice } from "@/lib/utils/get-product-price"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import type { TimeSale } from "@/lib/api/medusa/time-sale"
import {
  getHideMembershipPriceForNonMembers,
  getRequiresMembershipToPurchase,
} from "@/lib/utils/product-card"
import { isWelcomeMembershipProduct } from "@/lib/utils/welcome-membership"

// 상품이 걸린 세일 기간. 세일이 여럿이면 먼저 끝나는 쪽 — 카드 배지가 실제보다 길게 남은 것처럼
// 보이는 것보다 짧게 보이는 쪽이 안전하다.
export function productPeriods(
  sales: TimeSale[]
): Map<string, { startsAt: string | null; endsAt: string | null }> {
  const periods = new Map<
    string,
    { startsAt: string | null; endsAt: string | null }
  >()
  const byEnd = [...sales].sort((a, b) =>
    (a.endsAt ?? "").localeCompare(b.endsAt ?? "")
  )
  for (const sale of byEnd) {
    for (const id of sale.productIds) {
      if (!periods.has(id))
        periods.set(id, { startsAt: sale.startsAt, endsAt: sale.endsAt })
    }
  }
  return periods
}

// 서버가 준 상품 id 순서(판매순 → 리뷰순 → 최신순)대로 상품을 되돌려 카드용 데이터로 바꾼다.
// 가격은 /store/products 응답(멤버십 은닉 미들웨어가 적용된 값)에서만 만든다.
export function buildSaleProducts({
  sales,
  ids,
  products,
  countryCode,
  isMember = false,
  wishlistIds = [],
}: {
  sales: TimeSale[]
  ids: string[]
  products: HttpTypes.StoreProduct[]
  countryCode: string
  isMember?: boolean
  wishlistIds?: string[]
}): SaleProduct[] {
  const availableIds = new Set(filterSoldOut(products).map((p) => p.id))
  const byId = new Map(products.map((product) => [product.id, product]))
  const periods = productPeriods(sales)
  return ids.flatMap((id) => {
    const product = byId.get(id)
    if (!product) return []

    const priceDetails = getProductPrice({ product })
    const cheapestPrice = priceDetails.cheapestPrice
    const cheapestVariant =
      priceDetails.cheapestVariant as HttpTypes.StoreProductVariant | null
    const salePrice: unknown = cheapestPrice?.calculated_price_number
    const originalPrice: unknown = cheapestPrice?.original_price_number
    const currency: unknown = cheapestPrice?.currency_code
    const membershipPrice = cheapestVariant?.metadata?.membershipPrice
    // 멤버십 전용 특가: 판매가 자리엔 일반가를 그대로 두고, 특가는 회원에게만 멤버십가 자리에 보인다.
    // 카드가 그리는 대표 옵션 기준이다. 회원이면 그 세일 가격표가 실제로 적용됐을 때만(상시 멤버십가가 더 싸면
    // Medusa 가 그쪽을 고른다). 비회원은 세일가가 계산되지 않으므로 「회원 공개」로 숨긴다.
    const variantId = cheapestVariant?.id ?? ""
    const membershipOnlySale = sales.find((sale) =>
      sale.membershipOnlyVariantIds?.includes(variantId)
    )
    const appliedPriceList =
      cheapestVariant?.calculated_price?.calculated_price?.price_list_id
    const membershipSale =
      !!membershipOnlySale &&
      (!isMember ||
        membershipOnlySale.priceListIds.includes(appliedPriceList ?? ""))
    // 카드 기간은 대표 옵션 가격을 만든 세일 것이다. 옵션마다 다른 세일에 걸릴 수 있어 상품 단위로 고르면
    // 가격과 타이머가 다른 세일을 가리킨다. 출처를 모르면(옛 응답) 상품이 걸린 세일 중 먼저 끝나는 것을 쓴다.
    const pricedSale =
      sales.find((sale) =>
        sale.priceListIds.includes(appliedPriceList ?? "")
      ) ??
      membershipOnlySale ??
      sales.find((sale) => sale.variantIds?.includes(variantId))
    const period = pricedSale
      ? { startsAt: pricedSale.startsAt, endsAt: pricedSale.endsAt }
      : periods.get(id)
    const finite = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) ? value : null

    const base: SaleProduct = {
      id: product.id,
      name: product.title,
      image: product.thumbnail ? getThumbnailUrl(product.thumbnail) : null,
      images: {
        detail: product.images?.[0]?.url
          ? getThumbnailUrl(product.images[0].url)
          : null,
      },
      summary: product.description,
      modelName:
        typeof product.metadata?.model_name === "string"
          ? product.metadata.model_name
          : null,
      href: `/${countryCode}/products/${product.handle}`,
      // 멤버십가 비공개 상품은 비회원에게 「멤버십 회원에게 가격 공개」를 보인다(상품 카드와 같은 기준).
      membershipOnly: getHideMembershipPriceForNonMembers(product),
      price:
        typeof salePrice === "number" && Number.isFinite(salePrice)
          ? salePrice
          : null,
      membershipPrice:
        typeof membershipPrice === "number" &&
        Number.isFinite(membershipPrice) &&
        membershipPrice > 0
          ? membershipPrice
          : null,
      rating:
        Number(
          product.metadata?.averageRating ??
            product.metadata?.rating ??
            product.metadata?.reviewRating
        ) || 0,
      reviewCount:
        Number(
          product.metadata?.reviewCount ??
            product.metadata?.totalCount ??
            product.metadata?.reviewTotalCount
        ) || 0,
      quickActions: {
        handle: product.handle,
        variantId: product.variants?.[0]?.id,
        currency: typeof currency === "string" ? currency : undefined,
        isSingleOption: (product.variants?.length ?? 0) <= 1,
        membersOnlyPurchase:
          !isMember && getRequiresMembershipToPurchase(product),
        isWelcomeMembership: isWelcomeMembershipProduct(product.tags),
        isWishlisted: wishlistIds.includes(product.id),
      },
      originalPrice:
        typeof originalPrice === "number" && Number.isFinite(originalPrice)
          ? originalPrice
          : null,
      soldOut: !availableIds.has(product.id),
      startsAt: period?.startsAt ?? null,
      endsAt: period?.endsAt ?? null,
    }
    if (!membershipSale) return [base]

    const regular = finite(originalPrice)
    const sale = finite(salePrice)
    return [
      {
        ...base,
        membershipSale: true,
        membershipOnly: true,
        price: regular,
        originalPrice: regular,
        membershipPrice:
          isMember && sale !== null && regular !== null && sale < regular
            ? sale
            : null,
      },
    ]
  })
}
