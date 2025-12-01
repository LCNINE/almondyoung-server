import MypageLayout from "@components/layout/mypage-layout"
import { fetchMe } from "@lib/api/users/me"
import { UserDetail } from "types/global"
import { MyPageDesktopContent } from "../components/desktop"
import { MyPageMobileContent } from "../components/mobile"

export async function MyPageTemplate() {
  const currentUser = await fetchMe()

  return (
    <>
      {/* 모바일 콘텐츠 - md 미만 */}
      <div className="block md:hidden">
        <MyPageMobileContent currentUser={currentUser as UserDetail} />
      </div>

      {/* 데스크탑 콘텐츠 - md 이상 */}
      <div className="hidden md:block">
        <MypageLayout>
          <MyPageDesktopContent currentUser={currentUser as UserDetail} />
        </MypageLayout>
      </div>
    </>
  )
}
