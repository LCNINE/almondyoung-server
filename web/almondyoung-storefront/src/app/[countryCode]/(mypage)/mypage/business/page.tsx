import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { WithHeaderLayout } from "@components/layout"
import { getMyBusiness } from "@lib/api/users/business"
import { fetchMe } from "@lib/api/users/me"
import { getSEOTags } from "@lib/seo"
import { getTranslations } from "next-intl/server"
import BusinessInfoTemplate from "domains/business/template/business-info-template"

export async function generateMetadata() {
  const t = await getTranslations("mypage.page")
  return getSEOTags({
    title: t("business"),
    openGraph: {},
  })
}

export default async function BusinessPage() {
  const t = await getTranslations("mypage.page")
  const currentUser = await fetchMe()

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("business"),
      }}
    >
      <MypageLayout>
        <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
          <PageTitle>{t("business")}</PageTitle>
          <BusinessContent user={currentUser} />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}

async function BusinessContent({ user }: { user: any }) {
  const business = await getMyBusiness()

  return <BusinessInfoTemplate user={user} business={business || null} />
}
