import type { StoreProduct, StoreProductVariant } from "@medusajs/types"
import type { ProductCardProps } from "@/lib/types/ui/product"
import {
  getPricesForVariant,
  getProductPrice,
} from "@/lib/utils/get-product-price"

export type ReviewSummary = { rating: number; reviewCount: number }

const getMembershipPreviewPrice = (
  variant: StoreProductVariant | null | undefined
) => {
  const raw = variant?.metadata?.membershipPrice
  if (typeof raw === "number") return raw
  if (typeof raw === "string") {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const isDefaultVariant = (variant: StoreProductVariant) => {
  const withDefaultFlag = variant as StoreProductVariant & {
    is_default?: boolean
    isDefault?: boolean
  }
  return Boolean(withDefaultFlag.is_default ?? withDefaultFlag.isDefault)
}

export function mapStoreProductToCardProps(
  product: StoreProduct,
  reviewsMap?: Map<string, ReviewSummary>
): ProductCardProps | null {
  if (!product.variants || product.variants.length === 0) {
    return null
  }

  const variants = product.variants ?? []
  const defaultVariant = variants.find(isDefaultVariant) ?? variants[0]
  const defaultPrice = defaultVariant
    ? getPricesForVariant(defaultVariant)
    : null
  const membershipPreviewPrice = defaultVariant
    ? getMembershipPreviewPrice(defaultVariant)
    : undefined
  const priceInfo = getProductPrice({ product })
  const originalPrice =
    defaultPrice?.original_price_number ||
    priceInfo?.cheapestPrice?.original_price_number
  const calculatedPrice =
    defaultPrice?.calculated_price_number ||
    priceInfo?.cheapestPrice?.calculated_price_number
  const basePrice = originalPrice ?? calculatedPrice ?? 0
  const actualPrice = calculatedPrice ?? originalPrice ?? 0
  const rawMembershipPrice =
    membershipPreviewPrice ?? calculatedPrice ?? originalPrice ?? 0

  const membershipPrice =
    rawMembershipPrice > 0 && basePrice > rawMembershipPrice
      ? rawMembershipPrice
      : 0
  const originalAmount = originalPrice ?? null
  const calculatedAmount = calculatedPrice ?? null

  const discount =
    actualPrice > 0 && basePrice > 0 && actualPrice < basePrice
      ? Math.round(((basePrice - actualPrice) / basePrice) * 100)
      : 0

  const displayPrice = actualPrice || basePrice
  const membershipSavings =
    membershipPrice > 0 ? basePrice - membershipPrice : undefined
  const showMembershipHint =
    membershipSavings != null && Math.abs(actualPrice - membershipPrice) >= 1
  const imageUrl = product.thumbnail || ""
  const reviewData = reviewsMap?.get(product.handle || product.id)

  // 옵션 메타 정보 계산 (퀵 장바구니 담기용)
  const isSingleOption = variants.length === 1
  const defaultVariantId = defaultVariant?.id

  // 해당 상품이 재고가 있는지 여부
  const isInStock =
    defaultVariant.manage_inventory === false ||
    (defaultVariant.inventory_quantity || 0) > 0

  // 사용가능한 재고 수량
  const available = isInStock ? defaultVariant.inventory_quantity || 0 : 0

  return {
    title: product.title || "",
    id: product.id,
    price: displayPrice,
    originalPrice: basePrice,
    discount,
    rating: reviewData?.rating || 0,
    reviewCount: reviewData?.reviewCount || 0,
    imageSrc: imageUrl,
    membershipSavings,
    showMembershipHint,
    manageInventory: defaultVariant.manage_inventory ?? false,
    available,
    debugPrices: {
      basePrice,
      membershipPrice,
      rawMembershipPrice,
      originalAmount,
      calculatedAmount,
    },
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
