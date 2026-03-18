import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { OrderList } from "@/domains/order/list/components/order-list"
import { getOrders } from "@/lib/api/medusa/orders"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
export const metadata: Metadata = {
  title: "주문내역",
  description: "주문 내역을 확인하세요",
}

const INITIAL_LIMIT = 20

export default async function OrderListPage() {
  const ordersData = await getOrders({ limit: INITIAL_LIMIT, offset: 0 })
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
        <OrderList
          initialOrders={ordersData?.orders ?? []}
          initialCount={ordersData?.count ?? 0}
          initialLimit={INITIAL_LIMIT}
          hasError={ordersData === null}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
