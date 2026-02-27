import { WithHeaderLayout } from "@components/layout"
import { OrderListClient } from "domains/order/list/components/order-list-client"
import { Metadata } from "next"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { getOrders } from "@/lib/api/medusa/orders"
export const metadata: Metadata = {
  title: "주문내역",
  description: "주문 내역을 확인하세요",
}

export default async function OrderListPage() {
  const ordersData = await getOrders({ limit: 50, offset: 0 })

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
        <OrderListClient
          initialOrders={ordersData?.orders ?? []}
          hasError={ordersData === null}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
