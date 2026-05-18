import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { Cafe24LinkSection } from "@/domains/mypage/components/account/cafe24-link-section"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.page")
  return { title: t("cafe24Migrate") }
}

export default async function Cafe24AccountPage() {
  const t = await getTranslations("mypage.page")
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("cafe24Migrate"),
      }}
    >
      <MypageLayout>
        <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
          <PageTitle>{t("cafe24Migrate")}</PageTitle>
          <Cafe24LinkSection />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
