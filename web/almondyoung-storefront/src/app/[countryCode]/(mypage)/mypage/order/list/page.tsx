import { WithHeaderLayout } from "@components/layout"
import { OrderListClient } from "domains/order/list/components/order-list-client"
import { Metadata } from "next"
import MypageLayout from "@components/layout/mypage-layout"
export const metadata: Metadata = {
  title: "주문내역",
  description: "주문 내역을 확인하세요",
}

export default function OrderListPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "주문내역",
      }}
    >
      <MypageLayout>
        <OrderListClient />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
