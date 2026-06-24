"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { buildAddressLine } from "@/lib/utils/address-line"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { calculateMembershipDiscount } from "@/lib/utils/price-utils"
import { formatDate, DATE_FORMATS } from "@/lib/utils/format-date"
import {
  OrderInfoCardDivider,
  OrderInfoCardRoot,
  OrderInfoCardRow,
  OrderInfoCardRowItem,
} from "@components/orders/order-info-card.atomic"
import {
  OrderStatusBadges,
  getCoreDisplayStatus,
  CANCEL_UNAVAILABLE_MESSAGES,
  getPaymentStatusI18nKey,
} from "@/components/orders/order-status-badges"
import {
  CancelReasonForm,
  type CancelReasonCode,
} from "@/components/orders/cancel-reason-form"
import type { StoreOrderActionsResponse, StoreRefundStatus, RefundSummary } from "@/lib/api/orders/store-orders"
import { cancelOrderByMedusaId } from "@/lib/api/orders/store-orders"
import { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

const formatAmount = (value?: number | null) =>
  `${(value ?? 0).toLocaleString()}원`

export const OrderDetailsMobile = ({
  order,
  coreActions,
}: {
  order: HttpTypes.StoreOrder | null
  countryCode: string
  coreActions?: StoreOrderActionsResponse
}) => {
  const tLabels = useTranslations("mypage.order.labels")
  const tStatus = useTranslations("mypage.order.status")
  const tActions = useTranslations("mypage.order.actions")
  const tPaymentStatus = useTranslations("mypage.order.paymentStatus")
  const tRefundInfo = useTranslations("mypage.order.refundInfo")
  const router = useRouter()
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [isCancelling, startCancelTransition] = useTransition()
  const [cancelReasonCode, setCancelReasonCode] =
    useState<CancelReasonCode>("CHANGE_OF_MIND")
  const [cancelReasonDetail, setCancelReasonDetail] = useState("")

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
  const membershipDiscount = calculateMembershipDiscount(order.items ?? [])

  const availableActions = coreActions?.availableActions ?? []
  const canCancel = availableActions.includes("cancel")
  const canTrack = availableActions.includes("track")
  const canReturn = availableActions.includes("return")
  const canExchange = availableActions.includes("exchange")
  const cancelUnavailableReason = coreActions?.cancelUnavailableReason
  const cancelTooltip = cancelUnavailableReason
    ? CANCEL_UNAVAILABLE_MESSAGES[cancelUnavailableReason]
    : undefined

  const showTrack =
    canTrack ||
    order.fulfillment_status === "shipped" ||
    order.fulfillment_status === "fulfilled" ||
    order.fulfillment_status === "partially_fulfilled"

  const statusLabel = coreActions
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

  const paymentStatusLabel = tPaymentStatus(
    getPaymentStatusI18nKey(order.payment_status ?? "")
  )

  const refundSummary: RefundSummary | undefined = coreActions?.refundSummary
  const refundStatus: StoreRefundStatus = refundSummary?.status ?? coreActions?.refundStatus ?? "none"
  const refundStatusBadgeLabel = tRefundInfo(`statusLabels.${refundStatus}`)
  const refundGuidance = tRefundInfo(`guidance.${refundStatus}`)
  const showRefundSection = refundStatus !== "none"

  const handleCancelConfirm = () => {
    startCancelTransition(async () => {
      try {
        const result = await cancelOrderByMedusaId(order.id, {
          reasonCode: cancelReasonCode,
          reasonDetail:
            cancelReasonCode === "OTHER" && cancelReasonDetail
              ? cancelReasonDetail
              : undefined,
        })
        const message =
          result.refundStatus === "succeeded"
            ? tActions("cancelSuccess")
            : result.refundStatus === "pending"
              ? tActions("cancelSuccessPending")
              : result.refundStatus === "failed"
                ? tActions("cancelSuccessFailed")
                : result.refundStatus === "manual_pending"
                  ? tActions("cancelSuccessManual")
                  : tActions("cancelOrder")
        toast.success(message)
        setShowCancelDialog(false)
        router.refresh()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : undefined
        toast.error(message ?? tActions("cancelError"))
      }
    })
  }

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
            <OrderInfoCardRow className="mb-2">
              <OrderInfoCardRowItem className="text-gray-500">
                {tLabels("shippingFee")}
              </OrderInfoCardRowItem>
              <OrderInfoCardRowItem className="text-right text-gray-800">
                {formatAmount(order.shipping_total)}
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
            <OrderInfoCardRow className="mb-2">
              <OrderInfoCardRowItem className="text-gray-500">
                {tLabels("discount")}
              </OrderInfoCardRowItem>
              <OrderInfoCardRowItem className="text-right text-gray-800">
                {formatAmount(order.discount_total)}
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
            {membershipDiscount > 0 && (
              <OrderInfoCardRow className="mb-2">
                <OrderInfoCardRowItem className="text-gray-500">
                  {tLabels("membershipDiscount")}
                </OrderInfoCardRowItem>
                <OrderInfoCardRowItem className="text-right text-gray-800">
                  {formatAmount(membershipDiscount)}
                </OrderInfoCardRowItem>
              </OrderInfoCardRow>
            )}
            <OrderInfoCardRow>
              <OrderInfoCardRowItem className="font-bold text-gray-800">
                {tLabels("totalPaymentMobile")}
              </OrderInfoCardRowItem>
              <OrderInfoCardRowItem className="text-right font-bold text-gray-800">
                {formatAmount(order.total)}
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
          </OrderInfoCardRoot>
        </section>

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
                <OrderStatusBadges actions={coreActions} />
              </div>
            )}
            {cancelUnavailableReason &&
              !canCancel &&
              cancelUnavailableReason !== "already_cancelled" && (
                <p className="mt-1 text-[11px] text-amber-600">{cancelTooltip}</p>
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
                    className={`text-xs font-medium ${
                      refundStatus === "succeeded"
                        ? "text-green-600"
                        : refundStatus === "pending"
                          ? "text-amber-600"
                          : refundStatus === "manual_pending"
                            ? "text-amber-600"
                            : "text-red-500"
                    }`}
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
          </OrderInfoCardRoot>
        </section>

        <section className="mt-3 rounded-lg bg-white shadow-sm">
          <div className="p-4">
            <h3 className="font-bold text-gray-800">{statusLabel}</h3>
            <p className="mt-2 text-sm text-gray-500">
              {tLabels("items", { count: order.items?.length ?? 0 })}
            </p>
          </div>

          <div className="border-border-muted border-t p-4">
            {order.items?.map((item) => {
              const thumbnail = getThumbnailUrl(
                item.thumbnail ?? item.variant?.product?.thumbnail ?? ""
              )
              return (
                <article
                  key={item.id}
                  className="flex gap-3 py-3 first:pt-0 last:pb-0"
                >
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={item.title}
                      className="h-20 w-20 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <div className="h-20 w-20 shrink-0 rounded-md bg-gray-100" />
                  )}
                  <div className="flex-grow">
                    <p className="font-semibold text-gray-800">{item.title}</p>
                    <p className="mt-1 text-sm text-gray-500">
                      {formatAmount(item.unit_price)} · {item.quantity}
                    </p>
                    {item.variant?.title && item.variant.title !== "Default" && (
                      <p className="mt-1 text-xs text-gray-400">
                        - {item.variant.title}
                      </p>
                    )}
                  </div>
                  <CustomButton variant="outline" size="sm">
                    {tActions("addToCart")}
                  </CustomButton>
                </article>
              )
            })}
          </div>

          <div className="border-border-muted mt-2 flex flex-wrap gap-2 border-t p-4">
            {showTrack && (
              <LocalizedClientLink
                href={`/mypage/order/track?orderId=${order.id}`}
              >
                <CustomButton variant="outline" size="sm">
                  {tActions("trackDelivery")}
                </CustomButton>
              </LocalizedClientLink>
            )}
            {canReturn && (
              <LocalizedClientLink
                href={`/mypage/exchange?orderId=${order.id}&type=return`}
              >
                <CustomButton variant="outline" size="sm">
                  {tActions("returnRequest")}
                </CustomButton>
              </LocalizedClientLink>
            )}
            {canExchange && (
              <LocalizedClientLink
                href={`/mypage/exchange?orderId=${order.id}&type=exchange`}
              >
                <CustomButton variant="outline" size="sm">
                  {tActions("exchangeRequest")}
                </CustomButton>
              </LocalizedClientLink>
            )}
            {canCancel && (
              <CustomButton
                variant="outline"
                size="sm"
                onClick={() => setShowCancelDialog(true)}
                className="text-red-600 outline-red-300"
              >
                {tActions("cancelOrder")}
              </CustomButton>
            )}
            {!canCancel &&
              cancelUnavailableReason &&
              cancelUnavailableReason !== "already_cancelled" && (
                <CustomButton variant="outline" size="sm" disabled>
                  {tActions("cancelOrder")}
                </CustomButton>
              )}
          </div>
        </section>
      </div>

      <Dialog
        open={showCancelDialog}
        onOpenChange={(open) => {
          setShowCancelDialog(open)
          if (!open) {
            setCancelReasonCode("CHANGE_OF_MIND")
            setCancelReasonDetail("")
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tActions("cancelDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground text-xs">
              {tActions("cancelDialogDescription")}
            </p>
            <CancelReasonForm
              reasonCode={cancelReasonCode}
              reasonDetail={cancelReasonDetail}
              onReasonCodeChange={setCancelReasonCode}
              onReasonDetailChange={setCancelReasonDetail}
            />
          </div>
          <DialogFooter>
            <CustomButton
              variant="outline"
              color="secondary"
              size="md"
              onClick={() => setShowCancelDialog(false)}
              disabled={isCancelling}
            >
              {tActions("cancelGoBack")}
            </CustomButton>
            <CustomButton
              variant="fill"
              color="primary"
              size="md"
              onClick={handleCancelConfirm}
              isLoading={isCancelling}
            >
              {tActions("cancelConfirm")}
            </CustomButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
