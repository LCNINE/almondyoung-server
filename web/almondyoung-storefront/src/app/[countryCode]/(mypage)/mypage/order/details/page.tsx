import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { OrderDetailsDesktop } from "domains/order/details/components/order-details-desktop"
import { OrderDetailsMobile } from "domains/order/details/components/order-details-mobile"
import { getOrder } from "@/lib/api/medusa/orders"
import { getOrderActionsByMedusaId } from "@/lib/api/orders/store-orders"

interface OrderDetailsPageProps {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ orderId?: string }>
}

export default async function OrderDetailsPage({
  params,
  searchParams,
}: OrderDetailsPageProps) {
  const { countryCode } = await params
  const { orderId } = await searchParams

  const [order, coreActions] = await Promise.all([
    orderId ? getOrder(orderId) : Promise.resolve(null),
    orderId
      ? getOrderActionsByMedusaId(orderId).catch(() => null)
      : Promise.resolve(null),
  ])

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
      }}
    >
      {/* 데스크탑 버전 - lg 이상에서만 표시 */}
      <div className="hidden lg:block">
        <MypageLayout>
          <OrderDetailsDesktop
            order={order}
            countryCode={countryCode}
            coreActions={coreActions ?? undefined}
          />
        </MypageLayout>
      </div>

      {/* 모바일 버전 - lg 미만에서만 표시 */}
      <div className="lg:hidden">
        <OrderDetailsMobile
          order={order}
          countryCode={countryCode}
          coreActions={coreActions ?? undefined}
        />
      </div>
    </WithHeaderLayout>
  )
}
