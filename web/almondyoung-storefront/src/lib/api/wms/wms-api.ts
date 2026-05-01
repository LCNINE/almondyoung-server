// src/lib/api/wms/inventory-api.ts
// WMS 재고 API (현재는 PIM만 있으므로 준비용)

// import { InventorySummary, InventoryByVariant } from "../../services/pim/products/transformer.product"

// 임시 타입 정의
type InventorySummary = any
type InventoryByVariant = any

/**
 * 상품별 재고 요약 조회 (일괄)
 * TODO: 실제 WMS API 연동 시 구현
 */
export async function getInventorySummaries(
  productIds: string[]
): Promise<InventorySummary[]> {
  // 현재는 PIM만 있으므로 빈 배열 반환
  // 실제 구현 시: WMS API 호출하여 productIds에 대한 재고 정보 조회
  console.log("WMS 재고 요약 조회 (준비중):", productIds)
  return []
}

/**
 * 상품의 변형별 재고 조회 (상세)
 * TODO: 실제 WMS API 연동 시 구현
 */
export async function getInventoryByVariant(
  productId: string
): Promise<InventoryByVariant | undefined> {
  // 현재는 PIM만 있으므로 undefined 반환
  // 실제 구현 시: WMS API 호출하여 productId의 모든 SKU 재고 정보 조회
  console.log("WMS 변형별 재고 조회 (준비중):", productId)
  return undefined
}
