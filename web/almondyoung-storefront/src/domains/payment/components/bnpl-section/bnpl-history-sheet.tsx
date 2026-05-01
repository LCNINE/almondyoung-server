"use client"

import { Button } from "@components/common/ui/button"
import { ScrollArea } from "@components/common/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@components/common/ui/sheet"
import { Skeleton } from "@components/common/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@components/common/ui/tabs"
import type { BnplHistoryDto } from "@lib/types/dto/wallet"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilterIcon,
  ShoppingCartIcon,
  WalletIcon,
  XIcon,
} from "lucide-react"
import { useState } from "react"
import { formatAmount } from "../utils"

interface BnplHistorySheetProps {
  isOpen: boolean
  onClose: () => void
  bnplHistory: BnplHistoryDto | null
  isLoading: boolean
  currentDate: { year: number; month: number }
  onPrevious: () => void
  onNext: () => void
}

type EventType = "ALL" | "PURCHASE" | "PAYMENT"
type EventStatus = "ALL" | "COMPLETED" | "PENDING" | "FAILED"

export default function BnplHistorySheet({
  isOpen,
  onClose,
  bnplHistory,
  isLoading,
  currentDate,
  onPrevious,
  onNext,
}: BnplHistorySheetProps) {
  const [selectedType, setSelectedType] = useState<EventType>("ALL")
  const [selectedStatus, setSelectedStatus] = useState<EventStatus>("ALL")

  // 이벤트 필터링
  const filteredEvents =
    bnplHistory?.events?.filter((event) => {
      const typeMatch =
        selectedType === "ALL" || event.eventType === selectedType
      const statusMatch =
        selectedStatus === "ALL" || event.status === selectedStatus
      return typeMatch && statusMatch
    }) ?? []

  // 날짜별 그룹화
  const groupedByDate = filteredEvents.reduce(
    (acc, event) => {
      const date = new Date(event.createdAt).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })

      if (!acc[date]) {
        acc[date] = []
      }

      acc[date].push(event)
      return acc
    },
    {} as Record<string, typeof filteredEvents>
  )

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "PURCHASE":
        return <ShoppingCartIcon className="size-5" />
      case "PAYMENT":
        return <WalletIcon className="size-5" />
      default:
        return <CalendarIcon className="size-5" />
    }
  }

  const getEventTypeLabel = (eventType: string) => {
    switch (eventType) {
      case "PURCHASE":
        return "구매"
      case "PAYMENT":
        return "결제"
      default:
        return eventType
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "완료"
      case "PENDING":
        return "대기"
      case "FAILED":
        return "실패"
      default:
        return status
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "text-green-600 bg-green-50 border-green-200"
      case "PENDING":
        return "text-amber-600 bg-amber-50 border-amber-200"
      case "FAILED":
        return "text-red-600 bg-red-50 border-red-200"
      default:
        return "text-gray-600 bg-gray-50 border-gray-200"
    }
  }

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side="right"
        className="w-full p-0 sm:max-w-[540px]"
        onInteractOutside={(e) => {
          e.preventDefault()
        }}
      >
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-xl font-bold">
              나중결제 상세 내역
            </SheetTitle>
          </div>
          <SheetDescription className="sr-only">
            나중결제 거래 내역을 확인할 수 있습니다
          </SheetDescription>

          {/* 월 네비게이션 */}
          <div className="flex items-center justify-between pt-4">
            <Button
              size="icon"
              variant="outline"
              onClick={onPrevious}
              disabled={isLoading}
              className="size-9"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>

            <div className="text-lg font-semibold">
              {currentDate.year}년 {currentDate.month}월
            </div>

            <Button
              size="icon"
              variant="outline"
              onClick={onNext}
              disabled={isLoading}
              className="size-9"
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>

          {/* 총 금액 */}
          {!isLoading && bnplHistory && (
            <div className="bg-gray-20 mt-4 rounded-lg p-4">
              <div className="text-sm text-gray-600">이번 달 총 사용금액</div>
              <div className="mt-1 text-2xl font-bold">
                {formatAmount(bnplHistory.totalAmount)} 원
              </div>
            </div>
          )}
        </SheetHeader>

        {/* 필터 섹션 */}
        <div className="space-y-3 border-b px-6 py-4">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <FilterIcon className="size-4" />
            <span>필터</span>
          </div>

          {/* 타입 필터 */}
          <Tabs
            value={selectedType}
            onValueChange={(value) => setSelectedType(value as EventType)}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="ALL">전체</TabsTrigger>
              <TabsTrigger value="PURCHASE">구매</TabsTrigger>
              <TabsTrigger value="PAYMENT">결제</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* 상태 필터 */}
          <Tabs
            value={selectedStatus}
            onValueChange={(value) => setSelectedStatus(value as EventStatus)}
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="ALL">전체</TabsTrigger>
              <TabsTrigger value="COMPLETED">완료</TabsTrigger>
              <TabsTrigger value="PENDING">대기</TabsTrigger>
              <TabsTrigger value="FAILED">실패</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* 내역 리스트 */}
        <ScrollArea className="h-[calc(100vh-420px)]">
          <div className="px-6 py-4">
            {isLoading ? (
              // 로딩 스켈레톤
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                ))}
              </div>
            ) : filteredEvents.length === 0 ? (
              // 빈 상태
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-4 rounded-full bg-gray-100 p-4">
                  <CalendarIcon className="size-8 text-gray-400" />
                </div>
                <p className="text-lg font-medium text-gray-900">
                  내역이 없습니다
                </p>
                <p className="mt-2 text-sm text-gray-500">
                  {selectedType !== "ALL" || selectedStatus !== "ALL"
                    ? "필터 조건에 맞는 내역이 없습니다"
                    : "이번 달 나중결제 내역이 없습니다"}
                </p>
              </div>
            ) : (
              // 날짜별 그룹화된 내역
              <div className="space-y-6">
                {Object.entries(groupedByDate).map(([date, events]) => (
                  <div key={date}>
                    <div className="mb-3 flex items-center gap-2">
                      <div className="text-sm font-semibold text-gray-700">
                        {date}
                      </div>
                      <div className="h-px flex-1 bg-gray-200" />
                    </div>

                    <div className="space-y-2">
                      {events.map((event) => (
                        <div
                          key={event.id}
                          className="rounded-lg border border-gray-200 p-4 transition-colors hover:bg-gray-50"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex flex-1 gap-3">
                              {/* 아이콘 */}
                              <div
                                className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                                  event.eventCategory === "DEBIT"
                                    ? "bg-red-100 text-red-600"
                                    : "bg-blue-100 text-blue-600"
                                }`}
                              >
                                {getEventIcon(event.eventType)}
                              </div>

                              {/* 내용 */}
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-gray-900">
                                    {event.title ||
                                      getEventTypeLabel(event.eventType)}
                                  </span>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusColor(
                                      event.status
                                    )}`}
                                  >
                                    {getStatusLabel(event.status)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                  <span>
                                    {getEventTypeLabel(event.eventType)}
                                  </span>
                                  <span>•</span>
                                  <span>
                                    {new Date(
                                      event.createdAt
                                    ).toLocaleTimeString("ko-KR", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* 금액 */}
                            <div className="ml-2 flex items-center gap-1 text-right">
                              {event.eventCategory === "DEBIT" ? (
                                <ArrowDownIcon className="size-4 text-red-600" />
                              ) : (
                                <ArrowUpIcon className="size-4 text-blue-600" />
                              )}
                              <span
                                className={`text-lg font-bold ${
                                  event.eventCategory === "DEBIT"
                                    ? "text-red-600"
                                    : "text-blue-600"
                                }`}
                              >
                                {event.eventCategory === "DEBIT" ? "-" : "+"}
                                {formatAmount(event.amount)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* 하단 요약 */}
        {!isLoading && filteredEvents.length > 0 && (
          <div className="border-t bg-gray-50 px-6 py-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">
                총 {filteredEvents.length}건
              </span>
              <div className="text-right">
                <div className="text-xs text-gray-500">필터링된 합계</div>
                <div className="text-lg font-bold">
                  {formatAmount(
                    filteredEvents.reduce((sum, event) => {
                      return event.eventCategory === "DEBIT"
                        ? sum + event.amount
                        : sum - event.amount
                    }, 0)
                  )}{" "}
                  원
                </div>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
