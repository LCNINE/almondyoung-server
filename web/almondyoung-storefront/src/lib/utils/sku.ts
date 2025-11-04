// src/lib/utils/sku.ts
// SKU ID 생성/파싱 유틸리티 (순수 함수)

/**
 * 선택된 옵션들로부터 SKU ID 생성
 * 예: { color: "red", size: "M" } -> "color:red|size:M"
 */
export function generateSkuId(selectedOptions: Record<string, string>): string {
  return Object.entries(selectedOptions)
    .filter(([_, value]) => value && value.trim() !== "")
    .map(([key, value]) => `${key}:${value}`)
    .sort()
    .join("|")
}

/**
 * SKU ID에서 옵션 정보 파싱
 * 예: "color:red|size:M" -> { color: "red", size: "M" }
 */
export function parseSkuId(skuId: string): Record<string, string> {
  const options: Record<string, string> = {}
  
  if (!skuId) return options
  
  skuId.split("|").forEach(pair => {
    const [key, value] = pair.split(":")
    if (key && value) {
      options[key] = value
    }
  })
  
  return options
}

/**
 * SKU ID가 유효한지 검증
 */
export function isValidSkuId(skuId: string): boolean {
  if (!skuId || typeof skuId !== "string") return false
  
  const pairs = skuId.split("|")
  return pairs.every(pair => {
    const [key, value] = pair.split(":")
    return key && value && key.trim() !== "" && value.trim() !== ""
  })
}
