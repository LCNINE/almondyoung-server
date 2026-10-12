import type { HttpTypes } from "@medusajs/types"
import type { SaleProduct } from "@packages/time-sale-ui"
import { filterSoldOut } from "@/domains/products/components/product-card/quantity/stock-status"
import { getProductPrice } from "@/lib/utils/get-product-price"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import type { TimeSale } from "@/lib/api/medusa/time-sale"
import { getRequiresMembershipToPurchase } from "@/lib/utils/product-card"
import { isWelcomeMembershipProduct } from "@/lib/utils/welcome-membership"

// 세일의 상품 id 순서(판매순 → 리뷰순 → 최신순)대로 상품을 되돌려 카드용 데이터로 바꾼다.
// 가격은 /store/products 응답(멤버십 은닉·가격 비공개 미들웨어가 적용된 값)에서만 만든다.
export function buildSaleProducts({
  sale,
  ids,
  products,
  countryCode,
  isMember = false,
  wishlistIds = [],
}: {
  sale: TimeSale
  ids: string[]
  products: HttpTypes.StoreProduct[]
  countryCode: string
  isMember?: boolean
  wishlistIds?: string[]
}): SaleProduct[] {
  const availableIds = new Set(filterSoldOut(products).map((p) => p.id))
  const byId = new Map(products.map((product) => [product.id, product]))

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
    const period = sale.products?.find((item) => item.productId === id)

    return [
      {
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
        membershipOnly: !!sale.display?.membershipPriceOnly,
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
      },
    ]
  })
}
