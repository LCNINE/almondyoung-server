"use client"

import { cartRequiresShipping } from "@/lib/api/medusa/shipping-method-policy"
import { buildAddressLine } from "@/lib/utils/address-line"
import {
  calculateMembershipDiscount,
  getOrderPointsUsed,
} from "@/lib/utils/price-utils"
import { formatDate, DATE_FORMATS } from "@/lib/utils/format-date"
import {
  OrderInfoCardDivider,
  OrderInfoCardRoot,
  OrderInfoCardRow,
  OrderInfoCardRowItem,
} from "@/components/orders/order-info-card.atomic"
import {
  OrderStatusBadges,
  getCoreDisplayStatus,
  getPaymentStatusI18nKey,
} from "@/components/orders/order-status-badges"
import type { StoreOrderActionsResponse, RefundSummary } from "@/lib/api/orders/store-orders"
import { paymentStatusForDisplay } from "@/lib/orders/core-order-view"
import { refundTone, resolveRefundStatus } from "@/lib/orders/refund-status"
import { REFUND_TONE_TEXT_CLASS } from "@/components/orders/refund-status-style"
import type { IssuedCashReceiptDto } from "@/lib/types/dto/wallet"
import { CashReceiptInfo } from "./cash-receipt-info"
import { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import OrderDetailsStatusCards from "./order-details-status-cards"
import { DepositAccountInfo } from "./deposit-account-info"
import type { BankTransferDepositAccount } from "@/lib/api/wallet"
import type { DigitalAssetOwnership } from "@lib/types/ui/library.ui"
import { OrderDigitalDownloads } from "./order-digital-downloads"
import { OrderReturnsSection } from "./order-returns-section"
import type { CustomerReturn } from "@lib/types/ui/returns"
import { getCompletedOrderReturnStatus } from "@/components/orders/order-status-display"

const formatAmount = (value?: number | null) =>
  `${(value ?? 0).toLocaleString()}원`

export const OrderDetailsMobile = ({
  order,
  coreActions,
  cashReceipts = [],
  intentId,
  depositAccount,
  refundRequestStatus,
  digitalOwnerships = [],
  returns = null,
  autoOpenRefund = false,
  reviewHrefs = {},
}: {
  order: HttpTypes.StoreOrder | null
  countryCode: string
  coreActions?: StoreOrderActionsResponse
  cashReceipts?: IssuedCashReceiptDto[]
  intentId?: string
  depositAccount?: BankTransferDepositAccount | null
  refundRequestStatus?: string
  digitalOwnerships?: DigitalAssetOwnership[]
  returns?: CustomerReturn[] | null
  autoOpenRefund?: boolean
  reviewHrefs?: Record<string, string>
}) => {
  const tLabels = useTranslations("mypage.order.labels")
  const tStatus = useTranslations("mypage.order.status")
  const tItemReturn = useTranslations("mypage.order.list.itemReturn")
  const tPaymentStatus = useTranslations("mypage.order.paymentStatus")
  const tRefundInfo = useTranslations("mypage.order.refundInfo")
  const tRefundRequest = useTranslations("mypage.order.refundRequest")

  if (!order) {
    return (
      <main className="min-h-screen bg-[#f8f8f8] p-4 text-center text-gray-500">
        {tLabels("notFound")}
      </main>
    )
  }

  const address = order.shipping_address
  const receiverName = [address?.first_name, address?.last_name]
    .filter(Boolean)
    .join(" ")
  const addressLine = buildAddressLine({
    province: address?.province,
    city: address?.city,
    address1: address?.address_1,
    address2: address?.address_2,
  })
  const postalCode = address?.postal_code || "-"
  const primaryAddress = address?.address_1 || addressLine || "-"
  const detailAddress = address?.address_2 || "-"
  // 해외직구 주문만 채워짐(체크아웃에서 shipping_address.metadata 에 저장).
  const personalCustomsCode =
    (address?.metadata?.personalCustomsCode as string) || ""
  const membershipDiscount = calculateMembershipDiscount(order.items ?? [])
  const pointsUsed = getOrderPointsUsed(order.metadata)
  // 디지털 단독 주문이면 배송 정보를 숨긴다.
  const requiresShipping = cartRequiresShipping(order.items)

  const deliveryStatusLabel = refundRequestStatus === "REQUESTED"
    ? tRefundRequest("requested")
    : coreActions
    ? getCoreDisplayStatus(coreActions)
    : tStatus(
        order.status === "canceled"
          ? "orderCancel"
          : // captured 후 'confirmed' metadata 갱신 실패로 awaiting_deposit 가 남아도
            // 결제완료(captured)면 '입금확인중' 으로 표시하지 않음 (WMS 수집 게이트와 동일 불변식)
            (order.metadata as Record<string, unknown> | null)
                  ?.bank_transfer_status === "awaiting_deposit" &&
              order.payment_status !== "captured"
            ? "depositPending"
          : order.fulfillment_status === "fulfilled"
            ? "delivered"
            : order.fulfillment_status === "shipped"
              ? "shipping"
              : order.fulfillment_status === "partially_fulfilled"
                ? "partialShipping"
                : order.fulfillment_status === "not_fulfilled"
                  ? "preparing"
                  : order.payment_status === "awaiting"
                    ? "paymentPending"
                    : "paid"
      )

  const completedReturnStatus = getCompletedOrderReturnStatus(
    order.items,
    returns
  )
  const statusLabel = completedReturnStatus
    ? tItemReturn(completedReturnStatus)
    : deliveryStatusLabel

  const paymentStatusLabel = tPaymentStatus(
    getPaymentStatusI18nKey(paymentStatusForDisplay(order.payment_status ?? "", coreActions))
  )

  const refundSummary: RefundSummary | undefined = coreActions?.refundSummary
  const refundStatus = resolveRefundStatus(coreActions)
  const refundStatusTone = refundTone(refundStatus)
  const refundStatusBadgeLabel = tRefundInfo(`statusLabels.${refundStatus}`)
  const refundGuidance = tRefundInfo(`guidance.${refundStatus}`)
  const showRefundSection = refundStatus !== "none"

  return (
    <main className="min-h-screen w-full bg-[#f8f8f8] font-sans">
      <div className="p-4 pb-24">
        <header className="mb-3 flex items-center justify-between text-sm">
          <h2 className="text-[13px] font-bold text-gray-800">
            {tLabels("orderDateSuffix", {
              date: formatDate(order.created_at, DATE_FORMATS.KO_LONG),
            })}
          </h2>
          <span className="text-gray-500">
            {tLabels("orderNumberSuffix", {
              number: order.display_id ?? order.id.slice(0, 12),
            })}
          </span>
        </header>

        <section className="mb-6 space-y-3">
          <OrderDetailsStatusCards
            order={order}
            status={deliveryStatusLabel}
            coreActions={coreActions}
            returns={returns}
            intentId={intentId}
            refundRequestStatus={refundRequestStatus}
            autoOpenRefund={autoOpenRefund}
            autoOpenRefundMedia="(max-width: 1023px)"
            reviewHrefs={reviewHrefs}
            digitalOwnerships={digitalOwnerships}
          />
          {depositAccount?.accountNumber && (
            <DepositAccountInfo account={depositAccount} />
          )}
          <OrderDigitalDownloads ownerships={digitalOwnerships} />
        </section>

        <section aria-labelledby="payment-details-title">
          <h3 id="payment-details-title" className="sr-only">
            {tLabels("paymentInfo")}
          </h3>
          <OrderInfoCardRoot className="p-4">
            <OrderInfoCardRow className="mb-2">
              <OrderInfoCardRowItem className="text-gray-500">
                {tLabels("totalPrice")}
              </OrderInfoCardRowItem>
              <OrderInfoCardRowItem className="text-right text-gray-800">
                {formatAmount(order.item_total)}
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
            {requiresShipping && (
              <OrderInfoCardRow className="mb-2">
                <OrderInfoCardRowItem className="text-gray-500">
                  {tLabels("shippingFee")}
                </OrderInfoCardRowItem>
                <OrderInfoCardRowItem className="text-right text-gray-800">
                  {formatAmount(order.shipping_total)}
                </OrderInfoCardRowItem>
              </OrderInfoCardRow>
            )}
            {/* 0원 줄은 정보가 아니라 노이즈다. 실제로 깎인 항목만 남겨 차감 흐름을 또렷하게 둔다. */}
            {order.discount_total > 0 && (
              <OrderInfoCardRow className="mb-2">
                <OrderInfoCardRowItem className="text-gray-500">
                  {tLabels("discount")}
                </OrderInfoCardRowItem>
                <OrderInfoCardRowItem className="text-right text-gray-800">
                  -{formatAmount(order.discount_total)}
                </OrderInfoCardRowItem>
              </OrderInfoCardRow>
            )}
            {membershipDiscount > 0 && (
              <OrderInfoCardRow className="mb-2">
                <OrderInfoCardRowItem className="text-gray-500">
                  {tLabels("membershipDiscount")}
                </OrderInfoCardRowItem>
                <OrderInfoCardRowItem className="text-right text-gray-800">
                  -{formatAmount(membershipDiscount)}
                </OrderInfoCardRowItem>
              </OrderInfoCardRow>
            )}
            {pointsUsed > 0 && (
              <OrderInfoCardRow className="mb-2 font-semibold">
                <OrderInfoCardRowItem className="text-gray-500">
                  {tLabels("pointsUsed")}
                </OrderInfoCardRowItem>
                <OrderInfoCardRowItem className="text-right text-gray-800">
                  -{formatAmount(pointsUsed)}
                </OrderInfoCardRowItem>
              </OrderInfoCardRow>
            )}
            <OrderInfoCardRow>
              <OrderInfoCardRowItem className="font-bold text-gray-800">
                {tLabels("totalPaymentMobile")}
              </OrderInfoCardRowItem>
              {/* 포인트는 Medusa 상 결제수단이라 order.total 에 남아 있다. 실제로 낸 현금을 보여준다.
                  브랜드 오렌지는 CTA 전용이라(DESIGN.md) 색이 아니라 크기·굵기로 위계를 준다. */}
              <OrderInfoCardRowItem className="text-right text-lg font-bold text-gray-800">
                {formatAmount(order.total - pointsUsed)}
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
            {order.total - pointsUsed === 0 && pointsUsed > 0 && (
              <p className="mt-1 text-right text-xs text-gray-500">
                {tLabels("paidWithPointsOnly")}
              </p>
            )}
          </OrderInfoCardRoot>
        </section>

        {requiresShipping && (
        <section aria-labelledby="shipping-info-title" className="mt-3">
          <OrderInfoCardRoot className="p-4">
            <h3
              id="shipping-info-title"
              className="text-base font-bold text-gray-800"
            >
              {receiverName || "-"}
            </h3>
            <p className="mt-1 text-sm text-gray-600">{address?.phone || "-"}</p>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex">
                <dt className="w-20 shrink-0 text-gray-500">
                  {tLabels("postcode")}
                </dt>
                <dd className="text-gray-800">{postalCode}</dd>
              </div>
              <div className="flex">
                <dt className="w-20 shrink-0 text-gray-500">
                  {tLabels("address")}
                </dt>
                <dd className="text-gray-800">{primaryAddress}</dd>
              </div>
              <div className="flex">
                <dt className="w-20 shrink-0 text-gray-500">
                  {tLabels("addressDetail")}
                </dt>
                <dd className="text-gray-800">{detailAddress}</dd>
              </div>
              {personalCustomsCode && (
                <div className="flex">
                  <dt className="w-20 shrink-0 text-gray-500">
                    {tLabels("personalCustomsCode")}
                  </dt>
                  <dd className="text-gray-800">{personalCustomsCode}</dd>
                </div>
              )}
            </dl>
            <OrderInfoCardDivider />
            <dl className="flex text-sm">
              <dt className="w-24 shrink-0 text-gray-500">
                {tLabels("status")}
              </dt>
              <dd className="text-gray-800">{statusLabel}</dd>
            </dl>
            {coreActions && (
              <div className="mt-2">
                <OrderStatusBadges actions={coreActions} refundRequestStatus={refundRequestStatus} />
              </div>
            )}
            <OrderInfoCardDivider />
            <dl className="space-y-1.5 text-sm">
              <div className="flex">
                <dt className="w-24 shrink-0 text-gray-500">{tLabels("paymentStatus")}</dt>
                <dd className="font-medium text-gray-800">{paymentStatusLabel}</dd>
              </div>
              <div className="flex">
                <dt className="w-24 shrink-0 text-gray-500">{tLabels("paymentMethod")}</dt>
                <dd className="text-gray-800">
                  {order.payment_collections?.length
                    ? tLabels("paymentMethodRegistered")
                    : "-"}
                </dd>
              </div>
            </dl>
            {showRefundSection && (
              <div className="mt-3 rounded-md bg-gray-50 p-3 space-y-1.5">
                <p className="text-xs font-medium text-gray-700">
                  {tRefundInfo("sectionTitle")}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{tRefundInfo("statusLabel")}:</span>
                  <span
                    className={`text-xs font-medium ${refundStatusTone ? REFUND_TONE_TEXT_CLASS[refundStatusTone] : ""}`}
                  >
                    {refundStatusBadgeLabel}
                  </span>
                </div>
                {refundSummary?.amount != null && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{tRefundInfo("refundAmountLabel")}:</span>
                    <span className="text-xs text-gray-800">{formatAmount(refundSummary.amount)}</span>
                  </div>
                )}
                {refundSummary?.paymentMethodLabel && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{tRefundInfo("refundMethodLabel")}:</span>
                    <span className="text-xs text-gray-800">{refundSummary.paymentMethodLabel}</span>
                  </div>
                )}
                {refundStatus === "succeeded" && refundSummary?.lastUpdatedAt && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{tRefundInfo("refundDateLabel")}:</span>
                    <span className="text-xs text-gray-800">
                      {formatDate(refundSummary.lastUpdatedAt, DATE_FORMATS.KO_DOT)}
                    </span>
                  </div>
                )}
                {(refundSummary?.expectedProcessingMessage ?? refundGuidance) ? (
                  <p className="text-xs text-gray-500">
                    {refundSummary?.expectedProcessingMessage ?? refundGuidance}
                  </p>
                ) : null}
              </div>
            )}
            <CashReceiptInfo cashReceipts={cashReceipts} />
          </OrderInfoCardRoot>
        </section>
        )}

        {returns && returns.length > 0 && (
          <div className="border-border-muted border-t p-4">
            <OrderReturnsSection
              orderId={order.id}
              returns={returns}
              items={(order.items ?? []).map((i) => ({
                id: i.id,
                title: i.title,
                variantTitle: i.variant?.title ?? null,
              }))}
            />
          </div>
        )}
      </div>
    </main>
  )
}
