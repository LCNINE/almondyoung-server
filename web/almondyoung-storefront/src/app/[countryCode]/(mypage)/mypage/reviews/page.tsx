import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { ReviewsTemplate } from "@/components/reviews/manage/template"
import { siteConfig } from "@/lib/config/site"
import { getSEOTags } from "@/lib/seo"
import { WithHeaderLayout } from "@components/layout"
import { getTranslations } from "next-intl/server"

export async function generateMetadata() {
  const t = await getTranslations("mypage.menu")
  return getSEOTags({
    title: `${siteConfig.appName} | ${t("reviewShort")}`,
    openGraph: {},
    extraTags: {},
  })
}

type Props = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ period?: string; type?: string; page?: string }>
}

export default async function MyReviewsPage(props: Props) {
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
        mobileSubBackHeaderTitle: t("review"),
      }}
    >
      <MypageLayout>
        <ReviewsTemplate params={params} searchParams={searchParams} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
