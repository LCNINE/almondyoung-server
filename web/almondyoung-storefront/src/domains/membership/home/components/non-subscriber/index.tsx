"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react"
import { useTranslations } from "next-intl"
import { MembershipCancelModal } from "@/domains/membership/components/modal"
import MembershipBenefitsGuide from "./membership-benefits-guide"
import { cancelSubscription } from "@lib/api/membership"
import { toast } from "sonner"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { pollCartRefreshUntilGroupRemoved } from "../../poll-cart-refresh"
import type {
  CancellationReasonDto,
  SubscriptionHistoryItemDto,
} from "@lib/types/dto/membership"
import { Button } from "@/components/ui/button"

const LEGACY_URL =
  process.env.NEXT_PUBLIC_LEGACY_MEMBERSHIP_HISTORY_URL ??
  "https://almondyoung.com/myshop/mileage/historyList.html"

//  멤버십 해지 버튼 임시 숨김 (2026-07-16). 되돌리려면 true.
// subscriber/subscriber-section.tsx 에도 같은 플래그가 있으니 같이 되돌릴 것.
const SHOW_MEMBERSHIP_CANCEL: boolean = false

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "underline underline-offset-2 text-gray-900 font-medium",
  CANCELLED: "text-gray-400",
  ENDED: "text-gray-400",
  EXPIRED: "text-gray-400",
}

interface HistoryCardProps {
  item: SubscriptionHistoryItemDto
  cancellationReasons: CancellationReasonDto[]
  onCancelled: () => void
}

