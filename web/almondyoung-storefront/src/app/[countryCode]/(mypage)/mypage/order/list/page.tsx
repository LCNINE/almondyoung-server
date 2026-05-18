import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { OrderList } from "@/domains/order/list/components/order-list"
import { getOrders } from "@/lib/api/medusa/orders"
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
          initialOrders={ordersData?.orders ?? []}
          initialCount={ordersData?.count ?? 0}
          initialLimit={INITIAL_LIMIT}
          hasError={ordersData === null}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
