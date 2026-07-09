import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { ProfileEdit } from "@/domains/mypage/components/account/profile-edit"
import { SocialLinkResultToast } from "@/domains/mypage/components/account/social-link-result-toast"
import { getIdentitiesWithFallback } from "@/lib/api/users/auth/identities"
import { getMyProfile } from "@/lib/api/users/profile"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { Suspense } from "react"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.menu")
  return { title: t("profile") }
}

export default async function AccountProfilePage() {
  const t = await getTranslations("mypage.menu")

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
        mobileSubBackHeaderTitle: t("profile"),
      }}
    >
      <MypageLayout>
        <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
          <PageTitle>{t("profile")}</PageTitle>
          <ProfileEdit userData={userData} identitiesState={identitiesState} />
        </div>
      </MypageLayout>
      <Suspense fallback={null}>
        <SocialLinkResultToast />
      </Suspense>
    </WithHeaderLayout>
  )
}
