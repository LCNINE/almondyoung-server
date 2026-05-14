"use server"

import type { NoticeCategory, NoticeResponseDto } from "@/lib/types/dto/notice"
import type { NoticeItem } from "@/lib/types/ui/notice"
import { api } from "../api"

export async function listPublicNotices(
  category?: NoticeCategory
): Promise<NoticeItem[]> {
  return await api<NoticeResponseDto[]>("pim", "/notices/public", {
    method: "GET",
    withAuth: false,
    params: category ? { category } : undefined,
    next: { tags: ["notices", `notices:${category ?? "all"}`], revalidate: 60 },
  })
}
