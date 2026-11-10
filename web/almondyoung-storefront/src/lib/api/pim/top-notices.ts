import "server-only"

import type { TopNoticeDto } from "@/lib/types/dto/top-notice"
import { api } from "../api"

/** 켜져 있고 노출 기간 안인 상단 공지 띠 문구. 순서는 서버가 정한다 */
export async function listPublicTopNotices(): Promise<TopNoticeDto[]> {
  return await api<TopNoticeDto[]>("pim", "/top-notices/public", {
    method: "GET",
    withAuth: false,
    next: { tags: ["top-notices"], revalidate: 60 },
  })
}
