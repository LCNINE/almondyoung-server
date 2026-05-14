import type { NoticeCategory, NoticeResponseDto } from "@/lib/types/dto/notice"

export interface NoticeItem extends NoticeResponseDto {}

export type NoticeCategoryFilter = NoticeCategory | "all"

export const NOTICE_CATEGORIES: { value: NoticeCategoryFilter; label: string }[] =
  [
    { value: "all", label: "전체" },
    { value: "general", label: "일반" },
    { value: "event", label: "이벤트" },
    { value: "delivery", label: "배송" },
    { value: "service", label: "서비스" },
  ]

export const getNoticeCategoryLabel = (value: NoticeCategory): string =>
  NOTICE_CATEGORIES.find((c) => c.value === value)?.label ?? value
