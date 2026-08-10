import "server-only"

import type {
  SitePopupDto,
  SitePopupViewerType,
} from "@/lib/types/dto/site-popup"
import { api } from "../api"

/**
 * 현재 노출 가능한 팝업 목록.
 *
 * 게시기간·활성·대상 필터는 서버가 처리하고, 경로 매칭과 "다시 보지 않기" 는
 * 브라우저만 아는 정보라 클라이언트에서 거른다.
 */
export async function listPublicSitePopups(
  viewer: SitePopupViewerType
): Promise<SitePopupDto[]> {
  return await api<SitePopupDto[]>("pim", "/site-popups/public", {
    method: "GET",
    withAuth: false,
    params: { viewer },
    next: {
      tags: ["site-popups", `site-popups:${viewer}`],
      revalidate: 60,
    },
  })
}
