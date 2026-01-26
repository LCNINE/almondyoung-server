import type { StoreProduct } from "@medusajs/types"
import type { ProductCardProps } from "@/lib/types/ui/product"
import { getPricesForVariant, getProductPrice } from "@/lib/utils/get-product-price"

export type ReviewSummary = { rating: number; reviewCount: number }

export function mapStoreProductToCardProps(
  product: StoreProduct,
  reviewsMap?: Map<string, ReviewSummary>
): ProductCardProps | null {
  if (!product.variants || product.variants.length === 0) {
    return null
  }

  const defaultVariant =
    (product.variants as any[])?.find(
      (variant) => variant?.is_default || variant?.isDefault
    ) ?? (product.variants as any[])?.[0]
  const defaultPrice = defaultVariant ? getPricesForVariant(defaultVariant) : null
  const priceInfo = getProductPrice({ product })
  const basePrice =
    defaultPrice?.original_price_number ||
    priceInfo?.cheapestPrice?.original_price_number ||
    0
  const membershipPrice =
    defaultPrice?.calculated_price_number ||
    priceInfo?.cheapestPrice?.calculated_price_number ||
    0

  const discount =
    membershipPrice > 0 && basePrice > membershipPrice && basePrice > 0
      ? Math.round(((basePrice - membershipPrice) / basePrice) * 100)
      : 0

  const displayPrice = membershipPrice || basePrice
  const imageUrl = product.thumbnail || ""
  const reviewData = reviewsMap?.get(product.handle || product.id)

  return {
    id: product.id,
    title: product.title || "",
    price: displayPrice,
    originalPrice: basePrice,
    discount,
    rating: reviewData?.rating || 0,
    reviewCount: reviewData?.reviewCount || 0,
    imageSrc: imageUrl,
  }
}

export function mapStoreProductsToCardProps(
  products: StoreProduct[],
  reviewsMap?: Map<string, ReviewSummary>
): ProductCardProps[] {
  return products
    .map((product) => mapStoreProductToCardProps(product, reviewsMap))
    .filter((props): props is ProductCardProps => props !== null)
}
