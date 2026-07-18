import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import {
  getOrderListPageData,
  sanitizeOrderListParams,
} from "@/domains/order/list/get-order-list-data"
import { OrderList } from "@/domains/order/list/order-list"
import { WithHeaderLayout } from "@components/layout"
import { Metadata } from "next"
import { getTranslations } from "next-intl/server"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mypage.menu")
  return { title: t("orderList") }
}

export default async function OrderListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; period?: string; q?: string }>
}) {
  const t = await getTranslations("mypage.menu")
  const params = sanitizeOrderListParams(await searchParams)
  const data = await getOrderListPageData(params)

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
          orders={data.orders}
          page={data.page}
          pageCount={data.pageCount}
          period={data.period}
          q={data.q}
          count={data.count}
          actionsMap={data.actionsMap}
          refundMap={data.refundMap}
          hasError={data.hasError}
        />
      </MypageLayout>
    </WithHeaderLayout>
  )
}
