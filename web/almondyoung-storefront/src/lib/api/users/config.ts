import { USE_API_GATEWAY } from "@lib/app-config"

export const USER_API_CONFIG = {
  // API 기본 URL (환경 변수에서 가져옴)
  BASE_URL: USE_API_GATEWAY
    ? process.env.NEXT_PUBLIC_BACKEND_URL + "/users"
    : "http://localhost:3030",

  // 요청 타임아웃 (10초)
  TIMEOUT: 10000,

  // 캐시 설정
  CACHE_TTL: 5 * 60 * 1000, // 5분

  // 기본 페이지 크기
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const

// 환경 변수 검증
export function validateUserApiConfig(): void {
  if (!USER_API_CONFIG.BASE_URL) {
    console.warn("⚠️ USER_API_CONFIG.BASE_URL이 설정되지 않았습니다.")
    console.warn("환경 변수에 USER_API_CONFIG.BASE_URL을 추가해주세요.")
  }
}
