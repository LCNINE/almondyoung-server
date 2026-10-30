import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import type { CustomerReturn, CustomerReturnProgress } from "@/lib/types/ui/returns"
import { buildAddressLine } from "@/lib/utils/address-line"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { cn } from "@/lib/utils"
import type { HttpTypes } from "@medusajs/types"
import { getTranslations } from "next-intl/server"
import type { ReactNode } from "react"
import { itemReturnStatus, originalLineTotal } from "../list/item-return-status"
import { RETURN_REASON_LABEL_KEYS } from "../return-request/return-reasons"
import { pickupLabelKey, returnSteps, returnedAmount } from "./return-detail-view"

interface ReturnDetailProps {
  order: HttpTypes.StoreOrder
  ret: CustomerReturn
  /** core 진행을 못 읽었으면 null — 회수 칸만 «확인 중»이 된다 */
  progress: CustomerReturnProgress | null
}

function Rows({ children }: { children: ReactNode }) {
  return <dl className="border-t border-foreground text-sm">{children}</dl>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] border-b border-border md:grid-cols-[120px_minmax(0,1fr)]">
      <dt className="bg-muted px-3 py-3 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 px-3 py-3 break-words text-foreground">{children}</dd>
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 mb-3 text-base font-bold text-foreground md:text-lg">{children}</h2>
}

const won = (n: number) => `${n.toLocaleString()}원`

