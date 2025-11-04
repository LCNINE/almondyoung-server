import { Metadata } from "next"
import { PageTitle } from "@components/common/page-title"
import MypageLayout from "@components/layout/mypage-layout"
import { WithHeaderLayout } from "@components/layout"

export const metadata: Metadata = {
  title: "재구매",
  description: "재구매 상품을 확인하세요",
}

export default function RebuyPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
      }}
    >
      <MypageLayout>
        <div className="min-h-screen bg-white py-4 md:px-6">
          <PageTitle>자주 산 상품 목록</PageTitle>
          <div className="p-4">
            <p>자주 산 상품 목록</p>
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
