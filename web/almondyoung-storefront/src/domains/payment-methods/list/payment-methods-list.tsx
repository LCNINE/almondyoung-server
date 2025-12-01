"use client"

import { useState, useEffect } from "react"
import { ChevronRight } from "lucide-react"
import { PageTitle } from "@components/common/page-title"
import { useRouter } from "next/navigation"
import { PaymentMethodAddDrawer } from "../add/payment-method-add-drawer"
import { MembershipCardAddDrawer } from "../add/membership-card-add-drawer"
import { BnplHistoryDrawer } from "../bnpl/bnpl-history-drawer"
import { getBnplSummary, type BnplSummary } from "@lib/api/wallet"

// 🎯 Card 컴포넌트 개선 (재사용성을 위해 유지)
function Card({
  children,
  padding = "p-6",
}: {
  children: React.ReactNode
  padding?: string
}) {
  return (
    <article className="rounded-2xl bg-white shadow-md">
      <div className={padding}>{children}</div>
    </article>
  )
}

const ACCOUNT_MENU_ITEMS = [
  { label: "계좌 사용 내역", href: "#" },
  { label: "결제 비밀번호 / 보안 설정", action: "pin-settings" },
  { label: "현금영수증 설정", href: "#" },
  { label: "나중결제 약관 및 정책", href: "#" },
]

// 🎯 일반 카드 항목 컴포넌트 (재사용)
function ArticleCard({
  title,
  children,
  isLink = false,
}: {
  title: string
  children: React.ReactNode
  isLink?: boolean
}) {
  const CardContent = (
    <>
      <h2 className="text-base font-bold md:text-lg">{title}</h2>
      {children}
    </>
  )

  const className =
    "flex items-center justify-between rounded-[10px] bg-white px-7 py-6 shadow-[0_2px_10px_rgba(0,0,0,0.05)] border border-gray-300"

  if (isLink) {
    return (
      <a href="#" className={className + " transition hover:bg-gray-50"}>
        {CardContent}
      </a>
    )
  }

  return <article className={className}>{CardContent}</article>
}

