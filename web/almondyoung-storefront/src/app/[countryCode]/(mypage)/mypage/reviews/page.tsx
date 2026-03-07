import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { siteConfig } from "@/lib/config/site"
import { getSEOTags } from "@/lib/seo"
import { WithHeaderLayout } from "@components/layout"
import { ReviewsTemplate } from "@/components/reviews/manage/template"

export const metadata = getSEOTags({
  title: `${siteConfig.appName} | 리뷰`,
  openGraph: {},
  extraTags: {},
})

type Props = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ period?: string; type?: string }>
}

export default async function MyReviewsPage(props: Props) {
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
        mobileSubBackHeaderTitle: "리뷰 목록",
      }}
    >
      <MypageLayout>
        <ReviewsTemplate params={params} searchParams={searchParams} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
