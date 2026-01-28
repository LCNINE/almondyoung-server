import type { StoreProduct } from "@medusajs/types"
import type { ProductCardProps } from "@/lib/types/ui/product"
import { getPricesForVariant, getProductPrice } from "@/lib/utils/get-product-price"

export type ReviewSummary = { rating: number; reviewCount: number }

const getMembershipPreviewPrice = (variant: any) => {
  const raw = variant?.metadata?.membershipPrice
  if (typeof raw === "number") return raw
  if (typeof raw === "string") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

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
  const membershipPreviewPrice = defaultVariant
    ? getMembershipPreviewPrice(defaultVariant)
    : undefined
  const priceInfo = getProductPrice({ product })
  const basePrice =
    defaultPrice?.original_price_number ||
    priceInfo?.cheapestPrice?.original_price_number ||
    0
  const actualPrice =
    defaultPrice?.calculated_price_number ||
    priceInfo?.cheapestPrice?.calculated_price_number ||
    0
  const rawMembershipPrice =
    membershipPreviewPrice ??
    (
      defaultPrice?.calculated_price_number ||
      priceInfo?.cheapestPrice?.calculated_price_number ||
      0
    )

  const membershipPrice =
    rawMembershipPrice > 0 && basePrice > rawMembershipPrice
      ? rawMembershipPrice
      : 0

  const discount =
    membershipPrice > 0 && basePrice > 0
      ? Math.round(((basePrice - membershipPrice) / basePrice) * 100)
      : 0

  const displayPrice = membershipPrice || basePrice
  const membershipSavings =
    membershipPrice > 0
      ? basePrice - membershipPrice
      : undefined
  const showMembershipHint =
    membershipSavings != null &&
    Math.abs(actualPrice - membershipPrice) >= 1
  const imageUrl = product.thumbnail || ""
  const reviewData = reviewsMap?.get(product.handle || product.id)

  // 옵션 메타 정보 계산 (퀵 장바구니 담기용)
  const variants = product.variants as any[] | undefined
  const isSingleOption = variants?.length === 1
  const defaultVariantId = defaultVariant?.id

  return {
    id: product.id,
    title: product.title || "",
    price: displayPrice,
    originalPrice: basePrice,
    discount,
    rating: reviewData?.rating || 0,
    reviewCount: reviewData?.reviewCount || 0,
    imageSrc: imageUrl,
    membershipSavings,
    showMembershipHint,
    optionMeta: {
      isSingle: isSingleOption,
      defaultVariantId,
    },
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
