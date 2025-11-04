import { Metadata } from "next"
import { PageTitle } from "@components/common/page-title"

export const metadata: Metadata = {
  title: "구독 관리",
  description: "구독 서비스를 관리하세요",
}

export default function SubscribeManagePage() {
  return (
    <div className="pb-4">
      <PageTitle>구독 관리</PageTitle>
      <div className="bg-white px-5 py-20">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <div className="text-[48px]">📦</div>
          <p className="text-[16px] font-medium text-[#666666]">
            아직 준비중입니다
          </p>
          <p className="text-[14px] text-[#999999]">
            곧 더 나은 서비스로 찾아뵙겠습니다
          </p>
        </div>
      </div>
    </div>
  )
}
