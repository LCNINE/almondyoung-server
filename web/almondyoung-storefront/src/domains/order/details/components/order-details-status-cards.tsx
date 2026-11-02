"use client"

import { cartRequiresShipping } from "@/lib/api/medusa/shipping-method-policy"
import { showTrackLink } from "@/lib/orders/core-order-view"
import { useTranslations } from "next-intl"
import type { HttpTypes } from "@medusajs/types"
import type { StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"
import type { CustomerReturn } from "@/lib/types/ui/returns"
import type { DigitalAssetOwnership } from "@/lib/types/ui/library.ui"
import OrderActions from "@/components/orders/order-card/order-actions"
import OrderStatusCards from "@/components/orders/order-card/order-status-cards"
import { mapOrderSummaryItems } from "@/components/orders/order-card/order-summary-items"

export default function OrderDetailsStatusCards({
  order,
  status,
  coreActions,
  returns,
  intentId,
  refundRequestStatus,
  autoOpenRefund,
  autoOpenRefundMedia,
  digitalOwnerships,
  reviewHrefs,
}: {
  order: HttpTypes.StoreOrder
  status: string
  coreActions?: StoreOrderActionsResponse
  returns: CustomerReturn[] | null
  intentId?: string
  refundRequestStatus?: string
  autoOpenRefund?: boolean
  /** 데스크톱·모바일 화면이 둘 다 마운트되므로 보이는 쪽만 자동으로 연다 */
  autoOpenRefundMedia?: string
  reviewHrefs?: Record<string, string>
  digitalOwnerships: DigitalAssetOwnership[]
}) {
  const tList = useTranslations("mypage.order.list")
  const items = mapOrderSummaryItems(order, returns ?? [], tList, reviewHrefs)
  const bankTransferStatus = order.metadata?.bank_transfer_status as
    | string
    | undefined
  const awaitingDeposit =
    bankTransferStatus === "awaiting_deposit" &&
    order.payment_status !== "captured"

  return (
    <OrderActions
      orderId={order.id}
      paymentStatus={order.payment_status ?? ""}
      productName={items[0]?.title ?? tList("defaultProductName")}
      orderNumber={order.display_id ? `#${order.display_id}` : undefined}
      itemCount={items.length}
      coreActions={coreActions}
      bankTransferStatus={bankTransferStatus}
      refundRequestStatus={refundRequestStatus}
      refundIntentId={intentId}
      autoOpenRefund={autoOpenRefund && items.some((item) => !item.statusLabel)}
      autoOpenRefundMedia={autoOpenRefundMedia}
      refundBlocked={digitalOwnerships.some(
        (ownership) => !!ownership.exercisedAt
      )}
      hasReturns={items.some((item) => item.statusLabel)}
      trackingHref={
        showTrackLink({
          requiresShipping: cartRequiresShipping(order.items),
          canTrack: coreActions?.availableActions.includes("track") ?? false,
          medusaFulfillmentStatus: order.fulfillment_status,
          actions: coreActions,
        })
          ? `/mypage/order/track?orderId=${encodeURIComponent(order.id)}`
          : undefined
      }
      isDetails
    >
      {(actions) => (
        <OrderStatusCards
          status={status}
          items={items}
          hideDigitalDownload={digitalOwnerships.length > 0}
          paymentStatusLabel={awaitingDeposit ? "입금 대기" : undefined}
        >
          {actions}
        </OrderStatusCards>
      )}
    </OrderActions>
  )
}
