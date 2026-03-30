import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { PageTitle } from "@/components/shared/page-title"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "재구매",
  description: "재구매 상품을 확인하세요",
}

interface RebuyPageProps {
  params: Promise<{
    countryCode: string
  }>
}

export default async function RebuyPage({ params }: RebuyPageProps) {
  const { countryCode } = await params

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "자주 산 상품",
      }}
    >
      <MypageLayout>
        <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
          <PageTitle>자주 산 상품</PageTitle>
          <div>준비중입니다.</div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
