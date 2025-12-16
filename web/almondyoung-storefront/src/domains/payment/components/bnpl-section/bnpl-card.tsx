import { Button } from "@components/common/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@components/common/ui/card"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

interface BnplCardProps {
  price: number // 결제 금액
  formattedPrice: string // 포맷팅된 금액 문자열 (예: "156,000")
  paymentDate: string // 결제 예정일 (예: "6월 7일")
  dDayText: string // D-day 텍스트 (예: "D-3")
  bankName: string // 은행명
  onPrevious: () => void
  onNext: () => void
  onViewDetails: () => void // 내역 보기 버튼 클릭 핸들러
  onChangeAccount: () => void // 출금 계좌 변경 버튼 클릭 핸들러
}

export function BnplCard({
  price,
  formattedPrice,
  paymentDate,
  dDayText,
  bankName,
  onPrevious,
  onNext,
  onViewDetails,
  onChangeAccount,
}: BnplCardProps) {
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
            aria-label="이전 나중결제 내역"
          >
            <ChevronLeftIcon className="size-6" />
          </Button>

          <span>나중결제 내역</span>

          {/* 다음 버튼 */}
          <Button
            size="icon"
            variant="ghost"
            className="hover:text-primary cursor-pointer p-0 hover:bg-transparent"
            onClick={onNext}
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
            <span className="text-3xl font-bold text-gray-900">
              {formattedPrice}
            </span>
            <span className="text-base text-gray-500"> 원 </span>
          </div>

          {/* 결제일 정보 */}
          <div className="mt-2 flex flex-2 items-center gap-2 text-sm text-gray-600">
            <span>{paymentDate} 결제</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              {dDayText}
            </span>
            <span className="text-gray-300">/</span>
            <span>{bankName}</span>
          </div>

          {/* 액션 버튼들 */}
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
              onClick={onChangeAccount}
            >
              출금 계좌 변경
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
