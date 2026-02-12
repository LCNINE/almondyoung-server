import { PageTitle } from "@/components/shared/page-title"
import { MypageBusinessSkeleton } from "@/components/skeletons/page-skeletons"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { getMyBusiness } from "@lib/api/users/business"
import { fetchMe } from "@lib/api/users/me"
import { getSEOTags } from "@lib/seo"
import BusinessInfoTemplate from "domains/business/template/business-info-template"
import { Suspense } from "react"

export const metadata = getSEOTags({
  title: `마이페이지 | 사업자 정보`,
  openGraph: {},
})

export default async function BusinessPage() {
  const currentUser = await fetchMe()

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "다운로드",
      }}
    >
      <MypageLayout>
        <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
          <PageTitle>사업자 정보</PageTitle>
          <Suspense fallback={<MypageBusinessSkeleton />}>
            <BusinessContent user={currentUser} />
          </Suspense>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}

async function BusinessContent({ user }: { user: any }) {
  const business = await getMyBusiness()

  return <BusinessInfoTemplate user={user} business={business || null} />
}
