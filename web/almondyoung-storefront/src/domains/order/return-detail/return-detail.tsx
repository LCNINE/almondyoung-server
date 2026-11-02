import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import type {
  CustomerReturn,
  CustomerReturnProgress,
} from "@/lib/types/ui/returns"
import { buildAddressLine } from "@/lib/utils/address-line"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import type { HttpTypes } from "@medusajs/types"
import { getFormatter, getTranslations } from "next-intl/server"
import type { ReactNode } from "react"
import { itemReturnStatus, originalLineTotal } from "../list/item-return-status"
import { RETURN_REASON_LABEL_KEYS } from "../return-request/return-reasons"
import {
  pickupLabelKey,
  receiptItemAmounts,
  returnedAmount,
} from "./return-detail-view"
import {
  CancellationReceiptDialog,
  PickupTrackingButton,
} from "./return-detail-actions"

interface ReturnDetailProps {
  order: HttpTypes.StoreOrder
  ret: CustomerReturn
  progress: CustomerReturnProgress | null
  paymentMethodLabel: string | null
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="border-foreground border-t text-sm">{children}</dl>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-border grid grid-cols-[96px_minmax(0,1fr)] border-b md:grid-cols-[140px_minmax(0,1fr)]">
      <dt className="bg-muted text-muted-foreground px-3 py-3 md:whitespace-nowrap">
        {label}
      </dt>
      <dd className="text-foreground min-w-0 px-3 py-3 break-words">
        {children}
      </dd>
    </div>
  )
}

function SectionTitle({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-foreground text-base font-bold md:text-lg">
        {children}
      </h2>
      {action}
    </div>
  )
}

