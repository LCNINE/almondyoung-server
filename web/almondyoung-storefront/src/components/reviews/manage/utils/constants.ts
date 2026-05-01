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
  SIX_MONTHS: "6months",
  ONE_YEAR: "1year",
  ALL: "all",
} as const

export const REVIEW_TYPE_OPTIONS = {
  ALL: "all",
  PHOTO: "photo",
  TEXT: "text",
} as const

export type ReviewPeriod =
  (typeof REVIEW_PERIOD_OPTIONS)[keyof typeof REVIEW_PERIOD_OPTIONS]
export type ReviewType =
  (typeof REVIEW_TYPE_OPTIONS)[keyof typeof REVIEW_TYPE_OPTIONS]

// 탭 값
export const REVIEW_TAB_VALUES = {
  WRITABLE: "writable",
  WRITTEN: "written",
} as const
