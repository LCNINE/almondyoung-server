"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { ChevronDown, ChevronRight } from "lucide-react"
import { CustomButton } from "@/components/shared/custom-buttons"
import { Separator } from "@/components/ui/separator"
import type { SubscriptionHistoryItemDto } from "@lib/types/dto/membership"
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
  ACTIVE: "text-green-600",
  CANCELLED: "text-red-400",
  ENDED: "text-gray-400",
  EXPIRED: "text-gray-400",
}

function formatPeriod(start?: string | null, end?: string | null): string {
  const fmt = (d: string) => {
    const date = new Date(d)
    if (isNaN(date.getTime())) return d
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}`
  }
  if (!start) return "-"
  return end ? `${fmt(start)} ~ ${fmt(end)}` : `${fmt(start)} ~`
}

interface Props {
  subscriptionHistory: SubscriptionHistoryItemDto[]
  hasCafe24Link: boolean
}

export default function NonSubscriberSection({ subscriptionHistory, hasCafe24Link }: Props) {
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

  return (
    <div className="flex flex-col gap-3">
      {/* 멤버십 이용 기록 */}
      {hasHistory && (
        <section className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <h2 className="mb-3 text-sm font-bold text-gray-900">멤버십 이용 기록</h2>
          <div className="flex flex-col divide-y divide-gray-100">
            {subscriptionHistory.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between py-2.5 text-sm"
              >
                <span className="text-gray-700">
                  {formatPeriod(item.startDate, item.endDate)}
                </span>
                <span
                  className={`text-xs font-medium ${STATUS_COLOR[item.status] ?? "text-gray-400"}`}
                >
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
              </div>
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

      {/* 아몬드영 멤버십 정보 / 가입 섹션 */}
      <div className="mt-2 overflow-hidden rounded-2xl bg-zinc-900">
        {/* 토글 헤더 — 이력이 있을 때만 노출 */}
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

        {/* 멤버십 소개 + 가입 콘텐츠 */}
        {showMembershipInfo && (
          <div className={hasExtra ? "px-4 pb-8" : "px-4 py-8 md:px-6"}>
            {/* 히어로 섹션 */}
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
                  <Image
                    src="/images/logo.webp"
                    alt="아몬드영 로고"
                    width={120}
                    height={80}
                  />
                </div>
                <h1 className="mb-1 text-xl font-bold text-white md:text-2xl">
                  아몬드영 멤버십 서비스
                </h1>
                <h2 className="mb-6 text-2xl font-bold text-white md:text-3xl">
                  GRAND OPEN
                </h2>
                <CustomButton
                  onClick={handleSubscribe}
                  className="mb-4 h-12 w-full max-w-sm cursor-pointer rounded-lg bg-[#f29219] text-base font-semibold text-white hover:bg-[#d98317]"
                >
                  구독하기
                </CustomButton>
                <div className="space-y-1 text-left text-xs text-white/50">
                  <p>
                    <span className="text-red-400">* </span>유료 멤버십 월 4,990원 / 연 49,900원
                  </p>
                  <p>
                    <span className="text-red-400">* </span>연간 구독 시 2개월 무료 사용
                  </p>
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
