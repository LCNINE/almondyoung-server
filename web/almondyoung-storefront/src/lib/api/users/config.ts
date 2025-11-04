import { USE_API_GATEWAY } from "@lib/app-config"

// User API 관련 상수
export const USER_API_ENDPOINTS = {
  // auth
  LOGIN: "/auth/signin",
  SIGNUP: "/auth/signup",
  LOGOUT: "/auth/signout",
  FIND_ID_BY_EMAIL: "/auth/forget-userid",
  FIND_PW_BY_EMAIL_AND_LOGIN_ID: "/auth/forget-password",
  RESTORE_TOKEN: "/auth/restore-token",

  // 최근 본 상품
  RECENT_VIEWS: "/recent-views",
  RECENT_VIEWS_BY_ID: (id: string) => `/recent-views/${id}`,

  // 사용자 정보
  USERS: "/me",
  USER_DETAILS: "/users/detail",
  USER_PROFILE: "/users/profile",

  // 상점 정보
  SHOP_INFO: "/shop",

  // 위시리스트
  WISHLIST: "/wishlist",

  // 동의사항
  CONSENTS: "/consents",
} as const

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
