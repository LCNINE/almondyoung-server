"use client"

import React, { useState, useEffect } from "react"
import { Info, ChevronDown, X } from "lucide-react"
import { cn } from "@lib/utils"
import { Drawer } from "vaul"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@components/common/ui/dialog"
import { useMediaQuery } from "hooks/use-media-query"

// --- Types & Mock Data ---

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
const LimitSummary = () => {
    const remainingLimit = limitInfo.totalLimit - limitInfo.usedAmount
    const usagePercent = (limitInfo.usedAmount / limitInfo.totalLimit) * 100

    return (
        <section className="bg-white px-5 py-6 md:p-0">
            <div className="rounded-2xl bg-[#F7F8FA] p-5 shadow-sm md:border md:border-gray-200 md:bg-white md:p-6">
                {/* 상단: 타이틀 + 날짜 안내 */}
                <div className="mb-4 flex flex-col justify-between gap-2 md:flex-row md:items-center">
                    <div className="flex items-center gap-1 text-[15px] font-bold text-gray-600 md:text-base">
                        사용 가능한 한도
                        <Info className="h-4 w-4 text-gray-400" />
                    </div>
                    <div className="hidden text-sm md:block">
                        <span className="font-medium text-gray-500">다음 자동 결제일 </span>
                        <span className="font-bold text-black">6월 15일</span>
                    </div>
                </div>

                {/* 메인: 금액 + 프로그레스 바 */}
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:gap-8">
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

                <button className="hidden items-center gap-1 text-sm font-medium text-gray-500 md:flex">
                    최근 3개월 <ChevronDown className="h-4 w-4" />
                </button>
            </div>

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

interface BnplHistoryDrawerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function BnplHistoryDrawer({
    open,
    onOpenChange,
}: BnplHistoryDrawerProps) {
    const isDesktop = useMediaQuery("(min-width: 768px)")

    // Browser back button handling
    useEffect(() => {
        if (!open) return

        const handlePopState = () => {
            onOpenChange(false)
        }

        window.history.pushState({ modal: "bnpl-history" }, "")
        window.addEventListener("popstate", handlePopState)

        return () => {
            window.removeEventListener("popstate", handlePopState)
        }
    }, [open, onOpenChange])

    const content = (
        <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <DialogTitle className="text-lg font-bold">나중결제 이용내역</DialogTitle>
                <button
                    onClick={() => onOpenChange(false)}
                    className="rounded-full p-1 hover:bg-gray-100"
                    aria-label="닫기"
                >
                    <X className="h-5 w-5" />
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto bg-white">
                <div className="flex flex-col gap-6 font-['Pretendard']">
                    <LimitSummary />
                    <HistorySection />
                </div>
            </div>
        </>
    )

    if (isDesktop) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent
                    className="flex max-h-[90vh] max-w-[600px] flex-col gap-0 p-0 overflow-hidden"
                    showCloseButton={false}
                >
                    <DialogDescription className="sr-only">
                        나중결제 한도 및 이용 내역을 조회합니다.
                    </DialogDescription>
                    {content}
                </DialogContent>
            </Dialog>
        )
    }

    return (
        <Drawer.Root open={open} onOpenChange={onOpenChange}>
            <Drawer.Portal>
                <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
                <Drawer.Content className="fixed right-0 bottom-0 left-0 z-50 flex h-[96vh] flex-col rounded-t-[10px] bg-white">
                    {/* Mobile Drag Handle */}
                    <div className="mx-auto mt-4 h-1.5 w-12 shrink-0 rounded-full bg-gray-300 mb-2" />
                    {content}
                </Drawer.Content>
            </Drawer.Portal>
        </Drawer.Root>
    )
}
