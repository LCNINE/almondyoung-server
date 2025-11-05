import { USE_API_GATEWAY } from "@lib/app-config"

export const PIM_API_CONFIG = {
  // API 기본 URL (환경 변수에서 가져옴)
  BASE_URL: USE_API_GATEWAY
    ? process.env.NEXT_PUBLIC_BACKEND_URL + "/pim"
    : "http://localhost:3020",

  // 요청 타임아웃 (15초)
  TIMEOUT: 15000,

  // 캐시 설정
  CACHE_TTL: 5 * 60 * 1000, // 5분

  // 기본 페이지 크기
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const

// 환경 변수 검증
export function validatePimApiConfig(): void {
  if (!PIM_API_CONFIG.BASE_URL) {
    console.warn("⚠️ NEXT_PUBLIC_PIM_API_BASE_URL이 설정되지 않았습니다.")
    console.warn("환경 변수에 NEXT_PUBLIC_PIM_API_BASE_URL을 추가해주세요.")
  }
}
