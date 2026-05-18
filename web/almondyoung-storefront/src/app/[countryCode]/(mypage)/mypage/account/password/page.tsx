import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { PasswordChange } from "@/domains/mypage/components/account/password-change"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.menu")
  return { title: t("password") }
}

export default async function AccountPasswordPage() {
  const t = await getTranslations("mypage.menu")
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("password"),
      }}
    >
      <MypageLayout>
        <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
          <PageTitle>{t("password")}</PageTitle>
          <PasswordChange />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
