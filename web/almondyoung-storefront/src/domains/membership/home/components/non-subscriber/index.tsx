"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react"
import { CustomButton } from "@/components/shared/custom-buttons"
import { Separator } from "@/components/ui/separator"
import { MembershipCancelModal } from "@/domains/membership/components/modal"
import { cancelSubscription } from "@lib/api/membership"
import { refreshCartPrices } from "@/lib/api/medusa/cart"
import type {
  CancellationReasonDto,
  SubscriptionHistoryItemDto,
} from "@lib/types/dto/membership"
import BenefitDetailSection from "./benefit-detail-section"
import BenefitOverviewSection from "./benefit-overview-section"
import MembershipFAQSection from "./membership-faq-section"
import UpcomingBenefitsSection from "./upcoming-benefits-section"

const LEGACY_URL =
  process.env.NEXT_PUBLIC_LEGACY_MEMBERSHIP_HISTORY_URL ??
  "https://almondyoung.com/myshop/mileage/historyList.html"

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "이용 중",
  CANCELLED: "취소됨",
  ENDED: "종료됨",
  EXPIRED: "만료됨",
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "text-green-600 bg-green-50",
  CANCELLED: "text-red-500 bg-red-50",
  ENDED: "text-gray-500 bg-gray-100",
  EXPIRED: "text-gray-500 bg-gray-100",
}