export default async function ReturnDetail({
  order,
  ret,
  progress,
  paymentMethodLabel: realPaymentMethodLabel,
}: ReturnDetailProps) {
  // 시안 확인용 고정값. 실제 카드사·할부를 받으면 지운다
  const paymentMethodLabel = realPaymentMethodLabel ?? "KB 기업카드 / 일시불"
  const t = await getTranslations("mypage.order.returnDetail")
  const tList = await getTranslations("mypage.order.list")
  const tReason = await getTranslations("mypage.order.returnRequest")
  const format = await getFormatter()

  const won = (value: number) => t("amount", { value: format.number(value) })
  const exchange = ret.kind === "exchange"
  const canceled = ret.stage === "canceled"

  const itemsById = new Map((order.items ?? []).map((i) => [i.id, i]))
  const status = itemReturnStatus(ret.items[0]?.itemId ?? "", [ret])
  const statusLabel = canceled
    ? t("canceled")
    : status
      ? tList(`itemReturn.${status.key}`)
      : ""

  const address = order.shipping_address
  const receiverName = [address?.first_name, address?.last_name]
    .filter(Boolean)
    .join(" ")
  const addressLine = [
    address?.postal_code,
    buildAddressLine({
      province: address?.province,
      city: address?.city,
      address1: address?.address_1,
      address2: address?.address_2,
    }),
  ]
    .filter(Boolean)
    .join(" ")

  const reasonKey = RETURN_REASON_LABEL_KEYS[ret.reason] ?? "reason.unknown"
  // 최종 정산이 끝난 날만 완료일로 표시해요.
  const completedAt = exchange
    ? ret.stage === "exchanged"
      ? (progress?.settledAt ?? null)
      : null
    : ret.stage === "refunded" && ret.refund?.kind === "settled"
      ? ret.refund.refundedAt
      : null

  const refund = ret.refund
  const receiptAmounts = refund
    ? receiptItemAmounts(order.items ?? [], ret.items, refund.itemTotal)
    : null
  const refundTotalKey =
    refund?.kind === "prepaid"
      ? refund.refundedAt
        ? "refund.prepaid"
        : "refund.prepaidPending"
      : refund?.refundedAt
        ? "refund.done"
        : "refund.planned"

  const productRows = ret.items.map((returned) => {
    const item = itemsById.get(returned.itemId)
    const amount = item
      ? returnedAmount(
          originalLineTotal(item),
          item.quantity ?? 0,
          returned.quantity
        )
      : null

    return {
      id: returned.itemId,
      product: (
        <div className="flex items-center gap-3">
          {item?.thumbnail && (
            <img
              className="border-border h-16 w-16 shrink-0 rounded-md border object-cover"
              src={getThumbnailUrl(item.thumbnail)}
              alt={item.title ?? ""}
            />
          )}
          <div className="min-w-0 break-words">
            <p className="text-foreground font-medium">
              {item?.title ?? t("unknownItem")}
            </p>
            {item?.variant_title && item.variant_title !== "Default" && (
              <p className="text-muted-foreground text-xs">
                {item.variant_title}
              </p>
            )}
          </div>
        </div>
      ),
      amount: (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">
            {t("quantity", { count: returned.quantity })}
          </p>
          <p className="font-medium">{amount === null ? "-" : won(amount)}</p>
        </div>
      ),
      status: (
        <div className="flex flex-col items-start gap-3">
          <p className="text-foreground font-bold">{statusLabel}</p>
          {!exchange && !canceled && refund?.refundedAt && (
            <p className="text-muted-foreground text-xs leading-5">
              {t(
                refund.kind === "prepaid"
                  ? "refund.prepaidProcessedOn"
                  : "refund.processedOn",
                {
                  date: formatDate(refund.refundedAt, DATE_FORMATS.KO_DOT),
                }
              )}
            </p>
          )}
          {!canceled && <PickupTrackingButton />}
        </div>
      ),
    }
  })

  return (
    <article className="md:border-border bg-white px-4 py-6 md:rounded-[10px] md:border md:p-8">
      <h1 className="text-foreground text-lg font-bold md:text-2xl">
        {t("title")}
      </h1>
      <p className="text-muted-foreground mt-2 text-xs md:text-sm">
        {t("orderedOn", {
          date: formatDate(order.created_at, DATE_FORMATS.KO_DOT),
        })}
        <span className="text-border mx-1.5">|</span>
        {t("orderNumber", {
          number: order.display_id ? `#${order.display_id}` : order.id,
        })}
      </p>

      <div className="mt-6 hidden md:block">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-foreground text-muted-foreground border-y">
              <th scope="col" className="py-3 text-left font-medium">
                {t("table.product")}
              </th>
              <th
                scope="col"
                className="w-[160px] px-8 py-3 text-right font-medium"
              >
                {t("table.amount")}
              </th>
              <th
                scope="col"
                className="w-[220px] py-3 pr-4 pl-8 text-left font-medium"
              >
                {t("table.status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {productRows.map((row) => (
              <tr key={row.id} className="border-border border-b">
                <td className="py-4 pr-3">{row.product}</td>
                <td className="px-8 py-4 text-right">{row.amount}</td>
                <td className="py-4 pr-4 pl-8">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-6 space-y-4 md:hidden">
        {productRows.map((row) => (
          <li
            key={row.id}
            className="border-border space-y-4 rounded-lg border p-4 text-sm"
          >
            {row.product}
            <div className="border-border flex items-start justify-between gap-4 border-t pt-3">
              <span className="text-muted-foreground">{t("table.amount")}</span>
              <div className="text-right">{row.amount}</div>
            </div>
            <div className="border-border border-t pt-3">
              <p className="text-muted-foreground mb-2 text-xs">
                {t("table.status")}
              </p>
              {row.status}
            </div>
          </li>
        ))}
      </ul>

      <SectionTitle>{t("info.title")}</SectionTitle>
      <Rows>
        <Row
          label={t(exchange ? "info.exchangeRequestedAt" : "info.requestedAt")}
        >
          {formatDate(ret.requestedAt, DATE_FORMATS.KO_DOT)}
        </Row>
        <Row label={t(exchange ? "info.exchangeNumber" : "info.returnNumber")}>
          {ret.displayId ?? ret.returnId}
        </Row>
        {completedAt && !canceled && (
          <Row label={t(exchange ? "info.exchangedAt" : "info.completedAt")}>
            {formatDate(completedAt, DATE_FORMATS.KO_DOT)}
          </Row>
        )}
      </Rows>

      <SectionTitle>{t("pickup.title")}</SectionTitle>
      <div className="border-foreground grid border-t text-sm md:grid-cols-2">
        <dl className="order-1">
          <Row label={t("pickup.status")}>
            {progress
              ? t(`pickup.state.${pickupLabelKey(progress)}`)
              : t("pickup.unavailable")}
          </Row>
          <Row label={t("pickup.name")}>{receiverName || "-"}</Row>
          <Row label={t("pickup.phone")}>{address?.phone || "-"}</Row>
        </dl>
        <dl className="order-3 mt-4 md:order-2 md:mt-0">
          <div className="bg-muted border-border border-b px-3 py-3 font-bold">
            {t("pickup.waybillTitle")}
          </div>
          <Row label={t("pickup.carrier")}>{progress?.carrierName ?? "-"}</Row>
          <Row label={t("pickup.waybill")}>{progress?.waybillNo ?? "-"}</Row>
        </dl>
        <dl className="order-2 md:order-3 md:col-span-2">
          <Row label={t("pickup.address")}>{addressLine || "-"}</Row>
        </dl>
      </div>

      <SectionTitle>
        {t(exchange ? "reason.exchangeTitle" : "reason.title")}
      </SectionTitle>
      <Rows>
        <Row label={t("reason.reason")}>
          {tReason(reasonKey as Parameters<typeof tReason>[0])}
        </Row>
      </Rows>

      {!exchange && !canceled && (
        <>
          <SectionTitle
            action={
              <CancellationReceiptDialog>
                {refund && receiptAmounts ? (
                  <>
                    <Rows>
                      <Row label={t("receipt.itemTotal")}>
                        {won(receiptAmounts.itemTotal)}
                      </Row>
                      <Row label={t("receipt.discount")}>
                        {receiptAmounts.discount === null
                          ? t("receipt.discountIncluded")
                          : won(0 - receiptAmounts.discount)}
                      </Row>
                      <Row label={t("refund.shippingRefund")}>
                        {refund.kind === "prepaid"
                          ? t("refund.unsettled")
                          : won(refund.shippingRefund)}
                      </Row>
                      <Row label={t("refund.fees")}>
                        {refund.kind === "prepaid"
                          ? t("refund.unsettled")
                          : won(0 - refund.fees)}
                      </Row>
                      <Row
                        label={t(
                          refund.kind === "prepaid"
                            ? refundTotalKey
                            : "receipt.total"
                        )}
                      >
                        <strong className="text-destructive">
                          {won(refund.total)}
                        </strong>
                      </Row>
                      <Row label={t("refund.method")}>
                        <span className="text-muted-foreground mr-2">
                          {paymentMethodLabel}
                        </span>
                        <strong>{won(refund.total)}</strong>
                      </Row>
                    </Rows>
                    {refund.kind === "prepaid" && (
                      <p className="text-muted-foreground text-sm">
                        {t("refund.prepaidRest")}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t("refund.notYet")}
                  </p>
                )}
              </CancellationReceiptDialog>
            }
          >
            {t("refund.title")}
          </SectionTitle>
          {refund ? (
            <>
              <div className="border-foreground grid gap-6 border-t pt-4 md:grid-cols-2">
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">
                      {t("refund.itemTotal")}
                    </dt>
                    <dd>{won(refund.itemTotal)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">
                      {t("refund.shippingRefund")}
                    </dt>
                    <dd>
                      {refund.kind === "prepaid"
                        ? t("refund.unsettled")
                        : won(refund.shippingRefund)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">
                      {t("refund.fees")}
                    </dt>
                    <dd>
                      {refund.kind === "prepaid"
                        ? t("refund.unsettled")
                        : won(0 - refund.fees)}
                    </dd>
                  </div>
                </dl>
                <dl className="bg-muted min-w-0 space-y-4 rounded-lg p-4">
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <dt className="text-muted-foreground">
                      {t("refund.method")}
                    </dt>
                    <dd className="min-w-0 text-right break-words">
                      <span className="text-muted-foreground mr-2">
                        {paymentMethodLabel}
                      </span>
                      <strong className="text-foreground text-base">
                        {won(refund.total)}
                      </strong>
                    </dd>
                  </div>
                  <div className="border-border flex flex-wrap justify-between gap-2 border-t pt-4 font-bold">
                    <dt>{t(refundTotalKey)}</dt>
                    <dd className="text-destructive text-xl">
                      {won(refund.total)}
                    </dd>
                  </div>
                </dl>
              </div>
              {refund.kind === "prepaid" && (
                <p className="text-muted-foreground mt-3 text-sm">
                  {t("refund.prepaidRest")}
                </p>
              )}
            </>
          ) : (
            <p className="border-foreground text-muted-foreground border-t pt-4 text-sm">
              {t("refund.notYet")}
            </p>
          )}
          <div className="text-muted-foreground mt-3 space-y-1 text-right text-xs leading-5">
            <p>{t("refund.notice")}</p>
            <p>{t("refund.pointsNotice")}</p>
          </div>
        </>
      )}

      <div className="mt-8 flex justify-center gap-2">
        <LocalizedClientLink
          href="/mypage/order/list"
          className="w-full max-w-[200px]"
        >
          <CustomButton color="primary" size="lg" fullWidth>
            {t("toList")}
          </CustomButton>
        </LocalizedClientLink>
      </div>
    </article>
  )
}
