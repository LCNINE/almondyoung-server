import type { NoticeResponseDto } from "@/lib/types/dto/notice"
import type { NoticeItem } from "@/lib/types/ui/notice"
import { api } from "../api"

export async function listPublicNotices(): Promise<NoticeItem[]> {
  return api<NoticeResponseDto[]>("pim", "/notices/public", {
    method: "GET",
    withAuth: false,
    next: { tags: ["notices"], revalidate: 60 },
  })
}
