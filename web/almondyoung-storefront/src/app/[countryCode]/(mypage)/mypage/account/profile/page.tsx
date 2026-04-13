import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { ProfileEdit } from "@/domains/mypage/components/account/profile-edit"
import { SocialLinkResultToast } from "@/domains/mypage/components/account/social-link-result-toast"
import { getMyProfile } from "@/lib/api/users/profile"
import { getIdentitiesWithFallback } from "@/lib/api/users/auth/identities"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
import { Suspense } from "react"

export const metadata: Metadata = {
  title: "회원정보 수정",
  description: "회원정보를 수정하세요",
}

export default async function AccountProfilePage({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params

  const [userData, identitiesState] = await Promise.all([
    getMyProfile(),
    getIdentitiesWithFallback(),
  ])

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
          <ProfileEdit
            userData={userData}
            countryCode={countryCode}
            identitiesState={identitiesState}
          />
        </div>
      </MypageLayout>
      <Suspense fallback={null}>
        <SocialLinkResultToast />
      </Suspense>
    </WithHeaderLayout>
  )
}
