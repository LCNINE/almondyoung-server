"use client"

import { useState } from "react"
import { ChevronRight } from "lucide-react"
import { PageTitle } from "@components/common/page-title"
import { useRouter } from "next/navigation"

// 🎯 Card 컴포넌트 개선
function Card({
  children,
  padding = "p-6",
}: {
  children: React.ReactNode
  padding?: string
}) {
  return (
    <article className="rounded-2xl bg-white shadow-[0_2px_4px_0_rgba(0,0,0,0.1)]">
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
// 🎯 페이지 본문
export default function PaymentManagement() {
  const [hasPaymentMethod, setHasPaymentMethod] = useState(false)
  const router = useRouter()

  return (
    <div className="min-h-screen bg-white py-4 md:px-6">
      <PageTitle>결제수단 관리</PageTitle>

      {/* 결제 요약 섹션 */}
      <section
        aria-labelledby="payment-summary"
        className="space-y-3.5 rounded-lg bg-[#f8f8f8] px-3.5 py-5"
      >
        {/* 계좌 없음 카드 */}
        <article className="rounded-[10px] md:py-3 md:pl-7">
          <div className="flex flex-col items-stretch gap-4 md:flex-row md:items-center md:justify-between md:gap-0">
            <p className="text-center font-['Pretendard'] text-base font-normal text-black md:text-left">
              아직 등록한 계좌가 없습니다
            </p>
            <button
              type="button"
              onClick={() => router.push("/kr/mypage/payment-methods/add")}
              className="inline-flex w-full items-center justify-center gap-2.5 rounded-[5px] bg-amber-500 px-4 py-3 font-['Pretendard'] text-sm font-semibold text-white transition hover:bg-amber-600 md:w-48 md:text-center"
            >
              + 결제수단 등록
            </button>
          </div>
        </article>

        {/* 적립금 카드 */}
        <article className="flex items-center justify-between rounded-[10px] bg-white px-7 py-6 shadow-[0_2px_10px_rgba(0,0,0,0.05)] outline-[0.5px] outline-offset-[-0.5px]">
          <h2 className="text-xs font-bold text-black md:text-lg">
            아몬드영 적립금
          </h2>
          <p className="flex items-center gap-2.5 font-['Pretendard'] text-black">
            <span className="text-xs font-bold md:text-2xl">0</span>
            <span className="text-xs font-normal md:text-base">원</span>
          </p>
        </article>

        {/* 계좌 카드 */}
        <article className="flex items-center justify-between rounded-[10px] bg-white px-7 py-6 shadow-[0_2px_10px_rgba(0,0,0,0.05)] outline-[0.5px] outline-offset-[-0.5px]">
          <h2 className="text-xs font-normal text-black md:text-lg">계좌</h2>
          <p className="flex items-center gap-1 font-['Pretendard'] text-black">
            <span className="text-xs font-bold md:text-base">
              등록한 계좌가 없어요{" "}
            </span>
            <ChevronRight className="h-5 w-5 text-gray-400" />
          </p>
        </article>

        {/* 적립 예정 적립금 카드 */}
        <article className="flex items-center justify-between rounded-[10px] bg-white px-7 py-6 shadow-[0_2px_10px_rgba(0,0,0,0.05)] outline-[0.5px] outline-offset-[-0.5px]">
          <h2 className="text-xs font-normal text-black md:text-lg">
            적립예정 아몬드영 적립금
          </h2>
          <p className="flex items-center gap-1 font-['Pretendard'] text-black">
            <span className="text-xs font-normal md:text-base">0 원</span>
            <ChevronRight className="h-5 w-5 text-gray-400" />
          </p>
        </article>
      </section>

      {/* 메뉴 네비게이션 */}
      <nav
        aria-label="계좌 관련 메뉴"
        className="mt-10 mb-[111px] rounded-lg bg-white"
      >
        <ul className="divide-muted divide-y">
          {ACCOUNT_MENU_ITEMS.map((item) => (
            <li key={item.label} className="first:border-t-1">
              <a
                href={item.href}
                className="flex items-center justify-between px-7 py-3.5 transition-colors hover:bg-gray-50"
              >
                <span className="font-['Pretendard'] text-lg font-normal text-black">
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
