"use client"
import { CustomButton } from "@components/common/custom-buttons"
import { Input } from "@components/common/ui/input"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"

interface AddBankFormProps {
  onComplete?: () => void
  onBack?: () => void
}

export default function AddBankForm({ onComplete, onBack }: AddBankFormProps) {
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // 비즈니스 로직은 추후 구현
    // 임시로 등록 완료 알림 후 결제수단 목록으로 복귀
    alert("계좌가 등록되었습니다 (임시)")

    if (onComplete) {
      onComplete()
    } else {
      router.push("/kr/mypage/payment-methods")
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-white p-4">
      <div className="mb-6 flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="p-1 -ml-2">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <h1 className="text-2xl font-bold">계좌 등록</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* 은행 선택 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">은행</label>
          <select className="rounded-md border border-gray-300 px-4 py-3">
            <option>은행 선택</option>
            <option>우리은행</option>
            <option>KB국민은행</option>
            <option>신한은행</option>
            <option>하나은행</option>
            <option>NH농협은행</option>
          </select>
        </div>

        {/* 계좌번호 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">계좌번호</label>
          <Input placeholder="계좌번호 입력" />
        </div>

        {/* 예금주명 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">예금주명</label>
          <Input placeholder="홍길동" />
        </div>
        <div className="flex justify-end">
          <div className="w-[150px]">
            <CustomButton
              variant="fill"
              color="primary"
              size="lg"
              fullWidth={true}
            >
              계좌 조회
            </CustomButton>
          </div>
        </div>
        {/* 제출 버튼 */}
        <button
          type="submit"
          className="mt-4 w-full rounded-md bg-amber-500 py-3 font-semibold text-white"
        >
          다음
        </button>
      </form>
    </div>
  )
}
