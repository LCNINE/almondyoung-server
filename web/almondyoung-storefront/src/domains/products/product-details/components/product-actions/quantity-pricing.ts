import type { HttpTypes } from "@medusajs/types"
import { getPricesForVariant } from "@/lib/utils/get-product-price"
import {
  currentTierIndex,
  memberTierHints,
  nextTier,
  productTierSummary,
  readTiers,
  tierRows,
  unitPriceFor,
  type MemberTierHint,
  type ProductTierSummary,
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

/** 모든 옵션을 본 상품 요약(목록 배지·옵션 고르기 전 상세). 수량 할인이 없으면 null. */
export function productQuantitySummary(
  product: Pick<HttpTypes.StoreProduct, "metadata" | "variants">,
  context: QuantityPricingContext
): ProductTierSummary | null {
  return productTierSummary((product.variants ?? []).map((v) => variantTierRows(v, product, context)))
}

/**
 * 묶음 카드 대신 보일 한 줄. 옵션을 고르기 전이고 옵션마다 구간이 다르면 요약(«옵션을 고르면 구간이 보여요»),
 * 고른 옵션에 수량 할인이 없는데 다른 옵션엔 있으면 «이 옵션은 대상이 아닙니다».
 */
export function quantityOptionNote(input: {
  chosen: boolean
  rows: TierRow[]
  memberHints: MemberTierHint[]
  summary: ProductTierSummary | null
}): "summary" | "notEligible" | null {
  const { chosen, rows, memberHints, summary } = input
  if (!summary) return null
  if (!chosen) return summary.varies ? "summary" : null
  return rows.length === 0 && memberHints.length === 0 ? "notEligible" : null
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
