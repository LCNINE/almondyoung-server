import type { TimeSale } from "@/lib/api/medusa/time-sale"
import type { TimeSaleSettings } from "@packages/domain-types/time-sale"
import type { SalePeriodLike } from "@packages/time-sale-ui"
import { productSalePeriod } from "@/lib/utils/time-sale-product-period"

// 홈 캐러셀은 앞쪽만 보여주고 나머지는 "더보기" 페이지가 맡는다.
const MAIN_MAX_PRODUCTS = 100

// 팝업 더보기는 메인이 받은 상품으로 그리므로 자르면 뒤쪽 상품에 갈 길이 없다.
export function mainProductIds(
  productIds: string[],
  moreMode: TimeSaleSettings["environment"]["moreMode"]
): string[] {
  return moreMode === "popup"
    ? productIds
    : productIds.slice(0, MAIN_MAX_PRODUCTS)
}

// 섹션 타이머가 따라갈 기간들: 화면에 실린 일부가 아니라 세일의 모든 상품 기간.
export function saleSectionPeriods(sale: TimeSale): SalePeriodLike[] {
  return sale.productIds.map((id) => productSalePeriod(sale, id) ?? {})
}

// Unassigned sales use the existing home slot; named slots only render matching sales.
export function matchesSalePartition(
  configuredId: string | undefined,
  partitionId: string
): boolean {
  return (configuredId || "home-sale") === partitionId
}
