import { pickComingSoon } from "@/domains/products/product-details/components/product-actions/coming-soon"
import type { StoreProduct, StoreProductVariant } from "@medusajs/types"
import type { ProductCardProps } from "@/lib/types/ui/product"
import {
  getPricesForVariant,
  getProductPrice,
} from "@/lib/utils/get-product-price"
import { isWelcomeMembershipProduct } from "@/lib/utils/welcome-membership"

export type ReviewSummary = { rating: number; reviewCount: number }

/**
 * 멤버십가 비공개 여부 (비회원에게 멤버십가 숫자 대신 "멤버십 회원 공개" 표시).
 * 상품 숨김/구매 제한이 아니다.
 */
export function getHideMembershipPriceForNonMembers(
  product: Pick<StoreProduct, "metadata">
): boolean {
  return (
    product.metadata?.hideMembershipPriceForNonMembers === true ||
    product.metadata?.hideMembershipPriceForNonMembers === "true" ||
    product.metadata?.isMembershipOnly === true ||
    product.metadata?.isMembershipOnly === "true"
  )
}

export function getIsVisibleToMembersOnly(
  product: Pick<StoreProduct, "metadata">
): boolean {
  return (
    product.metadata?.isVisibleToMembersOnly === true ||
    product.metadata?.isVisibleToMembersOnly === "true"
  )
}

/**
 * 멤버십 회원만 구매 가능한 상품 여부 (노출·검색은 그대로, 구매만 차단).
 * Medusa 응답 미들웨어가 비회원 variant 를 재고 0 으로 마스킹하므로 화면상 품절과
 * 구분되지 않는다 — 이 판정으로 "멤버십 전용" 문구를 대신 띄운다.
 */
export function getRequiresMembershipToPurchase(
  product: Pick<StoreProduct, "metadata">
): boolean {
  const constraint = product.metadata?.pimPurchaseConstraint
  if (typeof constraint !== "object" || constraint === null) return false

  const requiresMembership = (constraint as Record<string, unknown>)
    .requiresMembership
  return requiresMembership === true || requiresMembership === "true"
}

/** 해외 배송(해외직구) 상품 여부 */
export function getIsOverseas(
  product: Pick<StoreProduct, "metadata">
): boolean {
  return (
    product.metadata?.isOverseas === true ||
    product.metadata?.isOverseas === "true"
  )
}

export function filterProductsByMembershipVisibility<
  T extends Pick<StoreProduct, "metadata">,
>(products: T[], isMembership: boolean): T[] {
  if (isMembership) return products
  return products.filter((product) => !getIsVisibleToMembersOnly(product))
}

/**
 * @deprecated UI prop compatibility. Use getHideMembershipPriceForNonMembers.
 */
export function getIsMembershipOnly(
  product: Pick<StoreProduct, "metadata">
): boolean {
  return getHideMembershipPriceForNonMembers(product)
}

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

  const hideMembershipPriceForNonMembers =
    getHideMembershipPriceForNonMembers(product)

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
    isMembershipOnly: hideMembershipPriceForNonMembers,
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
    isOverseas: getIsOverseas(product),
    comingSoon: pickComingSoon(product.variants),
  }
}

export function mapStoreProductsToCardProps(
  products: StoreProduct[],
  reviewsMap?: Map<string, ReviewSummary>,
  options?: { isMember?: boolean }
): ProductCardProps[] {
  return filterProductsByMembershipVisibility(
    products,
    Boolean(options?.isMember)
  )
    .map((product) =>
      mapStoreProductToCardProps(product, reviewsMap, options?.isMember)
    )
    .filter((props): props is ProductCardProps => props !== null)
}
