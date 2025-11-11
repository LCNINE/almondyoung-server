import MypageLayout from "@components/layout/mypage-layout"
import { MyPageMobileContent } from "../components/mobile"
import { MyPageDesktopContent } from "../components/desktop"
import { fetchCurrentUser } from "@lib/api/users"

export async function MyPageTemplate() {
  // const currentUser = await fetchCurrentUser()
  const currentUser = {
    loginId: "test",
    username: "test",
    email: "test@test.com",
    isEmailVerified: true,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    shop: null,
    profile: null,
    id: "123",
  }
  return (
    <>
      {/* 모바일 콘텐츠 - md 미만 */}
      <div className="block md:hidden">
        <MyPageMobileContent currentUser={currentUser} />
      </div>

      {/* 데스크탑 콘텐츠 - md 이상 */}
      <div className="hidden md:block">
        <MypageLayout>
          <MyPageDesktopContent currentUser={currentUser} />
        </MypageLayout>
      </div>
    </>
  )
}