// ----------------------------------------------------------------------
// ⭐️ 1. 나중결제 계좌 (가입자용) - 적립금 로직 분리됨
// ----------------------------------------------------------------------
const BnplActiveSummary = ({
  summary,
  onHistoryClick,
}: {
  summary: BnplSummary
  onHistoryClick: () => void
}) => {
  const router = useRouter()

  // 날짜 포맷팅
  const billingDate = summary.nextBillingDate
    ? new Date(summary.nextBillingDate)
    : null
  const billingMonth = billingDate ? billingDate.getMonth() + 1 : 0
  const billingDay = billingDate ? billingDate.getDate() : 0

  const historyMonth = summary.targetMonth || new Date().getMonth() + 1

  return (
    <article className="relative rounded-[10px] border border-gray-300 bg-white p-5 shadow-[0_2px_10px_0_rgba(0,0,0,0.05)]">
      <div className="flex flex-col gap-4">
        {/* 헤더 영역 */}
        <header className="flex items-center gap-2.5">
          <button
            className="hidden items-center gap-1.5 md:flex"
            aria-label="이전 달 내역"
          >
            <ChevronRight className="h-6 w-6 rotate-180 text-black" />
          </button>
          <h2 className="text-[13px] font-bold text-black md:text-lg">
            나중결제 {historyMonth}월 내역
          </h2>
          <button
            className="hidden items-center gap-1.5 md:flex"
            aria-label="다음 달 내역"
          >
            <ChevronRight className="h-6 w-6 text-black" />
          </button>
        </header>

        {/* 컨텐츠 영역 */}
        <div className="flex flex-col gap-4 pt-2 md:flex-row md:items-end md:justify-between md:gap-0 md:px-2.5">
          <div className="flex flex-col gap-1 md:flex-row md:items-end md:gap-[52px]">
            {/* 금액 정보 */}
            <div className="flex items-end gap-1 md:gap-[9px]">
              <p className="text-base font-bold text-black md:text-2xl">
                {summary.usedAmount?.toLocaleString() ?? 0}
              </p>
              <p className="text-xs text-black md:text-base">원</p>
            </div>

            {/* 상세 정보 그룹 */}
            <div className="flex flex-wrap items-center gap-[5px]">
              {billingDate && (
                <p className="absolute top-5 right-5 text-xs text-black md:static md:text-base md:whitespace-nowrap">
                  {billingMonth}월 {billingDay}일 결제
                </p>
              )}
              {summary.dDay !== null && (
                <span className="hidden h-[18px] items-center justify-center rounded-full bg-[#ffe8b3] px-2 text-xs font-semibold text-[#1c1c1e] md:flex">
                  D-{summary.dDay}
                </span>
              )}
              <p className="text-xs text-black md:text-base">
                <span className="hidden md:inline"> / </span>
                우리 은행
              </p>
            </div>
          </div>

          {/* 버튼 그룹 */}
          <div className="flex justify-start gap-1 pt-2 md:gap-[13px] md:pt-0">
            <button
              type="button"
              className="flex h-[27px] items-center justify-center rounded-[3px] border border-[#f29219] bg-white px-2.5 text-xs text-[#f29219] transition hover:bg-amber-50 md:h-[38px] md:rounded-[5px] md:px-4"
              onClick={onHistoryClick}
            >
              내역 보기
            </button>

            <button
              type="button"
              className="flex h-[27px] items-center justify-center rounded-[3px] border border-[#aeaeb2] bg-white px-2.5 text-xs text-[#1e1e1e] transition hover:bg-gray-50 md:h-[38px] md:rounded-[5px] md:border-gray-400 md:px-4 md:text-black"
              onClick={() => router.push("#")}
            >
              출금 계좌 변경
            </button>

            <button
              type="button"
              className="flex h-[27px] items-center justify-center rounded-[3px] border border-[#aeaeb2] bg-white px-2.5 text-xs text-[#1e1e1e] transition hover:bg-gray-50 md:hidden"
              onClick={() => router.push("#")}
            >
              즉시 결제
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

// ----------------------------------------------------------------------
// ⭐️ 2. 나중결제 등록 카드 (미가입자용) - 적립금 로직 분리됨
// ----------------------------------------------------------------------
const BnplRegisterCard = ({ onAddClick }: { onAddClick: () => void }) => {
  return (
    <article className="rounded-[10px] bg-white p-5 shadow-sm md:py-3 md:pl-7">
      <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center md:justify-between md:gap-0">
        <p className="text-center text-base font-normal text-black md:text-left">
          아직 등록한 계좌가 없습니다
        </p>
        <button
          type="button"
          onClick={onAddClick}
          className="inline-flex w-full items-center justify-center gap-2.5 rounded-[5px] bg-amber-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-600 md:w-48"
        >
          + 나중결제수단 등록
        </button>
      </div>
    </article>
  )
}

// ----------------------------------------------------------------------
// ⭐️ 3. 멤버십 카드 등록 컴포넌트 (위치 이동을 위해 분리)
// ----------------------------------------------------------------------
const MembershipRegisterCard = ({ onAddClick }: { onAddClick: () => void }) => {
  return (
    // section, h2 제거하고 article만 유지
    <article className="rounded-[10px] bg-white p-5 shadow-sm md:py-3 md:pl-7">
      <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center md:justify-between md:gap-0">
        <p className="text-center text-base font-normal text-black md:text-left">
          멤버십 회비 결제를 위한 HMS 카드를 등록하세요
        </p>
        <button
          type="button"
          onClick={onAddClick}
          className="inline-flex w-full items-center justify-center gap-2.5 rounded-[5px] bg-amber-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-600 md:w-48"
        >
          + 멤버십 카드 등록
        </button>
      </div>
    </article>
  )
}

// ----------------------------------------------------------------------
// ⭐️ 4. 자산/적립금 정보 리스트 (도메인 분리)
// ----------------------------------------------------------------------
const AssetInfoList = ({ hasAccount }: { hasAccount: boolean }) => {
  return (
    <>
      {/* 적립금 카드 */}
      <ArticleCard title="아몬드영 적립금">
        <p className="flex items-end gap-2.5 text-black">
          <span className="text-xs font-bold md:text-2xl">
            {hasAccount ? "4,200" : "0"}
          </span>
          <span className="text-xs font-normal md:text-base">원</span>
        </p>
      </ArticleCard>

      {/* 계좌 카드 */}
      <ArticleCard title="계좌" isLink>
        <p className="flex items-center gap-1 text-black">
          <span className="text-xs font-bold md:text-base">
            {hasAccount ? "우리은행 계좌" : "등록한 계좌가 없어요"}{" "}
          </span>
          <ChevronRight className="h-5 w-5 text-gray-400" />
        </p>
      </ArticleCard>

      {/* 적립 예정 적립금 카드 */}
      <ArticleCard title="적립예정 아몬드영 적립금" isLink>
        <p className="flex items-center gap-1 text-black">
          <span className="text-xs font-normal md:text-base">
            {hasAccount ? "200" : "0"} 원
          </span>
          <ChevronRight className="h-5 w-5 text-gray-400" />
        </p>
      </ArticleCard>
    </>
  )
}

// 🎯 페이지 본문
export default function PaymentManagement() {
  const router = useRouter()
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false)
  const [isMembershipCardDrawerOpen, setIsMembershipCardDrawerOpen] =
    useState(false)
  const [isBnplDrawerOpen, setIsBnplDrawerOpen] = useState(false)
  const [isPinSettingsDrawerOpen, setIsPinSettingsDrawerOpen] = useState(false)
  const [bnplSummary, setBnplSummary] = useState<BnplSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const data = await getBnplSummary()
        setBnplSummary(data)
      } catch (error) {
        console.error("Failed to fetch BNPL summary:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchSummary()
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        Loading...
      </div>
    )
  }

  // 계좌 보유 여부 (안전한 접근)
  // bnplSummary가 존재하고 hasAccount가 true일 때만 계좌가 있다고 판단
  const hasAccount = bnplSummary?.hasAccount === true

  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <PageTitle>결제수단 관리</PageTitle>

      {/* ⭐️ 메인 섹션: 나중결제 + 멤버십 + 적립금 정보를 하나의 흐름으로 배치 */}
      {/* 모바일/PC 패딩 및 배경색 일괄 적용 */}
      <section className="space-y-4 rounded-lg bg-[#f8f8f8] p-4 md:p-6">
        {/* 1. 나중결제 관련 카드 (가입 여부에 따라 분기) */}
        {hasAccount && bnplSummary ? (
          <BnplActiveSummary
            summary={bnplSummary}
            onHistoryClick={() => setIsBnplDrawerOpen(true)}
          />
        ) : (
          <BnplRegisterCard onAddClick={() => setIsAddDrawerOpen(true)} />
        )}

        {/* 2. ⭐️ 멤버십 카드 등록 (요청사항: 적립금 카드 바로 위로 이동) */}
        <MembershipRegisterCard
          onAddClick={() => setIsMembershipCardDrawerOpen(true)}
        />

        {/* 3. ⭐️ 적립금/계좌 자산 정보 (별도 도메인으로 분리됨) */}
        <AssetInfoList hasAccount={hasAccount} />
      </section>

      {/* 메뉴 네비게이션 */}
      <nav
        aria-label="계좌 관련 메뉴"
        className="mt-10 rounded-lg bg-white shadow-sm md:mx-4"
      >
        <ul className="divide-y divide-gray-200">
          {ACCOUNT_MENU_ITEMS.map((item) => (
            <li key={item.label}>
              {item.action === "pin-settings" ? (
                <button
                  onClick={() => setIsPinSettingsDrawerOpen(true)}
                  className="flex w-full items-center justify-between px-7 py-3.5 transition-colors hover:bg-gray-50"
                >
                  <span className="text-base font-normal text-black md:text-lg">
                    {item.label}
                  </span>
                  <ChevronRight
                    className="h-5 w-5 text-gray-400"
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <a
                  href={item.href}
                  className="flex items-center justify-between px-7 py-3.5 transition-colors hover:bg-gray-50"
                >
                  <span className="text-base font-normal text-black md:text-lg">
                    {item.label}
                  </span>
                  <ChevronRight
                    className="h-5 w-5 text-gray-400"
                    aria-hidden="true"
                  />
                </a>
              )}
            </li>
          ))}
        </ul>
      </nav>

      <PaymentMethodAddDrawer
        open={isAddDrawerOpen}
        onOpenChange={setIsAddDrawerOpen}
      />
      <MembershipCardAddDrawer
        open={isMembershipCardDrawerOpen}
        onOpenChange={setIsMembershipCardDrawerOpen}
      />
      <BnplHistoryDrawer
        open={isBnplDrawerOpen}
        onOpenChange={setIsBnplDrawerOpen}
      />
    </div>
  )
}
