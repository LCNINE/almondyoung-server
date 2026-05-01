/**
 * Shop Form 공통 상수
 * survey, setting 템플릿에서 공유
 */

// 시술 카테고리
export const CATEGORIES = [
  "헤어",
  "네일",
  "속눈썹",
  "속눈썹연장",
  "반영구",
  "왁싱",
  "피부미용",
] as const

// 고객층
export const TARGET_CUSTOMERS = [
  "여성",
  "남성",
  "10대",
  "20~30대",
  "40대 이상",
  "아동",
] as const

// 요일
export const DAYS_OF_WEEK = ["월", "화", "수", "목", "금", "토", "일"] as const

// 매장 규모
export const SHOP_TYPES = [
  { value: "solo", label: "1인샵" },
  { value: "small", label: "2~3인 소형샵" },
  { value: "large", label: "4인 이상 중형/대형샵" },
] as const

// 카테고리별 너비 (survey 템플릿용)
export const CATEGORY_WIDTH_MAP: Record<string, string> = {
  헤어: "w-[81.75px]",
  네일: "w-[81.75px]",
  속눈썹: "w-[81.75px]",
  속눈썹연장: "w-[81.75px]",
  반영구: "w-[111.67px]",
  왁싱: "w-[111.67px]",
  피부미용: "w-[111.67px]",
}

export const DEFAULT_CATEGORY_WIDTH = "w-[81.75px]"
