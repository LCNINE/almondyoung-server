export type SitePopupContentType = "rich_text" | "image"
export type SitePopupPlacement = "main" | "all" | "paths"
export type SitePopupAudience = "all" | "guest" | "member" | "membership"
export type SitePopupDismissMode = "none" | "today" | "days"

/** 공개 조회에 넘기는 방문자 구분 */
export type SitePopupViewerType = "guest" | "member" | "membership"

export interface SitePopupDto {
  id: string
  title: string
  contentType: SitePopupContentType
  content: string | null
  pcImageFileId: string | null
  mobileImageFileId: string | null
  imageAlt: string | null
  linkUrl: string | null
  noticeId: string | null
  pcWidth: number | null
  pcHeight: number | null
  mobileWidth: number | null
  mobileHeight: number | null
  placement: SitePopupPlacement
  placementPaths: string[]
  audience: SitePopupAudience
  dismissMode: SitePopupDismissMode
  dismissDays: number | null
  dismissVersion: number
  displayStartAt: string | null
  displayEndAt: string | null
  isActive: boolean
  sortOrder: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}