function HistoryCard({
  item,
  cancellationReasons,
  onCancelled,
}: HistoryCardProps) {
  const router = useRouter()
  const t = useTranslations("mypage.membership")
  const [open, setOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  const planLabel = (durationDays?: number): string => {
    if (!durationDays) return ""
    if (durationDays <= 31) return t("subscription.monthly")
    if (durationDays >= 360) return t("subscription.annual")
    return t("subscription.daysSubscription", { days: durationDays })
  }

  const statusLabel = (status: string): string => {
    const key = `status.${status}` as const
    try {
      return t(key)
    } catch {
      return status
    }
  }

  const fmt = (d?: string | null) => formatDate(d, DATE_FORMATS.KO_LONG)

  const startDate = item.startDate ?? item.createdAt
  const endDate =
    item.cancelledAt ?? item.endDate ?? item.nextBillingDate ?? null
  const canCancel = item.status === "ACTIVE" && item.autoRenewal === true
  const today = new Date()
  const isInTrial =
    item.status === "ACTIVE" &&
    !!item.billingDate &&
    new Date(item.billingDate) > today
  const nextBillingLabel = isInTrial
    ? t("billing.autoStartDate")
    : item.autoRenewal === false
      ? t("billing.endDate")
      : t("billing.nextBillingDate")
  const nextBillingValue = isInTrial
    ? item.billingDate
    : item.autoRenewal === false
      ? item.endDate
      : item.nextBillingDate

  const handleCancel = async ({
    reasonCode,
    reasonText,
  }: {
    reasonCode: string
    reasonText?: string
  }) => {
    try {
      setIsCancelling(true)
      await cancelSubscription(reasonCode, reasonText)
      setModalOpen(false)
      onCancelled()
      pollCartRefreshUntilGroupRemoved(() => {
        toast.success(t("billing.cartPriceUpdated"))
        router.refresh()
      })
    } catch {
      // 에러는 서버에서 처리
    } finally {
      setIsCancelling(false)
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
        {/* 요약 행 */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
        >
          <div className="flex flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">
                {t("membershipName")}
              </span>
              {item.plan && (
                <span className="text-xs text-gray-400">
                  {planLabel(item.plan.durationDays)}
                </span>
              )}
            </div>
            <span className="text-xs text-gray-500">
              {fmt(startDate)}
              {item.status !== "ACTIVE" && endDate ? ` ~ ${fmt(endDate)}` : ""}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`text-xs ${STATUS_COLOR[item.status] ?? "text-gray-500"}`}
            >
              {statusLabel(item.status)}
            </span>
            {open ? (
              <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
            )}
          </div>
        </button>

        {/* 상세 내역 */}
        {open && (
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
            <div className="grid grid-cols-2 gap-y-2 text-xs text-gray-700">
              <span className="text-gray-400">
                {t("billing.subscriptionAmount")}
              </span>
              <span className="font-medium text-gray-900">
                {item.plan
                  ? t("billing.amountWon", {
                      amount: item.plan.price.toLocaleString(),
                    })
                  : "-"}
              </span>

              <span className="text-gray-400">
                {t("billing.subscriptionType")}
              </span>
              <span className="font-medium text-gray-900">
                {item.plan ? planLabel(item.plan.durationDays) : "-"}
              </span>

              <span className="text-gray-400">{t("billing.recurring")}</span>
              <span className="font-medium text-gray-900">
                {item.autoRenewal === undefined
                  ? "-"
                  : item.autoRenewal
                    ? t("billing.recurring")
                    : t("billing.oneTime")}
              </span>

              <span className="text-gray-400">
                {t("billing.subscriptionStartDate")}
              </span>
              <span className="font-medium text-gray-900">
                {fmt(startDate)}
              </span>

              {item.status === "ACTIVE" ? (
                <>
                  <span className="text-gray-400">{nextBillingLabel}</span>
                  <span className="font-medium text-gray-900">
                    {fmt(nextBillingValue)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-gray-400">
                    {t("billing.endDateLabel")}
                  </span>
                  <span className="font-medium text-gray-900">
                    {fmt(endDate)}
                  </span>
                </>
              )}

              {item.cancelledAt && (
                <>
                  <span className="text-gray-400">
                    {t("billing.cancelledDate")}
                  </span>
                  <span className="font-medium text-gray-900">
                    {fmt(item.cancelledAt)}
                  </span>
                </>
              )}
            </div>

            {/* 정기결제 해지 버튼 */}
            {SHOW_MEMBERSHIP_CANCEL && canCancel && (
              <div className="mt-3 border-t border-gray-200 pt-3">
                <p className="mb-2 text-xs text-gray-500">
                  {isInTrial
                    ? t("billing.trialEndImmediately", {
                        date: fmt(item.billingDate),
                      })
                    : t("billing.cancelNotice", {
                        date: fmt(item.nextBillingDate),
                      })}
                </p>
                <Button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setModalOpen(true)
                  }}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                >
                  {t("billing.cancelRecurring")}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <MembershipCancelModal
        open={modalOpen}
        setOpen={setModalOpen}
        reasons={cancellationReasons}
        isSubmitting={isCancelling}
        refundEligible={false}
        onConfirm={handleCancel}
      />
    </>
  )
}

interface Props {
  subscriptionHistory: SubscriptionHistoryItemDto[]
  hasCafe24Link: boolean
  cancellationReasons: CancellationReasonDto[]
}

export default function NonSubscriberSection({
  subscriptionHistory,
  hasCafe24Link,
  cancellationReasons,
}: Props) {
  const router = useRouter()
  const t = useTranslations("mypage.membership")
  const hasHistory = subscriptionHistory.length > 0

  const handleCancelled = () => {
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 멤버십 이용 기록 */}
      {hasHistory && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-gray-900">
            {t("history.title")}
          </h2>
          <div className="flex flex-col gap-2">
            {subscriptionHistory.map((item) => (
              <HistoryCard
                key={item.id}
                item={item}
                cancellationReasons={cancellationReasons}
                onCancelled={handleCancelled}
              />
            ))}
          </div>
        </section>
      )}

      {/* 기존 아몬드영 멤버십 내역 (Cafe24 연동 고객 전용) */}
      {hasCafe24Link && (
        <a
          href={LEGACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <span>{t("history.legacyHistory")}</span>
          <ChevronRight className="h-4 w-4 text-gray-400" />
        </a>
      )}

      {/* 멤버십 가입 유도 + 혜택 안내 */}
      <MembershipBenefitsGuide showSubscribeCta />
    </div>
  )
}
