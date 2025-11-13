import { Metadata } from "next"
import { PageTitle } from "@components/common/page-title"
import MypageLayout from "@components/layout/mypage-layout"
import { WithHeaderLayout } from "@components/layout"

export const metadata: Metadata = {
  title: "다운로드",
  description: "다운로드 내역을 확인하세요",
}

export default function DownloadPage() {
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
        <div className="px-4 py-4 md:px-6">
          <PageTitle>다운로드</PageTitle>
          <div className="bg-white px-5 py-20">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <div className="text-[48px]">📥</div>
              <p className="text-[16px] font-medium text-[#666666]">
                아직 준비중입니다
              </p>
              <p className="text-[14px] text-[#999999]">
                곧 더 나은 서비스로 찾아뵙겠습니다
              </p>
            </div>
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
