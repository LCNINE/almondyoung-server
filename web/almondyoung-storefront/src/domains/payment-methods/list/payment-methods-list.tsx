"use client"

import { useState, useEffect } from "react"
import { ChevronRight, Plus } from "lucide-react"
import { PageTitle } from "@components/common/page-title"
import { useRouter } from "next/navigation"
import { refundGetPaymentProfiles, PaymentProfile } from "../api"
import { PaymentCardUI, PaymentCardListItem } from "./payment-card-ui"
import { toast } from "sonner"

// 🎯 Card 컴포넌트 개선 (재사용성을 위해 유지)
function Card({
  children,
  padding = "p-6",
}: {
  children: React.ReactNode
  padding?: string
}) {
  // 견고한 CSS: 명시적인 shadow 클래스 사용
  return (
    <article className="rounded-2xl bg-white shadow-md">
      {/* inner 역할: 내부 여백 전담 */}
      <div className={padding}>{children}</div>
    </article>
  )
}
const ACCOUNT_MENU_ITEMS = [
  { label: "계좌 사용 내역", href: "#" },
  { label: "결제 비밀번호 / 보안 설정", href: "#" },
  { label: "현금영수증 설정", href: "#" },
  { label: "나중결제 약관 및 정책", href: "#" },
]

// ⭐️ 나중결제 가입자 전용 컴포넌트 (견고한 CSS, 시맨틱 태그)
const LatePaymentSummary = () => {
  const router = useRouter()
  return (
    // 2. 나중결제 사용자의 요약 정보 섹션
    <section
      aria-labelledby="late-payment-summary"
      className="space-y-4 bg-[#f8f8f8] md:px-3 md:py-5"
    >
      {/* 2-1. 나중결제 메인 카드 - article로 묶음 */}
      <article className="relative rounded-[10px] border border-gray-300 bg-white p-5 shadow-[0_2px_10px_0_rgba(0,0,0,0.05)]">
        <div className="flex flex-col gap-4">
          {/* 1. 헤더 영역 */}
          <header className="flex items-center gap-2.5">
            {/* 화살표: 모바일 디자인에 없으므로 숨김 처리 (불가피한 hidden) */}
            <button
              className="hidden items-center gap-1.5 md:flex"
              aria-label="이전 달 내역"
            >
              <ChevronRight className="h-6 w-6 rotate-180 text-black" />
            </button>

            {/* 제목: 크기만 변경 (모바일 13px -> PC 18px) */}
            <h2 className="text-[13px] font-bold text-black md:text-lg">
              나중결제 5월 내역
            </h2>

            {/* 화살표 */}
            <button
              className="hidden items-center gap-1.5 md:flex"
              aria-label="다음 달 내역"
            >
              <ChevronRight className="h-6 w-6 text-black" />
            </button>
          </header>

          {/* 2. 컨텐츠 영역 */}
          {/* PC에서는 가로 정렬, 모바일에서는 세로 정렬 */}
          <div className="flex flex-col gap-4 pt-2 md:flex-row md:items-end md:justify-between md:gap-0 md:px-2.5">
            {/* 좌측 그룹 (금액 + 정보) */}
            <div className="flex flex-col gap-1 md:flex-row md:items-end md:gap-[52px]">
              {/* 금액 정보 */}
              <div className="flex items-end gap-1 md:gap-[9px]">
                <p className="text-base font-bold text-black md:text-2xl">
                  156,000
                </p>
                <p className="text-xs text-black md:text-base">원</p>
              </div>

              {/* 상세 정보 그룹 */}
              <div className="flex flex-wrap items-center gap-[5px]">
                {/* ⭐️ 핵심 변경: 날짜 요소 하나로 통합 */}
                {/* 모바일: absolute로 우측 상단(헤더 위치)으로 이동 */}
                {/* PC: static(기본)으로 돌아와서 이곳에 위치 */}
                <p className="absolute top-5 right-5 text-xs text-black md:static md:text-base md:whitespace-nowrap">
                  6월 7일 결제
                </p>

                {/* 뱃지 vs SVG 점 (형태가 달라 교체 필요) */}
                <span className="hidden h-[18px] items-center justify-center rounded-full bg-[#ffe8b3] px-2 text-xs font-semibold text-[#1c1c1e] md:flex">
                  D-3
                </span>

                {/* 은행명 */}
                <p className="text-xs text-black md:text-base">
                  <span className="hidden md:inline"> / </span>
                  우리 은행
                </p>
              </div>
            </div>

            {/* 3. 버튼 그룹 */}
            {/* 모바일: 버튼 3개, 27px / PC: 버튼 2개, 38px */}
            <div className="flex justify-start gap-1 pt-2 md:gap-[13px] md:pt-0">
              <button
                type="button"
                // 공통 스타일 + 반응형 크기/보더/폰트 적용
                className="flex h-[27px] items-center justify-center rounded-[3px] border border-[#f29219] bg-white px-2.5 text-xs text-[#f29219] transition hover:bg-amber-50 md:h-[38px] md:rounded-[5px] md:px-4"
                onClick={() => router.push("/kr/mypage/payment-methods/bnpl")}
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

              {/* 즉시 결제는 모바일에만 존재하는 기능이므로 hidden 유지 */}
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

      {/* 2-2. 적립금/계좌/적립예정 카드 (공통 디자인을 따르지만, 나중결제 정보 포함 가능) */}
      <ArticleCard title="아몬드영 적립금">
        <p className="flex items-end gap-2 text-black">
          <span className="text-2xl font-bold">4,200</span>
          <span className="text-base">원</span>
        </p>
      </ArticleCard>

      <ArticleCard title="계좌" isLink>
        <p className="flex items-center gap-1 text-black">
          <span className="text-base">우리은행 계좌</span>
          <ChevronRight className="h-5 w-5 text-gray-400" />
        </p>
      </ArticleCard>

      <ArticleCard title="적립예정 아몬드영 적립금" isLink>
        <p className="flex items-center gap-1 text-black">
          <span className="text-base">200 원</span>
          <ChevronRight className="h-5 w-5 text-gray-400" />
        </p>
      </ArticleCard>
    </section>
  )
}

