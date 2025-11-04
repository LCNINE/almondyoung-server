/**
 * 리뷰 도메인 관련 상수 정의
 */

// 애니메이션 및 지연 시간
export const ANIMATION_DELAY_MS = 700

// 포인트 관련 상수
export const MAX_REVIEW_BENEFIT_POINTS = 2000
export const DEFAULT_REVIEW_POINTS = 1000

// 필터 옵션
export const REVIEW_PERIOD_OPTIONS = {
  SIX_MONTHS: "6m",
  ONE_YEAR: "1y",
} as const

export const REVIEW_TYPE_OPTIONS = {
  ALL: "all",
  PHOTO_VIDEO: "photo",
  TEXT_ONLY: "text",
} as const

// 탭 값
export const REVIEW_TAB_VALUES = {
  WRITABLE: "writable",
  WRITTEN: "written",
} as const
