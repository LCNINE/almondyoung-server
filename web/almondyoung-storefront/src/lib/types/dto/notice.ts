export type NoticeCategory = "general" | "event" | "delivery" | "service"
export type NoticeBadge = "important" | "urgent" | "new"

export interface NoticeResponseDto {
  id: string
  title: string
  content: string
  category: NoticeCategory
  badge: NoticeBadge | null
  isPinned: boolean
  displayStartAt: string | null
  displayEndAt: string | null
  isActive: boolean
  sortOrder: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}
