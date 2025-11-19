"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { PageTitle } from "@components/common/page-title"
import { useRouter } from "next/navigation"

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
  // ⭐️ 조건부 처리를 위한 변수
  const isLatePaymentSubscriber = true // 실제로는 API나 Context로 받아와야 함

  return (
    // min-h-screen으로 화면 전체 높이 확보 (고정 높이 X)
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <PageTitle>결제수단 관리</PageTitle>

      {/* ⭐️ 조건부 렌더링 */}
      {isLatePaymentSubscriber ? (
        <LatePaymentSummary />
      ) : (
        <NoLatePaymentSummary />
      )}

      {/* --- */}

      {/* 메뉴 네비게이션 - nav 시맨틱 태그 사용 */}
      <nav
        aria-label="계좌 관련 메뉴"
        className="mx-4 mt-10 rounded-lg bg-white shadow-sm md:mx-0"
      >
        <ul className="divide-y divide-gray-200">
          {" "}
          {/* divide-muted 대신 Tailwind 기본값 사용 */}
          {ACCOUNT_MENU_ITEMS.map((item) => (
            <li key={item.label}>
              <a
                href={item.href}
                // 견고한 CSS: Flexbox를 사용한 양쪽 정렬
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
