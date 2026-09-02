import { retrieveCustomer } from "@lib/api/medusa/customer"
import { getAccessToken, getRefreshToken } from "@lib/data/cookies"
import { isMembershipGroup } from "@lib/utils/membership-group"
import { listPublicSitePopups } from "@/lib/api/pim/site-popups"
import type { SitePopupViewerType } from "@/lib/types/dto/site-popup"
import type { SitePopup } from "@/lib/types/ui/site-popup"
import { SitePopupStack } from "./site-popup-stack"

/**
 * 관리자가 등록한 팝업을 스토어프론트에 띄우는 진입점.
 *
 * 대상(비로그인/회원/멤버십) 판별은 서버에서만 한다 — 브라우저가 자칭하게 두면
 * 멤버십 회원 전용 안내가 아무에게나 노출된다. 경로·숨김은 클라이언트가 마저 건다.
 */
export async function SitePopupHost({ countryCode }: { countryCode: string }) {
  const viewer = await resolveViewerType()

  const popups: SitePopup[] = await listPublicSitePopups(viewer).catch((err) => {
    // 팝업은 부가 기능이다. 조회가 실패해도 페이지 자체는 그대로 보여준다.
    console.error("listPublicSitePopups error:", err)
    return []
  })

  if (popups.length === 0) {
    return null
  }

  return <SitePopupStack popups={popups} countryCode={countryCode} />
}

async function resolveViewerType(): Promise<SitePopupViewerType> {
  const customer = await retrieveCustomer().catch(() => null)
  if (customer) {
    return isMembershipGroup(customer.groups) ? "membership" : "member"
  }

  // Medusa JWT 는 토큰 회전 경합으로 사라져도 로그인 세션 자체는 살아있다 (#491).
  // 그걸 guest 로 보면 비로그인 대상 팝업이 로그인한 회원에게 뜬다.
  // accessToken 은 15분이라 만료된 채로 방문하는 회원이 흔하므로 30일짜리
  // refreshToken 까지 본다.
  const [accessToken, refreshToken] = await Promise.all([
    getAccessToken(),
    getRefreshToken(),
  ])
  return accessToken || refreshToken ? "member" : "guest"
}
