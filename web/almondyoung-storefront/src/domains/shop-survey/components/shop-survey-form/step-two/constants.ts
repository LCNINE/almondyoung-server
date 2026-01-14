/**
 * StepTwo 컴포넌트 상수
 */

export const TARGET_CUSTOMERS = [
  "여성",
  "남성",
  "10대",
  "20대~30대",
  "40대 이상",
  "아동",
] as const

export const DAYS_OF_WEEK = ["월", "화", "수", "목", "금", "토", "일"] as const

export const SHOP_TYPES = [
  { value: "solo", label: "1인샵" },
  { value: "small", label: "2~3인샵" },
  { value: "medium", label: "4인 이상" },
] as const