export default async function ReturnDetail({ order, ret, progress }: ReturnDetailProps) {
  const t = await getTranslations("mypage.order.returnDetail")
  const tList = await getTranslations("mypage.order.list")
  const tReason = await getTranslations("mypage.order.returnRequest")
  const exchange = ret.kind === "exchange"
  const canceled = ret.stage === "canceled"

  const itemsById = new Map((order.items ?? []).map((i) => [i.id, i]))
  const status = itemReturnStatus(ret.items[0]?.itemId ?? "", [ret])
  const statusLabel = canceled ? t("canceled") : status ? tList(`itemReturn.${status.key}`) : ""
  const steps = canceled ? [] : returnSteps(ret, progress)

  const address = order.shipping_address
  const receiverName = [address?.first_name, address?.last_name].filter(Boolean).join(" ")
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
  // 완료일은 마지막 정산이 끝난 때다 — 선환불한 때는 완료가 아니다
  const completedAt = exchange
    ? ret.stage === "exchanged"
      ? progress?.settledAt ?? null
      : null
    : ret.stage === "refunded" && ret.refund?.kind === "settled"
      ? ret.refund.refundedAt
      : null

  return (
    <article className="bg-white px-4 py-6 md:rounded-[10px] md:border md:border-border md:p-8">
      <h1 className="text-lg font-bold text-foreground md:text-2xl">{t("title")}</h1>
      <p className="mt-2 text-xs text-muted-foreground md:text-sm">
        {t("orderedOn", { date: formatDate(order.created_at, DATE_FORMATS.KO_DOT) })}
        <span className="mx-1.5 text-border">|</span>
        {t("orderNumber", { number: order.display_id ? `#${order.display_id}` : order.id })}
      </p>

      {steps.length > 0 && (
        <ol className="mt-6 grid grid-cols-4 gap-1 text-center text-[11px] md:text-sm" aria-label={t("stepsLabel")}>
          {steps.map((step) => (
            <li key={step.key} className="flex flex-col items-center gap-1.5">
              <span className={cn("h-1.5 w-full rounded-full", step.done ? "bg-foreground" : "bg-border")} />
              <span className={step.done ? "font-semibold text-foreground" : "text-muted-foreground"}>
                {t(`step.${step.key}`)}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr className="border-y border-foreground text-muted-foreground">
              <th className="py-3 text-left font-medium">{t("table.product")}</th>
              <th className="w-[112px] py-3 text-right font-medium">{t("table.amount")}</th>
              <th className="w-[112px] py-3 text-right font-medium">{t("table.status")}</th>
            </tr>
          </thead>
          <tbody>
            {ret.items.map((r) => {
              const item = itemsById.get(r.itemId)
              const amount = item ? returnedAmount(originalLineTotal(item), item.quantity ?? 0, r.quantity) : null
              return (
                <tr key={r.itemId} className="border-b border-border">
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      {item?.thumbnail ? (
                        <img
                          className="h-16 w-16 shrink-0 rounded-md border border-border object-cover"
                          src={getThumbnailUrl(item.thumbnail)}
                          alt={item.title ?? ""}
                        />
                      ) : null}
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{item?.title ?? t("unknownItem")}</p>
                        <p className="text-xs text-muted-foreground">
                          {[item?.variant_title && item.variant_title !== "Default" ? item.variant_title : null, t("quantity", { count: r.quantity })]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 text-right">{amount === null ? "-" : won(amount)}</td>
                  <td className="py-4 text-right font-bold text-foreground">{statusLabel}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <SectionTitle>{t("info.title")}</SectionTitle>
      <Rows>
        <Row label={t(exchange ? "info.exchangeRequestedAt" : "info.requestedAt")}>
          {formatDate(ret.requestedAt, DATE_FORMATS.KO_DOT)}
        </Row>
        <Row label={t(exchange ? "info.exchangeNumber" : "info.returnNumber")}>
          <span className="font-mono text-[13px]">{ret.returnId}</span>
        </Row>
        {completedAt && !canceled && (
          <Row label={t(exchange ? "info.exchangedAt" : "info.completedAt")}>
            {formatDate(completedAt, DATE_FORMATS.KO_DOT)}
          </Row>
        )}
      </Rows>

      <SectionTitle>{t("pickup.title")}</SectionTitle>
      <Rows>
        <Row label={t("pickup.status")}>
          {progress ? t(`pickup.state.${pickupLabelKey(progress)}`) : t("pickup.unavailable")}
        </Row>
        {progress?.waybillNo && (
          <>
            <Row label={t("pickup.carrier")}>{progress.carrierName ?? "-"}</Row>
            <Row label={t("pickup.waybill")}>
              <span className="font-mono text-[13px]">{progress.waybillNo}</span>
            </Row>
          </>
        )}
        <Row label={t("pickup.name")}>{receiverName || "-"}</Row>
        <Row label={t("pickup.phone")}>{address?.phone || "-"}</Row>
        <Row label={t("pickup.address")}>{addressLine || "-"}</Row>
      </Rows>

      <SectionTitle>{t("reason.title")}</SectionTitle>
      <Rows>
        <Row label={t("reason.reason")}>{tReason(reasonKey as Parameters<typeof tReason>[0])}</Row>
        <Row label={t("reason.feeBearer")}>{t(`reason.bearer.${ret.feeBearer}`)}</Row>
      </Rows>

      {!exchange && !canceled && (
        <>
          <SectionTitle>{t("refund.title")}</SectionTitle>
          {ret.refund?.kind === "prepaid" ? (
            <div className="border-t border-foreground pt-4">
              <dl className="flex flex-col gap-2.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("refund.itemTotal")}</dt>
                  <dd>{won(ret.refund.itemTotal)}</dd>
                </div>
                <div className="flex justify-between font-bold text-foreground">
                  <dt>{t(ret.refund.refundedAt ? "refund.prepaid" : "refund.prepaidPending")}</dt>
                  <dd>{won(ret.refund.total)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-muted-foreground">{t("refund.prepaidRest")}</p>
            </div>
          ) : ret.refund ? (
            <div className="grid gap-4 border-t border-foreground pt-4 md:grid-cols-2">
              <dl className="flex flex-col gap-2.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("refund.itemTotal")}</dt>
                  <dd>{won(ret.refund.itemTotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("refund.shippingRefund")}</dt>
                  <dd>{won(ret.refund.shippingRefund)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("refund.fees")}</dt>
                  <dd>{ret.refund.fees > 0 ? `-${won(ret.refund.fees)}` : won(0)}</dd>
                </div>
              </dl>
              <div className="flex items-center justify-between rounded-lg bg-muted p-4 text-base">
                <span className="font-bold text-foreground">
                  {t(ret.refund.refundedAt ? "refund.done" : "refund.planned")}
                </span>
                <span className="font-bold text-foreground">{won(ret.refund.total)}</span>
              </div>
            </div>
          ) : (
            <p className="border-t border-foreground pt-4 text-sm text-muted-foreground">{t("refund.notYet")}</p>
          )}
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{t("refund.notice")}</p>
        </>
      )}

      <div className="mt-8 flex justify-center gap-2">
        <LocalizedClientLink href={`/mypage/order/details?orderId=${order.id}`} className="w-full max-w-[200px]">
          <CustomButton variant="outline" color="secondary" size="lg" fullWidth>
            {t("toOrder")}
          </CustomButton>
        </LocalizedClientLink>
        <LocalizedClientLink href="/mypage/order/list" className="w-full max-w-[200px]">
          <CustomButton variant="outline" color="secondary" size="lg" fullWidth>
            {t("toList")}
          </CustomButton>
        </LocalizedClientLink>
      </div>
    </article>
  )
}
