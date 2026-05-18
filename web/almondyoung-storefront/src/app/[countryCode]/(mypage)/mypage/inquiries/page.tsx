import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { MyInquiriesTemplate } from "@/domains/mypage/components/inquiries/template"
import { siteConfig } from "@/lib/config/site"
import { getSEOTags } from "@/lib/seo"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"

export async function generateMetadata() {
  const t = await getTranslations("mypage.menu")
  return getSEOTags({
    title: `${siteConfig.appName} | ${t("inquiries")}`,
    openGraph: {},
    extraTags: {},
  })
}

type Props = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ page?: string }>
}

export default async function MyInquiriesPage(props: Props) {
  const t = await getTranslations("mypage.menu")
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ])

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("inquiries"),
      }}
    >
      <MypageLayout>
        <MyInquiriesTemplate params={params} searchParams={searchParams} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
