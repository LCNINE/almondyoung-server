"use client"

import React, { useState } from "react"
import { Info, Filter, ChevronDown } from "lucide-react"
import { cn } from "@lib/utils"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout" // 제공해주신 레이아웃 import

// --- Types & Mock Data (이전과 동일) ---

type PaymentStatus = "WAITING" | "COMPLETED" | "CANCELLED"

interface PaymentHistoryItem {
  id: number
  date: string
  title: string
  category: string
  amount: number
  status: PaymentStatus
  paymentDate: string
}

const historyData: PaymentHistoryItem[] = [
  {
    id: 1,
    date: "2024.05.20",
    title: "무신사 스토어",
    category: "패션/의류",
    amount: 45000,
    status: "WAITING",
    paymentDate: "06.15",
  },
  {
    id: 2,
    date: "2024.05.18",
    title: "스타벅스 강남R점",
    category: "카페",
    amount: 7200,
    status: "COMPLETED",
    paymentDate: "05.18",
  },
  {
    id: 3,
    date: "2024.05.12",
    title: "올리브영",
    category: "뷰티",
    amount: 12500,
    status: "CANCELLED",
    paymentDate: "-",
  },
  {
    id: 4,
    date: "2024.05.01",
    title: "쿠팡 로켓배송",
    category: "생활",
    amount: 63300,
    status: "COMPLETED",
    paymentDate: "05.01",
  },
  {
    id: 5,
    date: "2024.04.28",
    title: "배달의민족",
    category: "식비",
    amount: 24000,
    status: "COMPLETED",
    paymentDate: "04.28",
  },
]

const limitInfo = {
  totalLimit: 300000,
  usedAmount: 156000,
  billingDate: "매월 15일",
}

// --- Components ---

