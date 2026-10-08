import type { HttpTypes } from "@medusajs/types"
import type { SaleProduct } from "@packages/time-sale-ui"
import { filterSoldOut } from "@/domains/products/components/product-card/quantity/stock-status"
import { getProductPrice } from "@/lib/utils/get-product-price"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import type { TimeSale } from "@/lib/api/medusa/time-sale"

// 세일의 상품 id 순서(판매순 → 리뷰순 → 최신순)대로 상품을 되돌려 카드용 데이터로 바꾼다.
// 가격은 /store/products 응답(멤버십 은닉·가격 비공개 미들웨어가 적용된 값)에서만 만든다.
export function buildSaleProducts({
  sale,
  ids,
  products,
  countryCode,
}: {
  sale: TimeSale
  ids: string[]
  products: HttpTypes.StoreProduct[]
  countryCode: string
}): SaleProduct[] {
  const availableIds = new Set(filterSoldOut(products).map((p) => p.id))
  const byId = new Map(products.map((product) => [product.id, product]))

  return ids.flatMap((id) => {
    const product = byId.get(id)
    if (!product) return []

    const { cheapestPrice } = getProductPrice({ product })
    const period = sale.products?.find((item) => item.productId === id)

    return [
      {
        id: product.id,
        name: product.title,
        image: product.thumbnail ? getThumbnailUrl(product.thumbnail) : null,
        href: `/${countryCode}/products/${product.handle}`,
        price: product.metadata?.timeSalePriceHidden
          ? null
          : (cheapestPrice?.calculated_price_number ?? null),
        originalPrice: cheapestPrice?.original_price_number ?? null,
        soldOut: !availableIds.has(product.id),
        startsAt: period?.startsAt ?? null,
        endsAt: period?.endsAt ?? null,
      },
    ]
  })
}
