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

export const OrderDetailsDesktop = ({
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

  const statusLabel = coreActions
    ? getCoreDisplayStatus(coreActions)
    : tStatus(
        order.status === "canceled"
          ? "orderCancel"
          : (order.metadata as Record<string, unknown> | null)
                ?.bank_transfer_status === "awaiting_deposit"
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
    <div className="bg-white py-4 font-['Pretendard'] md:px-6">
      <section className="mb-[35px] flex flex-col gap-3.5">
        <h1 className="text-2xl font-bold text-black">{tLabels("title")}</h1>
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

      <section className="mb-[35px] space-y-3 border border-gray-200 p-7">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-black">{statusLabel}</h2>
          <OrderStatusBadges actions={coreActions} medusaStatus={order.status} />
        </div>
        {order.items?.map((item) => {
          const thumbnail = getThumbnailUrl(
            item.thumbnail ?? item.variant?.product?.thumbnail ?? ""
          )
          return (
            <article
              key={item.id}
              className="flex items-end gap-6 border-b border-gray-100 py-4 last:border-b-0"
            >
              <figure className="shrink-0">
                {thumbnail ? (
                  <img
                    className="h-24 w-24 rounded-[5px] border border-gray-200 object-cover"
                    src={thumbnail}
                    alt={item.title}
                  />
                ) : (
                  <div className="h-24 w-24 rounded-[5px] border border-gray-200 bg-gray-100" />
                )}
              </figure>
              <div className="min-w-32 flex-1">
                <h3 className="text-lg text-black">{item.title}</h3>
                <p className="mt-2 text-base text-gray-600">
                  {formatAmount(item.unit_price)} · {item.quantity}
                </p>
                {item.variant?.title && item.variant.title !== "Default" && (
                  <p className="mt-1 text-sm text-gray-500">
                    - {item.variant.title}
                  </p>
                )}
              </div>
              <CustomButton variant="outline" color="secondary" size="sm">
                {tActions("addToCart")}
              </CustomButton>
            </article>
          )
        })}
      </section>

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
        </dl>
      </section>

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
            </div>
            <dl className="bg-gray-background space-y-2 p-3.5">
              <div className="flex items-center justify-between">
                <dt className="text-base text-black">{tLabels("totalPrice")}</dt>
                <dd className="text-base text-black">
                  {formatAmount(order.item_total)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-base text-black">{tLabels("discount")}</dt>
                <dd className="text-base text-black">
                  {formatAmount(order.discount_total)}
                </dd>
              </div>
              {membershipDiscount > 0 && (
                <div className="flex items-center justify-between">
                  <dt className="text-base text-black">
                    {tLabels("membershipDiscount")}
                  </dt>
                  <dd className="text-base text-black">
                    {formatAmount(membershipDiscount)}
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between">
                <dt className="text-base text-black">{tLabels("shippingFee")}</dt>
                <dd className="text-base text-black">
                  {formatAmount(order.shipping_total)}
                </dd>
              </div>
            </dl>
          </div>
          <dl className="border-t-[0.5px] border-b-[0.5px] border-zinc-300 bg-gray-background p-3.5">
            <div className="flex items-center justify-between">
              <dt className="text-base font-bold text-black">
                {tLabels("totalPayment")}
              </dt>
              <dd className="text-base font-bold text-black">
                {formatAmount(order.total)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="flex justify-center gap-2.5">
        <LocalizedClientLink
          href="/mypage/order/list"
          className="inline-flex items-center justify-center rounded-[5px] px-4 py-3 text-sm font-medium text-amber-500 outline-1 outline-amber-500"
        >
          {tActions("backToList")}
        </LocalizedClientLink>
        {canTrack && (
          <LocalizedClientLink
            href={`/mypage/order/track?orderId=${order.id}`}
            className="inline-flex items-center justify-center rounded-[5px] px-4 py-3 text-sm text-black outline-1 outline-zinc-400"
          >
            {tActions("trackDelivery")}
          </LocalizedClientLink>
        )}
        {!canTrack &&
          (order.fulfillment_status === "shipped" ||
            order.fulfillment_status === "fulfilled" ||
            order.fulfillment_status === "partially_fulfilled") && (
            <LocalizedClientLink
              href={`/mypage/order/track?orderId=${order.id}`}
              className="inline-flex items-center justify-center rounded-[5px] px-4 py-3 text-sm text-black outline-1 outline-zinc-400"
            >
              {tActions("trackDelivery")}
            </LocalizedClientLink>
          )}
        {canReturn && (
          <LocalizedClientLink
            href={`/mypage/exchange?orderId=${order.id}&type=return`}
            className="inline-flex items-center justify-center rounded-[5px] px-4 py-3 text-sm text-black outline-1 outline-zinc-400"
          >
            {tActions("returnRequest")}
          </LocalizedClientLink>
        )}
        {canExchange && (
          <LocalizedClientLink
            href={`/mypage/exchange?orderId=${order.id}&type=exchange`}
            className="inline-flex items-center justify-center rounded-[5px] px-4 py-3 text-sm text-black outline-1 outline-zinc-400"
          >
            {tActions("exchangeRequest")}
          </LocalizedClientLink>
        )}
        {canCancel && (
          <button
            type="button"
            onClick={() => setShowCancelDialog(true)}
            className="inline-flex items-center justify-center rounded-[5px] px-4 py-3 text-sm text-red-600 outline-1 outline-red-300"
          >
            {tActions("cancelOrder")}
          </button>
        )}
        {!canCancel && cancelUnavailableReason && cancelUnavailableReason !== "already_cancelled" && (
          <span
            className="inline-flex cursor-not-allowed items-center justify-center rounded-[5px] px-4 py-3 text-sm text-gray-400 outline-1 outline-gray-200"
            title={cancelTooltip}
          >
            {tActions("cancelOrder")}
          </span>
        )}
      </section>

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
    </div>
  )
}