// 1. 한도 요약 카드 (LimitSummary)
// PC 상단 배치에 맞춰 가로 공간을 활용하도록 개선
const LimitSummary = () => {
  const remainingLimit = limitInfo.totalLimit - limitInfo.usedAmount
  const usagePercent = (limitInfo.usedAmount / limitInfo.totalLimit) * 100

  return (
    // 모바일: 기본 패딩 / PC: MypageLayout 내부이므로 카드 스타일만 적용
    <section className="bg-white px-5 py-6 md:p-0">
      <div className="rounded-2xl bg-[#F7F8FA] p-5 shadow-sm md:border md:border-gray-200 md:bg-white md:p-6">
        {/* 상단: 타이틀 + 날짜 안내 (PC에서는 한 줄 배치) */}
        <div className="mb-4 flex flex-col justify-between gap-2 md:flex-row md:items-center">
          <div className="flex items-center gap-1 text-[15px] font-bold text-gray-600 md:text-base">
            사용 가능한 한도
            <Info className="h-4 w-4 text-gray-400" />
          </div>
          {/* PC에서는 우측 상단에 결제일 표시 */}
          <div className="hidden text-sm md:block">
            <span className="font-medium text-gray-500">다음 자동 결제일 </span>
            <span className="font-bold text-black">6월 15일</span>
          </div>
        </div>

        {/* 메인: 금액 + 프로그레스 바 (PC에서는 좌우 배치로 균형 맞춤) */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:gap-8">
          {/* 잔여 한도 금액 */}
          <div className="shrink-0">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-black md:text-3xl">
                {remainingLimit.toLocaleString()}
              </span>
              <span className="text-lg font-medium text-black md:text-xl">
                원
              </span>
            </div>
          </div>

          {/* 프로그레스 바 영역 (PC에서 남은 공간 채움) */}
          <div className="flex w-full flex-col justify-end gap-2">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-[#f29219] transition-all duration-500 ease-out"
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-gray-500 md:text-sm">
              <span>총 한도 {limitInfo.totalLimit.toLocaleString()}원</span>
              <span className="font-bold text-[#f29219]">
                {limitInfo.usedAmount.toLocaleString()}원 사용 중
              </span>
            </div>
          </div>
        </div>

        {/* 모바일 전용 하단 안내 (PC에서는 상단으로 이동했으므로 숨김) */}
        <div className="mt-4 block h-px w-full bg-gray-200 md:hidden" />
        <div className="mt-4 flex items-center justify-between text-sm md:hidden">
          <span className="font-medium text-gray-500">다음 자동 결제일</span>
          <span className="font-bold text-black">6월 15일</span>
        </div>
      </div>
    </section>
  )
}

// 2. 상태 뱃지
const StatusBadge = ({ status }: { status: PaymentStatus }) => {
  switch (status) {
    case "WAITING":
      return (
        <span className="rounded-[4px] bg-[#fff4e0] px-1.5 py-0.5 text-[11px] font-bold text-[#f29219] md:text-xs">
          결제대기
        </span>
      )
    case "COMPLETED":
      return (
        <span className="rounded-[4px] bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 md:text-xs">
          결제완료
        </span>
      )
    case "CANCELLED":
      return (
        <span className="rounded-[4px] bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-400 line-through md:text-xs">
          취소됨
        </span>
      )
    default:
      return null
  }
}

// 3. 내역 리스트 섹션
const HistorySection = () => {
  const [activeTab, setActiveTab] = useState("전체")
  const tabs = ["전체", "결제대기", "결제완료"]

  const filteredData = historyData.filter((item) => {
    if (activeTab === "전체") return true
    if (activeTab === "결제대기") return item.status === "WAITING"
    if (activeTab === "결제완료") return item.status === "COMPLETED"
    return true
  })

  return (
    <section className="min-h-[500px] border-t border-gray-100 bg-white md:rounded-2xl md:border md:border-t md:border-gray-200">
      {/* 헤더: 탭 + 조회 필터(PC용) */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-50 bg-white px-5 py-4 md:rounded-t-2xl">
        <div className="flex gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                activeTab === tab
                  ? "bg-[#1c1c1e] text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              )}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* PC 전용: 기간 조회 필터 예시 */}
        <button className="hidden items-center gap-1 text-sm font-medium text-gray-500 md:flex">
          최근 3개월 <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {/* 리스트 */}
      <ul className="flex flex-col pb-20 md:pb-0">
        {filteredData.length > 0 ? (
          filteredData.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 border-b border-gray-50 px-5 py-5 transition-colors last:border-0 hover:bg-gray-50"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400 md:text-sm">
                  {item.date}
                </span>
                <StatusBadge status={item.status} />
              </div>

              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-[15px] font-bold text-gray-900 md:text-lg">
                    {item.title}
                  </span>
                  <span className="text-xs text-gray-500 md:text-sm">
                    {item.category}
                  </span>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <span
                    className={cn(
                      "text-[15px] font-bold md:text-lg",
                      item.status === "CANCELLED"
                        ? "text-gray-400 line-through"
                        : "text-black"
                    )}
                  >
                    {item.amount.toLocaleString()}원
                  </span>
                  {item.status === "WAITING" && (
                    <span className="text-xs text-[#f29219] md:text-sm">
                      {item.paymentDate} 자동결제 예정
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))
        ) : (
          <li className="flex h-40 items-center justify-center text-sm text-gray-400">
            내역이 없습니다.
          </li>
        )}
      </ul>
    </section>
  )
}

// --- Main Page Component ---
export default function LatePaymentHistoryPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "나중결제 이용내역",
      }}
    >
      {/* 제공해주신 MypageLayout 적용 */}
      <MypageLayout>
        {/* PC 콘텐츠 영역 (MypageLayout 내부) */}
        <div className="flex flex-col gap-6 font-['Pretendard']">
          {/* 1. 한도 요약 (PC: 상단 가로형 카드) */}
          <LimitSummary />

          {/* 2. 내역 리스트 (PC: 하단 리스트) */}
          <HistorySection />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
