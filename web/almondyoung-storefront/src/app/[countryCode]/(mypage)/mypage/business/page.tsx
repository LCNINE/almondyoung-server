import { PageTitle } from "@components/common/page-title"
import { Spinner } from "@components/common/spinner"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
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
          <Suspense
            fallback={
              <div className="flex h-56 items-center justify-center text-center">
                <Spinner size="lg" color="gray" />
              </div>
            }
          >
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
