import type { HttpTypes } from "@medusajs/types"
import { getPricesForVariant } from "@/lib/utils/get-product-price"
import {
  currentTierIndex,
  memberTierHints,
  nextTier,
  readTiers,
  tierRows,
  unitPriceFor,
  type MemberTierHint,
  type TierRow,
} from "@/lib/utils/quantity-discount"

export type QuantityPricingContext = {
  isMember: boolean
  hideMemberPrices: boolean
  now: Date
}

export type ItemQuantityPricing = {
  /** 이 수량에서 낼 개당 가격(장바구니 단가와 같은 계산) */
  unitPrice: number
  /** 1개 기준 지금 가격 */
  currentPrice: number
  /** 지금 수량에 적용된 수량 할인 % (없으면 null) */
  appliedPercent: number | null
  next: { addQuantity: number; unitPrice: number; percent: number } | null
}

export function variantTierRows(
  variant: HttpTypes.StoreProductVariant,
  product: Pick<HttpTypes.StoreProduct, "metadata">,
  context: QuantityPricingContext
): { currentPrice: number | null; rows: TierRow[]; memberHints: MemberTierHint[] } {
  const currentPrice = getPricesForVariant(variant)?.calculated_price_number ?? null
  if (currentPrice === null) return { currentPrice, rows: [], memberHints: [] }
  const tiers = readTiers(variant.metadata, product.metadata, context.now)
  return {
    currentPrice,
    rows: tierRows(currentPrice, tiers, context),
    memberHints: memberTierHints(currentPrice, tiers, metadataNumber(variant.metadata?.membershipPrice), context),
  }
}

function metadataNumber(raw: unknown): number | undefined {
  const n = typeof raw === "string" ? Number(raw) : raw
  return typeof n === "number" && Number.isFinite(n) ? n : undefined
}

export function itemQuantityPricing(
  variant: HttpTypes.StoreProductVariant,
  product: Pick<HttpTypes.StoreProduct, "metadata">,
  quantity: number,
  context: QuantityPricingContext
): ItemQuantityPricing {
  const { currentPrice, rows } = variantTierRows(variant, product, context)
  const price = currentPrice ?? 0
  const tiers = readTiers(variant.metadata, product.metadata, context.now)
  const index = currentTierIndex(quantity, rows)
  return {
    unitPrice: unitPriceFor(quantity, price, tiers, context.isMember),
    currentPrice: price,
    appliedPercent: index >= 0 ? rows[index].percent : null,
    next: nextTier(quantity, rows),
  }
}

/**
 * 담긴 단가가 화면이 보여 준 수량 단가와 다를 때 알릴지. 더 비싸게 담겼으면 항상 알린다(세일 종료 등).
 * 수량 할인 상품이 더 싸게 담긴 건 장바구니에 이미 있던 수량과 합쳐 다음 구간이 붙은 경우라 알리지 않는다.
 */
export function addedPriceChange(input: {
  shown: number | null | undefined
  added: number | null | undefined
  hasTiers: boolean
}): { from: number; to: number } | null {
  const { shown, added, hasTiers } = input
  if (shown == null || added == null || shown === added) return null
  if (added < shown && hasTiers) return null
  return { from: shown, to: added }
}
