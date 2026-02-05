import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { Metadata } from "next"
import { Cafe24LinkSection } from "@/domains/mypage/components/account/cafe24-link-section"

export const metadata: Metadata = {
  title: "카페24 계정 연결/이관",
  description: "카페24 계정을 연결하고 이관 정보를 확인하세요",
}

export default function Cafe24AccountPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "카페24 계정 연결/이관",
      }}
    >
      <MypageLayout>
        <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
          <PageTitle>카페24 계정 연결/이관</PageTitle>
          <Cafe24LinkSection />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
