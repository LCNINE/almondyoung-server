import { fetchCurrentUser } from "@lib/api/users/me"
import { MyPageMobileContent } from "domains/mypage/components/mobile"
import { MyPageDesktopContent } from "domains/mypage/components/desktop"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"

/**
 * 마이페이지 홈
 *
 * 책임:
 * - 사용자 정보 조회 (Next.js 캐싱으로 layout.tsx와 중복 호출 최적화)
 * - 모바일/데스크탑 콘텐츠 렌더링
 */

export default async function MyPage() {
  // fetcch속도 너무 느려서 일단은 문자열로 처리 const currentUser = await fetchCurrentUser()
  const userName = "사용자"

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
      }}
    >
      {/* 모바일 콘텐츠 - md 미만 */}
      <div className="block md:hidden">
        <MyPageMobileContent userName={userName} />
      </div>

      {/* 데스크탑 콘텐츠 - md 이상 */}
      <div className="hidden md:block">
        <MypageLayout>
          <MyPageDesktopContent userName={userName} />
        </MypageLayout>
      </div>
    </WithHeaderLayout>
  )
}
