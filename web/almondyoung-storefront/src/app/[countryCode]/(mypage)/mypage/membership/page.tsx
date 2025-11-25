import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
import MembershipPageClient from "../../../../../domains/membership/home/membership-page-client"

/**
 * 멤버십 관리 페이지 (Server Component)
 *
 * 서버에서 멤버십 상태를 조회하여 클라이언트 컴포넌트로 전달
 */
export default async function MembershipPage() {
  let isMember = false
  let membershipData = null

  try {
    // todo: 라우트핸들러 만들어야함
    const response = await fetch(
      `${process.env.APP_URL}/api/membership/subscriptions/current`,
      {
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
      }
    )

    console.log("✅ [MembershipPage] API 응답 성공:", response)

    // 구독 데이터가 있으면 멤버십 회원
    if (response) {
      isMember = true
      membershipData = response
    }
  } catch (error) {
    // 404 에러는 구독이 없는 것이므로 정상 처리
    // 다른 에러는 로그만 남기고 비회원으로 처리
    console.error("❌ [MembershipPage] 멤버십 상태 조회 실패:", error)
  }

  console.log("🔍 [MembershipPage] 최종 상태 - isMember:", isMember)

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "아몬드영 멤버십",
      }}
    >
      <MypageLayout>
        <MembershipPageClient
          isMember={isMember}
          membershipData={membershipData}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
