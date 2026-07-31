"use client"

import { useParams, useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { ChevronRight, ExternalLink } from "lucide-react"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { useTranslations } from "next-intl"
import { MembershipCancelModal } from "../../../components/modal"
import MembershipStatusSection from "domains/membership/components/status-selection"
import MemberDetails from "./member-details"
import { cancelSubscription, undoCancellation } from "@/lib/api/membership"
import { toast } from "sonner"
import { pollCartRefreshUntilGroupRemoved } from "../../poll-cart-refresh"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import type {
  CancellationPreviewDto,
  CancellationReasonDto,
  CycleBenefitDto,
  CycleBenefitHistoryDto,
  SubscriptionDetailsDto,
  SubscriptionHistoryItemDto,
} from "@lib/types/dto/membership"
import type {
  MonthlySavingsDto,
  RangeSavingsDto,
} from "@lib/types/dto/membership-savings"
import MembershipInvoicesSection from "./membership-invoices-section"
import type { PlanWithTier } from "@lib/types/membership"


/**
 * 멤버십 가입자 전용 섹션
 *
 * 가입자에게만 보여지는 UI:
 * - 멤버십 로고 (공통)
 * - 가입자 상세 정보 (다음 결제 예정일, 통계 등)
 * - 월회비 결제수단 변경
 * - 멤버십 혜택 카드
 * - 멤버십 해지하기
 */
interface SubscriberSectionProps {
  membershipData: SubscriptionDetailsDto | null
  plans: PlanWithTier[]
  currentSavings: MonthlySavingsDto | null
  rangeSavings: RangeSavingsDto | null
  subscriptionHistory: SubscriptionHistoryItemDto[]
  cancellationReasons: CancellationReasonDto[]
  /** 해지 선택지·환불 금액 (서버 정책). null 이면 해지 UI 를 숨긴다. */
  cancellationPreview: CancellationPreviewDto | null
  currentBenefit: CycleBenefitDto | null
  benefitHistory: CycleBenefitHistoryDto | null
  hasCafe24Link: boolean
}

/** 설정 리스트 한 행 (Karrot 설정 리스트: 56px 높이, 16px 타이틀) */
const ROW =
  "text-foreground hover:bg-muted flex items-center justify-between px-4 py-4 text-base font-medium transition-colors"

const LEGACY_URL =
  process.env.NEXT_PUBLIC_LEGACY_MEMBERSHIP_HISTORY_URL ??
  "https://lcnine.cafe24.com/myshop/mileage/historyList.html"

export default function SubscriberSection({
  membershipData,
  currentSavings,
  cancellationReasons,
  cancellationPreview,
  currentBenefit,
  hasCafe24Link,
}: SubscriberSectionProps) {
  const [open, setOpen] = useState(false)
  const [isCancelling, startTransition] = useTransition()
  const [isUndoing, startUndoTransition] = useTransition()
  const router = useRouter()
  const params = useParams()
  const countryCode = (params?.countryCode as string) ?? "kr"
  const t = useTranslations("mypage.membership")
  const hasCancellationReasons = useMemo(
    () => cancellationReasons.length > 0,
    [cancellationReasons]
  )
  // 해지 예약 상태는 계약의 recurringCancelledAt 이 SoT. 미리보기가 없으면(활성 계약 없음 등)
  // 해지 UI 자체를 숨긴다 — 누를 수 없는 버튼을 보여주지 않는다.
  const scheduledCancelledAt =
    cancellationPreview?.recurringCancelledAt ??
    membershipData?.recurringCancelledAt ??
    null
  const isCancellationScheduled = !!scheduledCancelledAt
  const periodEndsAt =
    cancellationPreview?.currentPeriodEndsAt ??
    membershipData?.currentPeriodEnd ??
    membershipData?.endDate ??
    null
  const canCancel = !!cancellationPreview && !isCancellationScheduled

  return (
    <>
      {/* 멤버십 관리 헤더 */}
      {/* TODO: CMS 기능이 정상동작하면 결제수단 변경(/mypage/membership/payment-method) 버튼 추가 */}
      <h2 className="text-foreground mb-3 text-lg font-bold">
        {t("manageTitle")}
      </h2>

      {/* 멤버십 회원 전용 섹션 */}
      <MembershipStatusSection>
        <MemberDetails
          membershipData={membershipData}
          currentSavings={currentSavings}
          currentBenefit={currentBenefit}
        />
      </MembershipStatusSection>
      {/* 해지 예약 안내 — 언제 해지했고 언제까지 쓸 수 있는지 + 철회 */}
      {isCancellationScheduled && (
        <div className="border-border mt-3 w-full rounded-xl border bg-amber-50 px-4 py-3">
          <p className="text-sm font-bold text-amber-900">
            {t("billing.cancelScheduledTitle")}
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-900">
            {t("billing.cancelScheduledBody", {
              cancelledAt: formatDate(scheduledCancelledAt, DATE_FORMATS.KO_LONG),
              endsAt: formatDate(periodEndsAt, DATE_FORMATS.KO_LONG),
            })}
          </p>
          {/* 철회는 되살릴 자동결제가 있을 때만. 1회 결제에 열어주면 동의한 적 없는 정기결제가 시작된다. */}
          {/* 1회 결제는 되살릴 자동결제가 없다. 버튼만 사라지면 고객은 이유를 알 수 없다. */}
          {cancellationPreview && !cancellationPreview.canUndoCancellation && (
            <p className="mt-2 text-xs leading-4 text-amber-900">
              {t("billing.cancelUndoUnavailable")}
            </p>
          )}
          {cancellationPreview?.canUndoCancellation && (
            <button
              type="button"
              disabled={isUndoing}
              onClick={() =>
                startUndoTransition(async () => {
                  const result = await undoCancellation()
                  if (!result.ok) {
                    // 서버 안내(만료돼 복구 불가 등)가 곧 다음 행동이다 — 일반 문구로 덮지 않는다.
                    toast.error(result.message || t("billing.cancelUndoFailed"))
                    return
                  }
                  toast.success(t("billing.cancelUndoSuccess"))
                  router.refresh()
                })
              }
              className="mt-2 text-xs font-semibold text-amber-900 underline underline-offset-4 disabled:opacity-60"
            >
              {t("billing.cancelScheduledUndo")}
            </button>
          )}
        </div>
      )}
      {/* 정기결제 청구/미납 내역 (구독 계약이 없으면 자체적으로 숨김) */}
      <MembershipInvoicesSection />
      {/* 하단 액션 그룹 */}
      <div className="mt-6">
        {/* 설정 리스트: 행마다 카드를 두르지 않고 카드 하나를 hairline 으로 나눈다 */}
        <div className="border-border divide-border divide-y overflow-hidden rounded-xl border bg-white">
          {/* 구독 이력(별도 라우트, 페이지네이션) */}
          <LocalizedClientLink
            href="/mypage/membership/history"
            className={ROW}
          >
            <span>{t("history.subscriptionHistory")}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#b0b3ba]" />
          </LocalizedClientLink>
          {/* 멤버십 혜택 안내(별도 라우트) */}
          <LocalizedClientLink
            href="/mypage/membership/benefits"
            className={ROW}
          >
            <span>{t("history.viewBenefitsGuide")}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#b0b3ba]" />
          </LocalizedClientLink>
          {/* 기존 아몬드영 멤버십 내역 (Cafe24 연동 고객 전용) */}
          {hasCafe24Link && (
            <a
              href={LEGACY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={ROW}
            >
              <span>{t("history.legacyHistory")}</span>
              <ExternalLink className="h-4 w-4 shrink-0 text-[#b0b3ba]" />
            </a>
          )}
        </div>
        {/* 해지 */}
        {canCancel && (
          <div className="mt-6 flex flex-col items-start gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4 transition-colors"
            >
              {t("history.cancelMembership")}
            </button>
            <p className="text-muted-foreground text-xs">
              {cancellationPreview?.isRecurring
                ? t("history.cancelWarningRecurring")
                : t("history.cancelWarning")}
            </p>
          </div>
        )}
      </div>
      <MembershipCancelModal
        open={open}
        setOpen={setOpen}
        reasons={hasCancellationReasons ? cancellationReasons : []}
        isSubmitting={isCancelling}
        preview={cancellationPreview}
        onConfirm={({
          reasonCode,
          reasonText,
          refundReceiveAccount,
          cancelType,
        }) => {
          // 인증 필요한 Server Action 호출은 startTransition 안에서 실행해야
          // re-throw한 UNAUTHORIZED가 error.tsx로 전파돼 토큰 복구가 동작한다.
          startTransition(async () => {
            const result = await cancelSubscription(
              reasonCode,
              reasonText,
              refundReceiveAccount,
              cancelType
            )
            if (!result.ok) {
              // 왜 막혔는지(계좌 정보 필요·이미 해지 예약됨 등)를 그대로 보여준다.
              toast.error(result.message || t("history.cancelFailed"))
              return
            }
            setOpen(false)
            // 무엇이 처리됐는지 알린다. 특히 수동 송금 대기(PENDING)는 "환불됐다" 로 읽히면 안 된다.
            if (result.type === "RECURRING_CANCELLATION") {
              toast.success(t("billing.cancelScheduledDone"))
            } else if (result.refundStatus === "COMPLETED") {
              toast.success(
                t("billing.cancelRefundCompleted", {
                  amount: (result.refundAmount ?? 0).toLocaleString("ko-KR"),
                })
              )
            } else if (
              result.refundStatus === "PENDING" ||
              result.refundStatus === "FAILED"
            ) {
              toast.success(
                t("billing.cancelRefundPending", {
                  amount: (result.refundAmount ?? 0).toLocaleString("ko-KR"),
                  days: cancellationPreview?.refundProcessingBusinessDays ?? 3,
                })
              )
            } else {
              toast.success(t("billing.cancelImmediateDone"))
            }
            router.push(`/${countryCode}/mypage/membership`)
            // 자격이 즉시 회수되는 즉시해지에서만 장바구니 가격이 바뀐다 —
            // 해지예약은 그룹이 유지되므로 30초 폴링이 끝까지 헛돈다.
            if (result.type === "IMMEDIATE_CANCELLATION") {
              pollCartRefreshUntilGroupRemoved(() => {
                toast.success(t("billing.cartPriceUpdated"))
                router.refresh()
              })
            } else {
              router.refresh()
            }
          })
        }}
      />
    </>
  )
}
