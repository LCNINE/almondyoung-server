import { HttpTypes } from "@medusajs/types"

/**
 * 리전 목업 데이터
 * 개발 환경에서 API 호출 실패시 사용됩니다.
 */
export const mockRegions: Record<string, HttpTypes.StoreRegion> = {
  kr: {
    id: "reg_kr_mock",
    name: "대한민국",
    currency_code: "krw",
    automatic_taxes: false,
    countries: [
      {
        id: "country_kr",
        iso_2: "kr",
        iso_3: "kor",
        num_code: "410",
        name: "대한민국",
        display_name: "대한민국",
      },
    ],
    payment_providers: [],
    fulfillment_providers: [],
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as HttpTypes.StoreRegion,
}

/**
 * 목업 리전 데이터를 Map 형태로 반환합니다.
 */
export function getMockRegionMap(): Map<string, HttpTypes.StoreRegion> {
  const mockRegionMap = new Map<string, HttpTypes.StoreRegion>()

  // 맵에 추가
  Object.entries(mockRegions).forEach(([key, region]) => {
    mockRegionMap.set(key, region)
  })

  console.log("📍 목업 리전 데이터 로드됨: kr(기본)")

  return mockRegionMap
}