function fmtDate(d?: string | null): string {
  if (!d) return "-"
  const date = new Date(d)
  if (isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function planLabel(durationDays?: number): string {
  if (!durationDays) return ""
  if (durationDays <= 31) return "월간 구독"
  if (durationDays >= 360) return "연간 구독"
  return `${durationDays}일 구독`
}

function pollCartRefreshUntilGroupRemoved(intervalMs = 3_000, maxDurationMs = 30_000): void {
  const startedAt = Date.now()
  const poll = () => {
    setTimeout(async () => {
      const result = await refreshCartPrices().catch(() => null)
      if (!result || result.hasMembershipGroup !== true) return
      if (Date.now() - startedAt < maxDurationMs) poll()
    }, intervalMs)
  }
  poll()
}

interface HistoryCardProps {
  item: SubscriptionHistoryItemDto
  cancellationReasons: CancellationReasonDto[]
  onCancelled: () => void
}

function HistoryCard({ item, cancellationReasons, onCancelled }: HistoryCardProps) {
  const [open, setOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  const startDate = item.startDate ?? item.createdAt
  const endDate = item.cancelledAt ?? item.endDate ?? item.nextBillingDate ?? null
  const canCancel = item.status === "ACTIVE" && item.autoRenewal === true
  const today = new Date()
  const isInTrial = item.status === "ACTIVE" && !!item.billingDate && new Date(item.billingDate) > today
  const nextBillingLabel = isInTrial ? "자동 결제 시작일" : item.autoRenewal === false ? "구독 종료일" : "다음 결제일"
  const nextBillingValue = isInTrial ? item.billingDate : item.autoRenewal === false ? item.endDate : item.nextBillingDate

  const handleCancel = async ({ reasonCode, reasonText }: { reasonCode: string; reasonText?: string }) => {
    try {
      setIsCancelling(true)
      await cancelSubscription(reasonCode, reasonText)
      setModalOpen(false)
      pollCartRefreshUntilGroupRemoved()
      onCancelled()
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
              <span className="text-sm font-semibold text-gray-900">아몬드영 멤버십</span>
              {item.plan && (
                <span className="text-xs text-gray-400">{planLabel(item.plan.durationDays)}</span>
              )}
            </div>
            <span className="text-xs text-gray-500">
              {fmtDate(startDate)}
              {item.status !== "ACTIVE" && endDate ? ` ~ ${fmtDate(endDate)}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[item.status] ?? "text-gray-500 bg-gray-100"}`}
            >
              {STATUS_LABEL[item.status] ?? item.status}
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
              <span className="text-gray-400">구독 금액</span>
              <span className="font-medium text-gray-900">
                {item.plan ? `${item.plan.price.toLocaleString()}원` : "-"}
              </span>

              <span className="text-gray-400">구독 유형</span>
              <span className="font-medium text-gray-900">
                {item.plan ? planLabel(item.plan.durationDays) : "-"}
              </span>

              <span className="text-gray-400">정기결제</span>
              <span className="font-medium text-gray-900">
                {item.autoRenewal === undefined ? "-" : item.autoRenewal ? "정기결제" : "일시결제"}
              </span>

              <span className="text-gray-400">구독 시작일</span>
              <span className="font-medium text-gray-900">{fmtDate(startDate)}</span>

              {item.status === "ACTIVE" ? (
                <>
                  <span className="text-gray-400">{nextBillingLabel}</span>
                  <span className="font-medium text-gray-900">{fmtDate(nextBillingValue)}</span>
                </>
              ) : (
                <>
                  <span className="text-gray-400">종료일</span>
                  <span className="font-medium text-gray-900">{fmtDate(endDate)}</span>
                </>
              )}

              {item.cancelledAt && (
                <>
                  <span className="text-gray-400">해지일</span>
                  <span className="font-medium text-gray-900">{fmtDate(item.cancelledAt)}</span>
                </>
              )}
            </div>

            {/* 정기결제 해지 버튼 */}
            {canCancel && (
              <div className="mt-3 border-t border-gray-200 pt-3">
                <p className="mb-2 text-xs text-gray-500">
                  {isInTrial
                    ? <>무료 체험을 해지하면 즉시 이용이 종료됩니다. (자동 결제 예정일: <strong>{fmtDate(item.billingDate)}</strong>)</>
                    : <>해지 시 <strong>{fmtDate(item.nextBillingDate)}</strong>까지 서비스를 이용하실 수 있으며, 이후 자동 결제가 중단됩니다.</>
                  }
                </p>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setModalOpen(true) }}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                >
                  정기결제 해지하기
                </button>
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

export default function NonSubscriberSection({ subscriptionHistory, hasCafe24Link, cancellationReasons }: Props) {
  const router = useRouter()
  const hasHistory = subscriptionHistory.length > 0
  const hasExtra = hasHistory || hasCafe24Link

  const [showMembershipInfo, setShowMembershipInfo] = useState(!hasExtra)

  const handleBenefitClick = useCallback((benefitId: string) => {
    const element = document.getElementById(benefitId)
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [])

  const handleSubscribe = () => {
    router.push("/kr/mypage/membership/subscribe/payment")
  }

  const handleCancelled = () => {
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 멤버십 이용 기록 */}
      {hasHistory && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-gray-900">멤버십 이용 기록</h2>
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
          <span>기존 아몬드영 멤버십 내역 확인하기</span>
          <ChevronRight className="h-4 w-4 text-gray-400" />
        </a>
      )}

      {/* 아몬드영 멤버십 가입하기 / 혜택 보기 */}
      <div className="mt-2 overflow-hidden rounded-2xl bg-zinc-900">
        {hasExtra && (
          <button
            type="button"
            onClick={() => setShowMembershipInfo((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-4 text-left"
            aria-expanded={showMembershipInfo}
          >
            <span className="text-sm font-semibold text-white">
              아몬드영 멤버십 가입하기 및 혜택 확인하기
            </span>
            <ChevronDown
              className={`h-4 w-4 text-white/70 transition-transform duration-200 ${showMembershipInfo ? "rotate-180" : ""}`}
            />
          </button>
        )}

        {showMembershipInfo && (
          <div className={hasExtra ? "px-4 pb-8" : "px-4 py-8 md:px-6"}>
            <section className="relative flex flex-col items-center overflow-hidden rounded-xl py-12 text-center">
              <Image
                src="/images/membership-hero-bg.webp"
                alt=""
                fill
                className="object-cover object-top"
                priority
              />
              <div className="absolute inset-0 bg-linear-to-b from-transparent via-zinc-900/50 to-zinc-900" />
              <div className="relative z-10 flex flex-col items-center pt-40 pb-10">
                <div className="mb-6">
                  <Image src="/images/logo.webp" alt="아몬드영 로고" width={120} height={80} />
                </div>
                <h1 className="mb-1 text-xl font-bold text-white md:text-2xl">
                  아몬드영 멤버십 서비스
                </h1>
                <h2 className="mb-6 text-2xl font-bold text-white md:text-3xl">GRAND OPEN</h2>
                <CustomButton
                  onClick={handleSubscribe}
                  className="mb-4 h-12 w-full max-w-sm cursor-pointer rounded-lg bg-[#f29219] text-base font-semibold text-white hover:bg-[#d98317]"
                >
                  구독하기
                </CustomButton>
                <div className="space-y-1 text-left text-xs text-white/50">
                  <p><span className="text-red-400">* </span>유료 멤버십 월 4,990원 / 연 49,900원</p>
                  <p><span className="text-red-400">* </span>연간 구독 시 2개월 무료 사용</p>
                </div>
              </div>
            </section>

            <Separator className="bg-white/20" />
            <BenefitOverviewSection onBenefitClick={handleBenefitClick} />
            <Separator className="bg-white/20" />
            <BenefitDetailSection />
            <Separator className="bg-white/20" />
            <UpcomingBenefitsSection />
            <Separator className="bg-white/20" />
            <MembershipFAQSection />
          </div>
        )}
      </div>
    </div>
  )
}
