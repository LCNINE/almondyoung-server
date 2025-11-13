"use client"
import React, { useState } from "react"
import {
  ChevronDown, // [추가] 드롭다운 아이콘
} from "lucide-react"
import { cn } from "@lib/utils"
import { WithHeaderLayout } from "@components/layout"

//  필요한 API 목록
//  포인트 적립 내역 조회 API
//  현재 포인트 잔액 조회 API

// --- Mock Data ---
const historyData = [
  {
    id: 1,
    date: "2024.05.05",
    title: "상품 구매 확정 적립",
    reason: "주문번호 240501-12345",
    amount: 1250,
    balance: 1250,
  },
  {
    id: 2,
    date: "2024.04.20",
    title: "포토 리뷰 작성 적립",
    reason: "롤리킹 펌제 1제 2제",
    amount: 150,
    balance: 0,
  },
]

// --- Components ---

// 1. [변경] 메인 캐시 디스플레이 (상세 내역 카드형)
const CashSummary = () => (
  <section className="bg-white px-5 pt-6 pb-6">
    {/* 카드 컨테이너 */}
    <div className="rounded-2xl bg-[#F7F8FA] p-5 shadow-sm">
      {/* 헤더: 전체 내역 타이틀 & 총액 */}
      <div className="text-primary mb-4 flex items-center justify-between">
        <button className="flex items-center gap-1 text-[15px] font-bold text-gray-800 transition-opacity hover:opacity-70">
          현재 포인트 잔액
        </button>
        <span className="text-lg font-bold text-black">1,400원</span>
      </div>

      {/* 구분선 */}
      <div className="mb-4 h-px w-full bg-gray-200" />

      {/* 상세 내역 리스트 */}
      <div className="flex flex-col gap-3">
        {/* 적립 */}
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-500">적립</span>
          <span className="font-bold text-green-600">+2,400원</span>
        </div>

        {/* 사용 */}
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-500">사용</span>
          <span className="font-bold text-gray-900">-1,000원</span>
        </div>
      </div>
    </div>
  </section>
)

// 4. 내역 리스트 (유지)
const HistorySection = () => {
  const [activeTab, setActiveTab] = useState("전체")
  const tabs = ["전체", "적립", "사용"]

  return (
    <section className="min-h-[400px] border-t border-gray-100 bg-white">
      <div className="sticky top-0 z-40 border-b border-gray-50 bg-white px-5 py-4">
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
      </div>

      <ul className="flex flex-col pb-20">
        {historyData.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-3 border-b border-gray-50 px-5 py-5 last:border-0"
          >
            <span className="text-xs text-gray-400">{item.date}</span>
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-[15px] font-bold text-gray-900">
                  {item.title}
                </span>
                <span className="text-xs text-gray-500">{item.reason}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={cn(
                    "text-[15px] font-bold",
                    item.amount > 0 ? "text-amber-500" : "text-black"
                  )}
                >
                  {item.amount > 0 ? "+" : ""}
                  {item.amount.toLocaleString()}원
                </span>
                <span className="text-xs text-gray-400">
                  잔액 {item.balance.toLocaleString()}원
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// --- Main Page Component ---
export default function PointPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "포인트 적립",
      }}
    >
      <div className="min-h-screen w-full bg-white font-['Pretendard'] text-black">
        <div className="mx-auto min-h-screen max-w-md bg-white">
          <main>
            <CashSummary />

            <HistorySection />
          </main>
        </div>
      </div>
    </WithHeaderLayout>
  )
}
