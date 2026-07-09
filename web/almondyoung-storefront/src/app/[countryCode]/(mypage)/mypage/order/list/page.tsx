import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { OrderList } from "@/domains/order/list/order-list"
import { getOrders } from "@/lib/api/medusa/orders"
import {
  getOrderActionsByMedusaId,
  type StoreOrderActionsResponse,
} from "@/lib/api/orders/store-orders"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.menu")
  return { title: t("orderList") }
}

// 클라에서 검색·페이지네이션(5건/페이지)을 처리하므로 목록은 넉넉히 한 번에 받는다.
const INITIAL_LIMIT = 100
// SSR Core 액션 조회는 첫 페이지분만(나머지는 클라에서 페이지 이동 시 조회).
const SSR_ACTIONS_COUNT = 8

export default async function OrderListPage() {
  const t = await getTranslations("mypage.menu")
  const ordersData = await getOrders({ limit: INITIAL_LIMIT, offset: 0 })

  // Core 액션을 병렬로 조회. 실패한 주문은 null로 처리해 렌더를 블로킹하지 않음.
  const orders = ordersData?.orders ?? []
  const actionsResults = await Promise.allSettled(
    orders.slice(0, SSR_ACTIONS_COUNT).map((o) => getOrderActionsByMedusaId(o.id))
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
