import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { fetchMe } from "@lib/api/users/me"
import type { UserDetail } from "@lib/types/ui/user"
import { MyPageDesktopContent } from "../components/desktop"
import { MyPageMobileContent } from "../components/mobile"

export async function MyPageTemplate() {
  const currentUser = await fetchMe()

  return (
    <>
      {/* 모바일 콘텐츠 - lg 미만 */}
      <div className="block lg:hidden">
        <MyPageMobileContent currentUser={currentUser as UserDetail} />
      </div>
      {/* 데스크탑 콘텐츠 - lg 이상 */}
      <div className="hidden lg:block">
        <MypageLayout>
          <MyPageDesktopContent currentUser={currentUser as UserDetail} />
        </MypageLayout>
      </div>
    </>
  )
}
