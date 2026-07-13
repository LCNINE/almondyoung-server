"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { useTranslations } from "next-intl"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type {
  SubscriptionAdjustmentDto,
  SubscriptionHistoryItemDto,
} from "@lib/types/dto/membership"

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-[#e7f7f0] text-[#079171]",
  PAUSED: "bg-[#fff4e5] text-[#9b7821]",
  RECURRING_CANCELLED: "bg-secondary text-muted-foreground",
  CANCELLED: "bg-[#fdecea] text-destructive",
  ENDED: "bg-secondary text-muted-foreground",
  EXPIRED: "bg-secondary text-muted-foreground",
}

function AdjustmentRow({ adj }: { adj: SubscriptionAdjustmentDto }) {
  const t = useTranslations("mypage.membership")
  const label = (() => {
    switch (adj.eventType) {
      case "GRANTED_BY_ADMIN":
        return {
          text: t("history.adjGrantedByAdmin", { days: adj.days }),
          cls: "text-primary",
        }
      case "ENTITLEMENT_EXTENDED":
        return {
          text: t("history.adjExtended", { days: adj.days }),
          cls: "text-[#217cf9]",
        }
      default:
        return {
          text: t("history.adjReduced", { days: Math.abs(adj.days) }),
          cls: "text-destructive",
        }
    }
  })()

  return (
    <div className="bg-muted flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs">
      <span className="text-muted-foreground">
        {formatDate(adj.createdAt, DATE_FORMATS.KO_DOT)}
      </span>
      <span className={`font-semibold ${label.cls}`}>{label.text}</span>
      <span className="text-muted-foreground">
        {t("billing.expirePast", {
          date: formatDate(adj.newEndsAt, DATE_FORMATS.KO_DOT),
        })}
      </span>
    </div>
  )
}

export default function HistoryCard({
  item,
}: {
  item: SubscriptionHistoryItemDto
}) {
  const t = useTranslations("mypage.membership")
  const [open, setOpen] = useState(false)

  const startDate = item.startDate ?? item.createdAt
  const cancelledEndDate = item.cancelledAt ?? item.endDate ?? null
  const today = new Date()
  const isInTrial =
    !!item.billingDate &&
    item.status === "ACTIVE" &&
    new Date(item.billingDate) > today
  const displayNextBillingDate = isInTrial
    ? item.billingDate
    : item.nextBillingDate

  const fmt = (d?: string | null) => formatDate(d, DATE_FORMATS.KO_DOT)
  const planLabel = (d?: number) =>
    !d
      ? ""
      : d <= 31
        ? t("subscription.monthly")
        : d >= 360
          ? t("subscription.annual")
          : t("subscription.daysSubscription", { days: d })
  const statusLabel = (s: string) => {
    try {
      return t(`status.${s}` as "status.ACTIVE")
    } catch {
      return s
    }
  }

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  )

  return (
    <div className="border-border overflow-hidden rounded-xl border bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-4 text-left"
      >
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground text-sm font-bold">
              {t("membershipName")}
            </span>
            {item.plan && (
              <span className="text-muted-foreground text-xs">
                {planLabel(item.plan.durationDays)}
              </span>
            )}
          </div>
          <span className="text-muted-foreground text-xs">
            {fmt(startDate)}
            {item.status === "ACTIVE" && item.endDate
              ? t("billing.expireSuffix", { date: fmt(item.endDate) })
              : cancelledEndDate
                ? ` ~ ${fmt(cancelledEndDate)}`
                : ""}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            STATUS_STYLE[item.status] ?? "bg-secondary text-muted-foreground"
          }`}
        >
          {statusLabel(item.status)}
        </span>
        {open ? (
          <ChevronUp className="text-muted-foreground h-4 w-4 shrink-0" />
        ) : (
          <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
        )}
      </button>

      {open && (
        <div className="border-border border-t px-4 py-3">
          <div className="divide-border divide-y">
            <Row
              label={t("billing.subscriptionAmount")}
              value={
                item.plan
                  ? t("billing.amountWon", {
                      amount: item.plan.price.toLocaleString(),
                    })
                  : "-"
              }
            />
            <Row
              label={t("billing.subscriptionType")}
              value={item.plan ? planLabel(item.plan.durationDays) : "-"}
            />
            <Row
              label={t("billing.recurring")}
              value={
                item.autoRenewal === undefined
                  ? "-"
                  : item.autoRenewal
                    ? t("billing.recurring")
                    : t("billing.oneTime")
              }
            />
            <Row
              label={t("billing.subscriptionStartDate")}
              value={fmt(startDate)}
            />
            {item.status === "ACTIVE" ? (
              <>
                <Row
                  label={t("billing.expectedEndDate")}
                  value={fmt(item.endDate)}
                />
                <Row
                  label={
                    isInTrial
                      ? t("billing.autoStartDate")
                      : t("billing.nextBillingDate")
                  }
                  value={fmt(displayNextBillingDate)}
                />
              </>
            ) : (
              <Row
                label={t("billing.endDateLabel")}
                value={fmt(cancelledEndDate)}
              />
            )}
            {item.cancelledAt && (
              <Row
                label={t("billing.cancelledDate")}
                value={fmt(item.cancelledAt)}
              />
            )}
          </div>

          {item.adjustments && item.adjustments.length > 0 && (
            <div className="border-border mt-3 border-t pt-3">
              <p className="text-foreground mb-2 text-xs font-semibold">
                {t("history.adjustmentsTitle")}
              </p>
              <div className="flex flex-col gap-1.5">
                {item.adjustments.map((adj) => (
                  <AdjustmentRow key={adj.id} adj={adj} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
