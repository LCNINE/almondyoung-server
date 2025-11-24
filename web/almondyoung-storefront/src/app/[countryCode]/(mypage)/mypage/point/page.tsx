"use client"
import React, { useState, useEffect } from "react"
import {
  ChevronDown, // [추가] 드롭다운 아이콘
} from "lucide-react"
import { cn } from "@lib/utils"
import { WithHeaderLayout } from "@components/layout"

// --- Types ---
interface PointHistoryItem {
  id: number
  partnerId: string
  eventType: string
  amount: number
  balance: number
  reason: string | null
  createdAt: string
}

interface PointHistoryResponse {
  items: PointHistoryItem[]
  total: number
}

interface PointBalanceResponse {
  balance: number
  withdrawable: number
}

// --- Components ---

// 1. [변경] 메인 캐시 디스플레이 (상세 내역 카드형)
const CashSummary = ({ balance, totalEarned, totalUsed }: { balance: number, totalEarned: number, totalUsed: number }) => (
  <section className="bg-white px-5 pt-6 pb-6">
    {/* 카드 컨테이너 */}
    <div className="rounded-2xl bg-[#F7F8FA] p-5 shadow-sm">
      {/* 헤더: 전체 내역 타이틀 & 총액 */}
      <div className="text-primary mb-4 flex items-center justify-between">
        <button className="flex items-center gap-1 text-[15px] font-bold text-gray-800 transition-opacity hover:opacity-70">
          현재 포인트 잔액
        </button>
        <span className="text-lg font-bold text-black">{balance.toLocaleString()}원</span>
      </div>

      {/* 구분선 */}
      <div className="mb-4 h-px w-full bg-gray-200" />

      {/* 상세 내역 리스트 */}
      <div className="flex flex-col gap-3">
        {/* 적립 */}
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-500">적립</span>
          <span className="font-bold text-green-600">+{totalEarned.toLocaleString()}원</span>
        </div>

        {/* 사용 */}
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-500">사용</span>
          <span className="font-bold text-gray-900">-{totalUsed.toLocaleString()}원</span>
        </div>
      </div>
    </div>
  </section>
)

// 4. 내역 리스트 (유지)
const HistorySection = ({ history }: { history: PointHistoryItem[] }) => {
  const [activeTab, setActiveTab] = useState("전체")
  const tabs = ["전체", "적립", "사용"]

  const filteredHistory = history.filter((item) => {
    if (activeTab === "전체") return true
    if (activeTab === "적립") return item.amount > 0
    if (activeTab === "사용") return item.amount < 0
    return true
  })

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
        {filteredHistory.length === 0 ? (
          <li className="py-10 text-center text-sm text-gray-400">내역이 없습니다.</li>
        ) : (
          filteredHistory.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 border-b border-gray-50 px-5 py-5 last:border-0"
            >
              <span className="text-xs text-gray-400">{new Date(item.createdAt).toLocaleDateString()}</span>
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-[15px] font-bold text-gray-900">
                    {item.eventType === 'EARN' ? '적립' : item.eventType === 'REDEEM' ? '사용' : item.eventType}
                  </span>
                  <span className="text-xs text-gray-500">{item.reason || item.eventType}</span>
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
          ))
        )}
      </ul>
    </section>
  )
}

// --- Main Page Component ---
export default function PointPage() {
  const [history, setHistory] = useState<PointHistoryItem[]>([])
  const [balance, setBalance] = useState(0)
  const [totalEarned, setTotalEarned] = useState(0)
  const [totalUsed, setTotalUsed] = useState(0)

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1. 내역 조회
        const historyRes = await fetch('/api/wallet/payments/points/history?limit=100')
        if (historyRes.ok) {
          const data: PointHistoryResponse = await historyRes.json()
          setHistory(data.items)

          // 간단한 클라이언트 사이드 집계 (실제로는 API에서 주는게 좋음)
          const earned = data.items.reduce((acc, item) => item.amount > 0 ? acc + item.amount : acc, 0)
          const used = data.items.reduce((acc, item) => item.amount < 0 ? acc + Math.abs(item.amount) : acc, 0)
          setTotalEarned(earned)
          setTotalUsed(used)
        }

        // 2. 잔액 조회
        const balanceRes = await fetch('/api/wallet/payments/points/balance')
        if (balanceRes.ok) {
          const data: PointBalanceResponse = await balanceRes.json()
          setBalance(data.balance)
        }
      } catch (error) {
        console.error("Failed to fetch point data", error)
      }
    }

    fetchData()
  }, [])

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
            <CashSummary balance={balance} totalEarned={totalEarned} totalUsed={totalUsed} />

            <HistorySection history={history} />
          </main>
        </div>
      </div>
    </WithHeaderLayout>
  )
}
