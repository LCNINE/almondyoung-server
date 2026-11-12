"use client"

import { orderLineQuantityDiscount } from "@/lib/utils/quantity-discount"
import { buildAddressLine } from "@/lib/utils/address-line"
import { cartRequiresShipping } from "@/lib/api/medusa/shipping-method-policy"
import {
  calculateMembershipDiscount,
  getOrderPointsUsed,
} from "@/lib/utils/price-utils"
import { formatDate, DATE_FORMATS } from "@/lib/utils/format-date"
import {
  getCoreDisplayStatus,
  getPaymentStatusI18nKey,
} from "@/components/orders/order-status-badges"
import type { StoreOrderActionsResponse, RefundSummary } from "@/lib/api/orders/store-orders"
import type { IssuedCashReceiptDto } from "@/lib/types/dto/wallet"
import { CashReceiptInfo } from "./cash-receipt-info"
import { paymentStatusForDisplay } from "@/lib/orders/core-order-view"
import { refundTone, resolveRefundStatus } from "@/lib/orders/refund-status"
import { REFUND_TONE_TEXT_CLASS } from "@/components/orders/refund-status-style"
import { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import OrderDetailsStatusCards from "./order-details-status-cards"
import { DepositAccountInfo } from "./deposit-account-info"
import type { BankTransferDepositAccount } from "@/lib/api/wallet"
import type { DigitalAssetOwnership } from "@lib/types/ui/library.ui"
import { OrderDigitalDownloads } from "./order-digital-downloads"
import { OrderReturnsSection } from "./order-returns-section"
import type { CustomerReturn } from "@lib/types/ui/returns"
import LocalizedClientLink from "@/components/shared/localized-client-link"

const formatAmount = (value?: number | null) =>
  `${(value ?? 0).toLocaleString()}원`

export const OrderDetailsDesktop = ({
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
  const tPaymentStatus = useTranslations("mypage.order.paymentStatus")
  const tRefundInfo = useTranslations("mypage.order.refundInfo")
  const tRefundRequest = useTranslations("mypage.order.refundRequest")

  if (!order) {
    return (
      <div className="bg-white py-10 text-center text-gray-500">
        {tLabels("notFound")}
      </div>
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
  // 정가 − 단가 중 주문 때 기록된 수량 할인 몫은 따로 보인다(기록이 없는 옛 주문은 전처럼 한 줄).
  const quantityDiscount = (order.items ?? []).reduce(
    (sum, item) => sum + orderLineQuantityDiscount(item),
    0
  )
  const membershipDiscount = Math.max(
    0,
    calculateMembershipDiscount(order.items ?? []) - quantityDiscount
  )
  const pointsUsed = getOrderPointsUsed(order.metadata)
  // 디지털 단독 주문이면 배송 정보를 숨긴다(배송이 필요한 라인이 하나도 없음).
  const requiresShipping = cartRequiresShipping(order.items)

  const deliveryStatusLabel = refundRequestStatus === "REQUESTED"
    ? tRefundRequest("requested")
    : coreActions
    ? getCoreDisplayStatus(coreActions, tStatus)
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
    <div className="bg-white py-4 font-['Pretendard'] md:px-6">
      <section className="mb-[35px] flex flex-col gap-3.5">
        <h1 className="text-2xl font-bold text-black">{tLabels("title")}</h1>
        <LocalizedClientLink
          href="/mypage/order/list"
          className="text-mint-deep text-sm"
        >
          주문 목록
        </LocalizedClientLink>
        <div className="flex w-full max-w-[813px] flex-col gap-2 bg-white">
          <p className="text-lg text-black">
            {tLabels("orderDateSuffix", {
              date: formatDate(order.created_at, DATE_FORMATS.KO_LONG),
            })}
          </p>
          <p className="text-lg text-black">
            <span className="font-bold">{tLabels("orderNumber")} </span>
            <span className="underline">
              #{order.display_id ?? order.id.slice(0, 12)}
            </span>
          </p>
        </div>
      </section>

      <section className="mb-6 space-y-3">
        <OrderDetailsStatusCards
          order={order}
          status={deliveryStatusLabel}
          coreActions={coreActions}
          returns={returns}
          intentId={intentId}
          refundRequestStatus={refundRequestStatus}
          autoOpenRefund={autoOpenRefund}
          autoOpenRefundMedia="(min-width: 1024px)"
          reviewHrefs={reviewHrefs}
          digitalOwnerships={digitalOwnerships}
        />
        {depositAccount?.accountNumber && (
          <DepositAccountInfo account={depositAccount} />
        )}
        <OrderDigitalDownloads ownerships={digitalOwnerships} />
      </section>

      {requiresShipping && (
      <section className="mb-[35px] flex flex-col gap-4">
        <h2 className="text-lg font-bold text-black">{tLabels("recipientInfo")}</h2>
        <hr className="border-t-[0.5px] border-stone-900" />
        <dl className="space-y-3">
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">{tLabels("recipient")}</dt>
            <dd className="text-base text-black">{receiverName || "-"}</dd>
          </div>
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">{tLabels("contact")}</dt>
            <dd className="text-base text-black">{address?.phone || "-"}</dd>
          </div>
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">{tLabels("postcode")}</dt>
            <dd className="text-base text-black">{postalCode}</dd>
          </div>
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">{tLabels("address")}</dt>
            <dd className="text-base text-black">{primaryAddress}</dd>
          </div>
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">
              {tLabels("addressDetail")}
            </dt>
            <dd className="text-base text-black">{detailAddress}</dd>
          </div>
          {personalCustomsCode && (
            <div className="flex gap-12">
              <dt className="w-20 shrink-0 text-base text-black">
                {tLabels("personalCustomsCode")}
              </dt>
              <dd className="text-base text-black">{personalCustomsCode}</dd>
            </div>
          )}
        </dl>
      </section>
      )}

      <section className="mb-[35px] flex flex-col gap-4">
        <h2 className="text-lg font-bold text-black">{tLabels("paymentInfo")}</h2>
        <div className="border-t-[0.5px] border-stone-900">
          <div className="grid grid-cols-2 gap-4 py-3.5">
            <div className="space-y-2">
              <p className="text-base text-black">
                {tLabels("paymentStatus")}:{" "}
                <span className="font-medium">{paymentStatusLabel}</span>
              </p>
              <p className="text-base text-black">
                {tLabels("paymentMethod")}:{" "}
                {order.payment_collections?.length
                  ? tLabels("paymentMethodRegistered")
                  : "-"}
              </p>
              {showRefundSection && (
                <div className="mt-3 space-y-1.5 rounded-md bg-gray-50 p-3">
                  <p className="text-sm font-medium text-gray-700">
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
            </div>
            <dl className="bg-gray-background space-y-2 p-3.5">
              <div className="flex items-center justify-between">
                <dt className="text-base text-black">{tLabels("totalPrice")}</dt>
                <dd className="text-base text-black">
                  {formatAmount(order.item_total)}
                </dd>
              </div>
              {/* 0원 줄은 정보가 아니라 노이즈다. 실제로 깎인 항목만 남겨 차감 흐름을 또렷하게 둔다. */}
              {order.discount_total > 0 && (
                <div className="flex items-center justify-between">
                  <dt className="text-base text-black">{tLabels("discount")}</dt>
                  <dd className="text-base text-black">
                    -{formatAmount(order.discount_total)}
                  </dd>
                </div>
              )}
              {membershipDiscount > 0 && (
                <div className="flex items-center justify-between">
                  <dt className="text-base text-black">
                    {tLabels("membershipDiscount")}
                  </dt>
                  <dd className="text-base text-black">
                    -{formatAmount(membershipDiscount)}
                  </dd>
                </div>
              )}
              {quantityDiscount > 0 && (
                <div className="flex items-center justify-between">
                  <dt className="text-base text-black">
                    {tLabels("quantityDiscount")}
                  </dt>
                  <dd className="text-base text-black">
                    -{formatAmount(quantityDiscount)}
                  </dd>
                </div>
              )}
              {requiresShipping && (
                <div className="flex items-center justify-between">
                  <dt className="text-base text-black">{tLabels("shippingFee")}</dt>
                  <dd className="text-base text-black">
                    {formatAmount(order.shipping_total)}
                  </dd>
                </div>
              )}
              {pointsUsed > 0 && (
                <div className="flex items-center justify-between font-semibold">
                  <dt className="text-base text-black">{tLabels("pointsUsed")}</dt>
                  <dd className="text-base text-black">
                    -{formatAmount(pointsUsed)}
                  </dd>
                </div>
              )}
            </dl>
          </div>
          <dl className="border-t-[0.5px] border-b-[0.5px] border-zinc-300 bg-gray-background p-3.5">
            <div className="flex items-center justify-between">
              <dt className="text-base font-bold text-black">
                {tLabels("totalPayment")}
              </dt>
              {/* 포인트는 Medusa 상 결제수단이라 order.total 에 남아 있다. 고객이 실제로 낸 현금을 보여준다.
                  브랜드 오렌지는 CTA 전용이라(DESIGN.md) 색이 아니라 크기·굵기로 위계를 준다. */}
              <dd className="text-xl font-bold text-black">
                {formatAmount(order.total - pointsUsed)}
              </dd>
            </div>
            {order.total - pointsUsed === 0 && pointsUsed > 0 && (
              <p className="mt-1 text-right text-sm text-muted-foreground">
                {tLabels("paidWithPointsOnly")}
              </p>
            )}
          </dl>
        </div>
      </section>

      {returns && returns.length > 0 && (
        <div className="mb-[35px]">
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
  )
}