// 🎯 일반 카드 항목 컴포넌트 (중복 최소화 및 시맨틱 태그 활용)
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

  // 견고한 CSS: Flexbox를 사용한 양쪽 정렬
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

// 🎯 비가입자 전용 컴포넌트
const NoLatePaymentSummary = () => {
  const router = useRouter()
  return (
    <section
      aria-labelledby="payment-summary"
      className="space-y-3.5 rounded-lg bg-[#f8f8f8] p-4 md:p-6" // 반응형 패딩 적용
    >
      {/* 계좌 없음 카드 (결제수단 등록 유도) */}
      <article className="rounded-[10px] bg-white p-5 shadow-sm md:py-3 md:pl-7">
        <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center md:justify-between md:gap-0">
          <p className="text-center text-base font-normal text-black md:text-left">
            아직 등록한 계좌가 없습니다
          </p>
          <button
            type="button"
            onClick={() => router.push("/kr/mypage/payment-methods/add")}
            // w-full을 md:w-48로 제한하여 반응형 크기 설정
            className="inline-flex w-full items-center justify-center gap-2.5 rounded-[5px] bg-amber-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-600 md:w-48"
          >
            + 결제수단 등록
          </button>
        </div>
      </article>

      {/* 적립금 카드 (ArticleCard 재사용) */}
      <ArticleCard title="아몬드영 적립금">
        <p className="flex items-end gap-2.5 text-black">
          <span className="text-xs font-bold md:text-2xl">0</span>
          <span className="text-xs font-normal md:text-base">원</span>
        </p>
      </ArticleCard>

      {/* 계좌 카드 (ArticleCard 재사용) */}
      <ArticleCard title="계좌" isLink>
        <p className="flex items-center gap-1 text-black">
          <span className="text-xs font-bold md:text-base">
            등록한 계좌가 없어요{" "}
          </span>
          <ChevronRight className="h-5 w-5 text-gray-400" />
        </p>
      </ArticleCard>

      {/* 적립 예정 적립금 카드 (ArticleCard 재사용) */}
      <ArticleCard title="적립예정 아몬드영 적립금" isLink>
        <p className="flex items-center gap-1 text-black">
          <span className="text-xs font-normal md:text-base">0 원</span>
          <ChevronRight className="h-5 w-5 text-gray-400" />
        </p>
      </ArticleCard>
    </section>
  )
}

// 🎯 페이지 본문
export default function PaymentManagement() {
  const router = useRouter()
  const [profiles, setProfiles] = useState<PaymentProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null
  )

  // 결제 프로필 목록 가져오기
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const data = await refundGetPaymentProfiles()
        setProfiles(data)
      } catch (error) {
        console.error("결제 프로필 조회 실패:", error)
        toast.error("결제 프로필을 불러오는데 실패했습니다.")
      } finally {
        setLoading(false)
      }
    }

    fetchProfiles()
  }, [])

  // HMS 카드 프로필 필터링
  const hmsCardProfiles = profiles.filter(
    (p) => p.kind === "CARD" && p.provider === "HMS_CARD"
  )

  return (
    <div className="min-h-screen bg-gray-50 px-3 py-4 md:px-6">
      <PageTitle>결제수단 관리</PageTitle>

      {/* 등록된 카드 섹션 */}
      <section className="mt-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">등록된 카드</h2>
          <button
            onClick={() => router.push("/kr/mypage/payment-methods/add")}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
          >
            <Plus className="h-4 w-4" />
            카드 추가
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
          </div>
        ) : hmsCardProfiles.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-gray-500">등록된 카드가 없습니다</p>
            <button
              onClick={() => router.push("/kr/mypage/payment-methods/add")}
              className="mt-4 rounded-lg bg-amber-500 px-6 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
            >
              첫 카드 등록하기
            </button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {hmsCardProfiles.map((profile) => (
              <PaymentCardUI
                key={profile.id}
                profile={profile}
                onClick={() => setSelectedProfileId(profile.id)}
                selected={selectedProfileId === profile.id}
              />
            ))}
          </div>
        )}
      </section>

      {/* 적립금 및 기타 정보 */}
      <section className="mt-8 space-y-3">
        <ArticleCard title="아몬드영 적립금">
          <p className="flex items-end gap-2 text-black">
            <span className="text-2xl font-bold">0</span>
            <span className="text-base">원</span>
          </p>
        </ArticleCard>

        <ArticleCard title="적립예정 아몬드영 적립금" isLink>
          <p className="flex items-center gap-1 text-black">
            <span className="text-base">0 원</span>
            <ChevronRight className="h-5 w-5 text-gray-400" />
          </p>
        </ArticleCard>
      </section>

      {/* 메뉴 네비게이션 */}
      <nav
        aria-label="결제 관련 메뉴"
        className="mt-8 rounded-lg bg-white shadow-sm"
      >
        <ul className="divide-y divide-gray-200">
          {ACCOUNT_MENU_ITEMS.map((item) => (
            <li key={item.label}>
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
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
