import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { siteConfig } from "@/lib/config/site"
import { getSEOTags } from "@/lib/seo"
import { WithHeaderLayout } from "@components/layout"
import { MyInquiriesTemplate } from "@/domains/mypage/components/inquiries/template"

export const metadata = getSEOTags({
  title: `${siteConfig.appName} | 내 문의 내역`,
  openGraph: {},
  extraTags: {},
})

type Props = {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ page?: string }>
}

export default async function MyInquiriesPage(props: Props) {
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
        mobileSubBackHeaderTitle: "내 문의 내역",
      }}
    >
      <MypageLayout>
        <MyInquiriesTemplate params={params} searchParams={searchParams} />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
