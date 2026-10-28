import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { OrderDetailsDesktop } from "domains/order/details/components/order-details-desktop"
import { OrderDetailsMobile } from "domains/order/details/components/order-details-mobile"
import { getOrder } from "@/lib/api/medusa/orders"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getOrderReturns } from "@/lib/api/medusa/returns"
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

  // 반품 목록은 부가 정보다 — 실패는 null(칸이 안 뜸), 인증 실패만 getOrderReturns 가 던져 error.tsx 로 간다
  const [rawOrder, customer, rawCoreActions, rawReturns] = await Promise.all([
    orderId ? getOrder(orderId) : Promise.resolve(null),
    retrieveCustomer(),
    orderId
      ? getOrderActionsByMedusaId(orderId).catch(() => null)
      : Promise.resolve(null),
    orderId ? getOrderReturns(orderId) : Promise.resolve(null),
  ])

  // /store/orders/:id 는 주인을 가리지 않으므로 남의 주문 id 로는 아무것도 보여주지 않는다
  const isOwner = Boolean(
    rawOrder?.customer_id && customer?.id === rawOrder.customer_id
  )
  const order = isOwner ? rawOrder : null
  const coreActions = isOwner ? rawCoreActions : null
  const returns = isOwner ? rawReturns : null

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
            returns={returns}
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
          returns={returns}
        />
      </div>
    </WithHeaderLayout>
  )
}
