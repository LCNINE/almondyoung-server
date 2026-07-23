import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { OrderDetailsDesktop } from "domains/order/details/components/order-details-desktop"
import { OrderDetailsMobile } from "domains/order/details/components/order-details-mobile"
import { getOrder } from "@/lib/api/medusa/orders"
import { getOrderActionsByMedusaId } from "@/lib/api/orders/store-orders"
import { getCashReceipts, getBankTransferDepositAccount, getActiveRefundRequest } from "@/lib/api/wallet"
import { getOwnerships } from "@/lib/api/library/library-api"

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

  // 결제 세션 data.intentId(wallet) 로 발급된 현금영수증 조회. 없으면 빈 배열.
  const intentId = (
    order?.payment_collections?.[0]?.payment_sessions?.[0]?.data as
      | Record<string, unknown>
      | undefined
  )?.intentId as string | undefined
  // coreActions.orderId = Core sales order id. 디지털 ownership 은 이 id 로 발급된다.
  const coreOrderId = coreActions?.orderId
  const [cashReceipts, depositAccount, refundRequest, ownerships] =
    await Promise.all([
      intentId ? getCashReceipts(intentId) : Promise.resolve([]),
      intentId ? getBankTransferDepositAccount(intentId) : Promise.resolve(null),
      intentId ? getActiveRefundRequest(intentId) : Promise.resolve(null),
      coreOrderId
        ? getOwnerships({ skip: 0, take: 100, salesOrderId: coreOrderId }).catch(
            () => null
          )
        : Promise.resolve(null),
    ])
  const digitalOwnerships = ownerships?.data ?? []

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
            cashReceipts={cashReceipts}
            intentId={intentId}
            depositAccount={depositAccount}
            refundRequestStatus={refundRequest?.status}
            digitalOwnerships={digitalOwnerships}
          />
        </MypageLayout>
      </div>

      {/* 모바일 버전 - lg 미만에서만 표시 */}
      <div className="lg:hidden">
        <OrderDetailsMobile
          order={order}
          countryCode={countryCode}
          coreActions={coreActions ?? undefined}
          cashReceipts={cashReceipts}
          intentId={intentId}
          depositAccount={depositAccount}
          refundRequestStatus={refundRequest?.status}
          digitalOwnerships={digitalOwnerships}
        />
      </div>
    </WithHeaderLayout>
  )
}
