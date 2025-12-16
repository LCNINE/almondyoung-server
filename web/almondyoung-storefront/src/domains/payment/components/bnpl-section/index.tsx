"use client"

import { Button } from "@components/common/ui/button"
import type { BnplProfileDto } from "@lib/types/dto/wallet"
import { format } from "date-fns"
import EmptyState from "../empty-state"
import { BnplCard } from "./bnpl-card"
import { useBnplCarousel } from "./hooks/use-bnpl-carousel"
import {
  calculateDday,
  formatAmount,
  formatDday,
  formatPaymentDate,
  getBankName,
} from "./utils/bnpl-utils"

interface BnplSectionProps {
  onBnplRegisterClick: () => void
  bnplProfiles: BnplProfileDto[]
}

export default function BnplSection({
  onBnplRegisterClick,
  bnplProfiles,
}: BnplSectionProps) {
  const hasBnplProfile = bnplProfiles.length > 0

  // 캐러셀 상태 관리
  const { currentIndex, handlePrevious, handleNext, hasMultipleItems } =
    useBnplCarousel(bnplProfiles.length)

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
            onClick={onBnplRegisterClick}
          >
            + 결제수단 등록
          </Button>
        }
      />
    )
  }

  const currentProfile = bnplProfiles[currentIndex]

  // TODO: 실제 API에서 결제 금액과 결제일을 가져와야 함
  // 현재는 임시 데이터 사용
  const mockPrice = 156000
  const mockPaymentDate = format(new Date("2025-06-07"), "yyyy-MM-dd")

  // 데이터 가공
  const formattedPrice = formatAmount(mockPrice)
  const paymentDate = formatPaymentDate(mockPaymentDate)
  const dday = calculateDday(mockPaymentDate)
  const dDayText = formatDday(dday)
  const bankName = getBankName(currentProfile)

  const handleViewDetails = () => {
    // TODO: 내역 보기 기능 구현
    console.log("내역 보기 클릭", currentProfile)
  }

  return (
    <BnplCard
      price={mockPrice}
      formattedPrice={formattedPrice}
      paymentDate={paymentDate}
      dDayText={dDayText}
      bankName={bankName}
      onPrevious={handlePrevious}
      onNext={handleNext}
      onViewDetails={handleViewDetails}
      onChangeAccount={onBnplRegisterClick}
    />
  )
}
