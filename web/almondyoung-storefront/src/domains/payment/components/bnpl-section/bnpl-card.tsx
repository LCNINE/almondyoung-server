import { Button } from "@components/common/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@components/common/ui/card"
import { Skeleton } from "@components/common/ui/skeleton"
import type { BnplHistoryDto, BnplSummaryDto } from "@lib/types/dto/wallet"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { formatAmount, formatDday, formatPaymentDate } from "../utils"
import { useChangeAccountSheet } from "./hooks/use-change-account-sheet"

interface BnplCardProps {
  bnplSummary: BnplSummaryDto | null
  bnplHistory: BnplHistoryDto | null
  isLoadingHistory: boolean
  currentDate: { year: number; month: number }
  onPrevious: () => void
  onNext: () => void
  onViewDetails: () => void
}

export default function BnplCard({
  bnplSummary,
  bnplHistory,
  isLoadingHistory,
  currentDate,
  onPrevious,
  onNext,
  onViewDetails,
}: BnplCardProps) {
  const { openSheet } = useChangeAccountSheet()

  return (
    <Card className="border-none shadow-xs">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-4 text-lg font-bold">
          {/* 이전 버튼 */}
          <Button
            size="icon"
            variant="ghost"
            className="hover:text-primary cursor-pointer p-0 hover:bg-transparent"
            onClick={onPrevious}
            disabled={isLoadingHistory}
            aria-label="이전 나중결제 내역"
          >
            <ChevronLeftIcon className="size-6" />
          </Button>

          <span>
            나중결제 내역 ({currentDate.year}년 {currentDate.month}월)
          </span>

          {/* 다음 버튼 */}
          <Button
            size="icon"
            variant="ghost"
            className="hover:text-primary cursor-pointer p-0 hover:bg-transparent"
            onClick={onNext}
            disabled={isLoadingHistory}
            aria-label="다음 나중결제 내역"
          >
            <ChevronRightIcon className="size-6" />
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <CardDescription className="sr-only">나중결제 내역</CardDescription>

        <div className="flex items-baseline gap-1">
          {/* 금액 */}
          <div className="flex-1">
            {isLoadingHistory ? (
              <Skeleton className="bg-gray-10 h-8 w-24" />
            ) : (
              <>
                <span className="text-3xl font-bold text-gray-900">
                  {formatAmount(bnplHistory?.totalAmount ?? 0)}
                </span>
                <span className="text-base text-gray-500"> 원 </span>
              </>
            )}
          </div>

          {/* 결제일 정보 */}
          <div className="mt-2 flex flex-2 items-center gap-2 text-sm text-gray-600">
            <span>
              {formatPaymentDate(bnplSummary?.nextBillingDate ?? "")} 결제
            </span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              {formatDday(bnplSummary?.dDay ?? 0)}
            </span>
            <span className="text-gray-300">/</span>
            {/* <span>{bankName}</span> */}
          </div>

          {/* Action Buttons */}
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-yellow-40 border-yellow-40 hover:bg-yellow-10 hover:text-yellow-30 cursor-pointer px-4 py-5 text-sm font-normal"
              onClick={onViewDetails}
            >
              내역 보기
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer px-4 py-5 text-sm font-normal text-gray-700 hover:bg-transparent hover:text-gray-700"
              onClick={openSheet}
            >
              출금 계좌 변경
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
