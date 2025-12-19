"use client"

import { Button } from "@components/common/ui/button"
import { setDefaultPaymentProfile } from "@lib/api/wallet"
import type { BnplProfileDto } from "@lib/types/dto/wallet"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState, useTransition } from "react"
import EmptyState from "../empty-state"
import { useBnplModalStore } from "../store/bnpl-modal-store"
import BnplCard from "./bnpl-card"
import BnplHistorySheet from "./bnpl-history-sheet"
import ChangeAccountSheet from "./change-account-sheet"
import { useBnplHistory } from "./hooks/use-bnpl-history"
import { useBnplSummary } from "./hooks/use-bnpl-summary"
import { useChangeAccountSheet } from "./hooks/use-change-account-sheet"

interface BnplSectionProps {
  bnplProfiles: BnplProfileDto[]
  hasError?: boolean
}

export default function BnplSection({
  bnplProfiles,
  hasError = false,
}: BnplSectionProps) {
  const { openModal } = useBnplModalStore()
  const { isOpen: isChangeAccountSheetOpen, closeSheet } =
    useChangeAccountSheet()

  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    // 나중결제 계좌가 1개이고, 기본 결제 수단이 설정되지 않은 경우에만 설정
    if (bnplProfiles.length === 1 && !bnplProfiles[0].isDefault) {
      console.log("기본 결제 수단 자동 설정:", bnplProfiles[0])
      startTransition(async () => {
        try {
          await setDefaultPaymentProfile(bnplProfiles[0].id)
          router.refresh()
        } catch (error) {
          console.error("기본 결제 수단 설정에 실패했습니다.", error)
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bnplProfiles.length,
    bnplProfiles[0]?.id,
    bnplProfiles[0]?.isDefault,
    router,
  ])

  // 현재 년월 관리
  const [currentDate, setCurrentDate] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })

  // Sheet 열림 상태
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  const hasBnplProfile = bnplProfiles.length > 0

  // 계좌가 있을 때만 요청 (enabled: hasBnplProfile)
  const { bnplSummary, isPending: isLoadingSummary } =
    useBnplSummary(hasBnplProfile)
  const { data: bnplHistory, isPending: isLoadingHistory } = useBnplHistory(
    currentDate.year,
    currentDate.month,
    hasBnplProfile
  )

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

  // Error State
  if (hasError) {
    return (
      <EmptyState
        message="나중결제 내역을 불러오는데 실패했습니다"
        contentClassName="p-0! py-4! pl-0! md:pl-2!"
        action={
          <Button
            variant="outline"
            className="w-full cursor-pointer px-6 text-sm font-medium sm:w-auto sm:text-base"
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
            className="w-full cursor-pointer px-6 text-sm font-medium sm:w-auto sm:text-base"
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
        isLoading={isLoadingSummary}
        bankName={bnplProfiles[0].name}
      />

      {/* 내역 보기 */}
      <BnplHistorySheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        bnplHistory={bnplHistory}
        isLoading={isLoadingHistory}
        currentDate={currentDate}
        onPrevious={handlePrevious}
        onNext={handleNext}
      />

      {/* 출금 계좌 변경 */}
      <ChangeAccountSheet
        isOpen={isChangeAccountSheetOpen}
        onClose={closeSheet}
        bnplProfiles={bnplProfiles}
      />
    </>
  )
}
