import type { StoreProduct } from "@medusajs/types"
import type { ProductCardProps } from "@/lib/types/ui/product"

export type ReviewSummary = { rating: number; reviewCount: number }

export function mapStoreProductToCardProps(
  product: StoreProduct,
  reviewsMap?: Map<string, ReviewSummary>
): ProductCardProps | null {
  if (!product.variants || product.variants.length === 0) {
    return null
  }

  const variant = product.variants[0] as any
  const basePrice = (variant.prices?.[0]?.amount as number) || 0
  const membershipPrice =
    (variant.metadata as { membershipPrice?: number })?.membershipPrice || null

  const discount =
    membershipPrice && basePrice > membershipPrice && basePrice > 0
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
