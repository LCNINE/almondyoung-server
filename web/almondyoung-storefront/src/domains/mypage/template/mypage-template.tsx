import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { checkAdminScope } from "@lib/api/admin/inventory"
import { fetchMe } from "@lib/api/users/me"
import type { UserDetail } from "@lib/types/ui/user"
import { headers } from "next/headers"
import { MyPageDesktopContent } from "../components/desktop"
import { MyPageMobileContent } from "../components/mobile"

export async function MyPageTemplate() {
  const currentUser = await fetchMe()
  const { isAdmin } = await checkAdminScope()

  // countryCode 추출
  const headersList = await headers()
  const pathname = headersList.get("x-pathname") || ""
  const countryCode = pathname.split("/")[1] || "kr"

  return (
    <>
      {/* 모바일 콘텐츠 - lg 미만 */}
      <div className="block lg:hidden">
        <MyPageMobileContent
          currentUser={currentUser as UserDetail}
          isAdmin={isAdmin}
          countryCode={countryCode}
        />
      </div>
      {/* 데스크탑 콘텐츠 - lg 이상 */}
      <div className="hidden lg:block">
        <MypageLayout>
          <MyPageDesktopContent
            currentUser={currentUser as UserDetail}
            isAdmin={isAdmin}
            countryCode={countryCode}
          />
        </MypageLayout>
      </div>
    </>
  )
}
