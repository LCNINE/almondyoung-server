import { Metadata } from "next"
import { ExchangeClient } from "../../../../../domains/order/exchange/exchange-client"
import MypageLayout from "@components/layout/mypage-layout"
import { WithHeaderLayout } from "@components/layout"

export const metadata: Metadata = {
  title: "취소/교환/반품",
  description: "주문 취소, 교환, 반품 내역을 확인하세요",
}

export default function ExchangePage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "취소/교환/반품",
      }}
    >
      <MypageLayout>
        <ExchangeClient />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
