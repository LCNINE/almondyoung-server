import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { OrderList } from "@/domains/order/list/components/order-list"
import { getOrders } from "@/lib/api/medusa/orders"
import { getOrderActionsByMedusaId, type StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.menu")
  return { title: t("orderList") }
}

const INITIAL_LIMIT = 20

export default async function OrderListPage() {
  const t = await getTranslations("mypage.menu")
  const ordersData = await getOrders({ limit: INITIAL_LIMIT, offset: 0 })

  // Core 액션을 병렬로 조회. 실패한 주문은 null로 처리해 렌더를 블로킹하지 않음.
  const orders = ordersData?.orders ?? []
  const actionsResults = await Promise.allSettled(
    orders.map((o) => getOrderActionsByMedusaId(o.id))
  )
  const actionsMap: Record<string, StoreOrderActionsResponse> = {}
  actionsResults.forEach((result, idx) => {
    if (result.status === "fulfilled" && orders[idx]) {
      actionsMap[orders[idx]!.id] = result.value
    }
  })

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("orderList"),
      }}
    >
      <MypageLayout>
        <OrderList
          initialOrders={orders}
          initialCount={ordersData?.count ?? 0}
          initialLimit={INITIAL_LIMIT}
          hasError={ordersData === null}
          initialActionsMap={actionsMap}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
