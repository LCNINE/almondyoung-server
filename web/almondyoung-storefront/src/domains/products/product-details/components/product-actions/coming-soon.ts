import { HttpTypes } from "@medusajs/types"

/**
 * 출시예정 상품인지 판정한다.
 *
 * 데이터(variant.metadata.comingSoon)는 core sales_variant_policies →
 * ProductSellableQuantityChanged → Medusa variant.metadata 로 흘러온다
 * (medusa.client.ts 의 applyProductSellableQuantityProjection).
 *
 * 출시예정은 "아직 물건이 안 왔다"는 뜻이라 재고가 붙는 순간 core 가 플래그를 자동으로
 * 걷는다(ADR-0028). 그래서 여기서는 품절 여부를 따로 보지 않는다 — 플래그가 살아 있다는 건
 * 곧 재고가 없다는 뜻이다.
 *
 * comingSoonDate 는 **표시 전용**이다. 판매를 여는 건 날짜가 아니라 입고이므로, 날짜가 지났는데
 * 물건이 안 온 경우가 정상적으로 생긴다. 그때 지난 날짜를 그대로 노출하면
 * "8월 10일 출시 예정" 이 8월 20일에도 걸려 있게 되므로, 지난 날짜는 버리고 "곧 출시 예정" 으로
 * 되돌린다 (pickEarliestRestock 이 stale inboundDate 를 버리는 것과 같은 이유).
 */
export function pickComingSoon(
  variants?: (HttpTypes.StoreProductVariant | undefined)[] | null
) {
  if (!variants?.length) return null

  const comingSoonVariants = variants.filter((v) => v?.metadata?.comingSoon)
  if (comingSoonVariants.length === 0) return null

  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const dates = comingSoonVariants
    .map((v) => v?.metadata?.comingSoonDate)
    .filter((d): d is string => typeof d === "string" && d.slice(0, 10) >= today)
    .sort((a, b) => a.localeCompare(b)) // `YYYY-MM-DD` 는 사전순 = 시간순

  return { date: dates[0] ?? null }
}
