import type { StoreProduct, StoreProductVariant } from "@medusajs/types"
import type { ProductCardProps } from "@/lib/types/ui/product"
import {
  getPricesForVariant,
  getProductPrice,
} from "@/lib/utils/get-product-price"
import { isWelcomeMembershipProduct } from "@/lib/utils/welcome-membership"

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

// 각 variant가 재고 있는지 체크하는 헬퍼
const checkVariantInStock = (variant: StoreProductVariant) =>
  variant.manage_inventory === false || (variant.inventory_quantity || 0) > 0

export function mapStoreProductToCardProps(
  product: StoreProduct,
  reviewsMap?: Map<string, ReviewSummary>,
  isMembership?: boolean
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

  // 전체 variants 중 하나라도 구매 가능하면 true
  const hasAnyStock = variants.some(checkVariantInStock)

  // 전체 재고 합계 (manage_inventory가 false인 variant가 있으면 무제한 취급)
  const hasUnmanagedVariant = variants.some((v) => v.manage_inventory === false)
  const totalAvailable = hasUnmanagedVariant
    ? Infinity
    : variants.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0)

  const isMembershipOnly =
    product.metadata?.isMembershipOnly === true ||
    product.metadata?.isMembershipOnly === "true"

  const isWelcomeMembership = isWelcomeMembershipProduct(product.tags)

  return {
    title: product.title || "",
    id: product.id,
    handle: product.handle,
    price: displayPrice,
    originalPrice: basePrice,
    discount,
    rating: reviewData?.rating || 0,
    reviewCount: reviewData?.reviewCount || 0,
    imageSrc: imageUrl,
    membershipSavings,
    showMembershipHint,
    isMembershipOnly,
    manageInventory: !hasUnmanagedVariant,
    available: hasAnyStock ? totalAvailable : 0,
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
    isWelcomeMembership,
    isMembership,
  }
}

export function mapStoreProductsToCardProps(
  products: StoreProduct[],
  reviewsMap?: Map<string, ReviewSummary>,
  options?: { isMember?: boolean }
): ProductCardProps[] {
  const filtered =
    options?.isMember === false
      ? products.filter((p) => {
          const isHidden =
            p.metadata?.isMembershipOnly === true ||
            p.metadata?.isMembershipOnly === "true"
          return !isHidden
        })
      : products

  return filtered
    .map((product) =>
      mapStoreProductToCardProps(product, reviewsMap, options?.isMember)
    )
    .filter((props): props is ProductCardProps => props !== null)
}
