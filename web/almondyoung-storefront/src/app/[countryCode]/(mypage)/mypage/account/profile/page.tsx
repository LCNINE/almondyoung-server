import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { ProfileEdit } from "@/domains/mypage/components/account/profile-edit"
import { Metadata } from "next"
import { fetchMe } from "@/lib/api/users/me"

export const metadata: Metadata = {
  title: "회원정보 수정",
  description: "회원정보를 수정하세요",
}

export default async function AccountProfilePage({
  params,
}: {
  params: { countryCode: string }
}) {
  const { countryCode } = await params

  const userData = await fetchMe()

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "회원정보 수정",
      }}
    >
      <MypageLayout>
        <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
          <PageTitle>회원정보 수정</PageTitle>
          <ProfileEdit userData={userData} countryCode={countryCode} />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
