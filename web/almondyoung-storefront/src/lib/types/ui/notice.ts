import type { NoticeCategory, NoticeResponseDto } from "@/lib/types/dto/notice"

export interface NoticeItem extends NoticeResponseDto {}

export type NoticeCategoryFilter = NoticeCategory | "all"

export const NOTICE_CATEGORY_VALUES: NoticeCategoryFilter[] = [
  "all",
  "general",
  "event",
  "delivery",
  "service",
]

const DEFAULT_LABELS: Record<NoticeCategoryFilter, string> = {
  all: "전체",
  general: "일반",
  event: "이벤트",
  delivery: "배송",
  service: "서비스",
}

export const NOTICE_CATEGORIES: { value: NoticeCategoryFilter; label: string }[] =
  NOTICE_CATEGORY_VALUES.map((value) => ({
    value,
    label: DEFAULT_LABELS[value],
  }))

export const getNoticeCategoryLabel = (value: NoticeCategory): string =>
  DEFAULT_LABELS[value] ?? value
