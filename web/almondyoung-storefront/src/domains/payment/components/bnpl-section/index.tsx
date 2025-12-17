"use client"

import { Button } from "@components/common/ui/button"
import type { BnplProfileDto } from "@lib/types/dto/wallet"
import { useCallback, useEffect, useState } from "react"
import EmptyState from "../empty-state"
import { useBnplModalStore } from "../store/bnpl-modal-store"
import BnplCard from "./bnpl-card"
import BnplHistorySheet from "./bnpl-history-sheet"
import { useBnplHistory } from "./hooks/use-bnpl-history"
import { useBnplSummary } from "./hooks/use-bnpl-summary"

interface BnplSectionProps {
  bnplProfiles: BnplProfileDto[]
  hasError?: boolean
}

export default function BnplSection({
  bnplProfiles,
  hasError = false,
}: BnplSectionProps) {
  const { openModal } = useBnplModalStore()

  const { bnplSummary, isPending: isLoadingSummary } = useBnplSummary()
  const {
    fetchBnplHistory,
    data: bnplHistory,
    isPending: isLoadingHistory,
  } = useBnplHistory()

  // Sheet 열림 상태
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  // 현재 년월 관리
  const [currentDate, setCurrentDate] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })

  useEffect(() => {
    fetchBnplHistory(currentDate.year, currentDate.month)
  }, [currentDate.year, currentDate.month])

  // 이전 달로 이동
  const handlePrevious = useCallback(() => {
    setCurrentDate((prev) => {
      if (prev.month === 1) {
        return { year: prev.year - 1, month: 12 }
      }
      return { year: prev.year, month: prev.month - 1 }
    })
  }, [])

  // 다음 달로 이동
  const handleNext = useCallback(() => {
    setCurrentDate((prev) => {
      if (prev.month === 12) {
        return { year: prev.year + 1, month: 1 }
      }
      return { year: prev.year, month: prev.month + 1 }
    })
  }, [])

  const hasBnplProfile = bnplProfiles.length > 0

  // Error State
  if (hasError) {
    return (
      <EmptyState
        message="나중결제 내역을 불러오는데 실패했습니다"
        contentClassName="p-0! py-4! pl-0! md:pl-2!"
        action={
          <Button
            variant="outline"
            className="w-full cursor-pointer px-6 font-medium sm:w-auto"
            onClick={() => window.location.reload()}
          >
            다시 시도
          </Button>
        }
      />
    )
  }

  // Empty State
  if (!hasBnplProfile) {
    return (
      <EmptyState
        message="아직 등록한 계좌가 없습니다"
        contentClassName="p-0! py-4! pl-0! md:pl-2!"
        action={
          <Button
            variant="default"
            className="w-full cursor-pointer px-6 font-medium sm:w-auto"
            onClick={openModal}
          >
            + 결제수단 등록
          </Button>
        }
      />
    )
  }

  return (
    <>
      <BnplCard
        bnplSummary={bnplSummary}
        bnplHistory={bnplHistory}
        isLoadingHistory={isLoadingHistory}
        currentDate={currentDate}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onViewDetails={() => setIsSheetOpen(true)}
      />

      <BnplHistorySheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        bnplHistory={bnplHistory}
        isLoading={isLoadingHistory}
        currentDate={currentDate}
        onPrevious={handlePrevious}
        onNext={handleNext}
      />
    </>
  )
}
