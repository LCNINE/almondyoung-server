"use client"
import { CustomButton } from "@components/common/custom-buttons"
import { Input } from "@components/common/ui/input"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { useForm } from "react-hook-form"

export interface BankFormData {
  bank: string
  accountNumber: string
  accountHolder: string
}

interface AddBankFormProps {
  onComplete?: (data: BankFormData) => void
  onBack?: () => void
  initialData?: BankFormData | null
}

// 외부 API 호출 함수 (껍데기)
async function verifyBankAccount(data: BankFormData): Promise<boolean> {
  // TODO: 실제 외부 API 연동 (공공데이터 또는 기타 서비스)
  // 현재는 임시로 성공 처리
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log("계좌 조회 API 호출:", data)
      resolve(true)
    }, 500)
  })
}

export default function AddBankForm({
  onComplete,
  onBack,
  initialData,
}: AddBankFormProps) {
  const router = useRouter()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<BankFormData>({
    defaultValues: initialData || {
      bank: "",
      accountNumber: "",
      accountHolder: "",
    },
  })

  const onSubmit = async (data: BankFormData) => {
    try {
      // 외부 API 호출 (계좌 조회)
      const isValid = await verifyBankAccount(data)
      if (!isValid) {
        alert("계좌 조회에 실패했습니다. 정보를 확인해주세요.")
        return
      }

      if (onComplete) {
        onComplete(data)
      } else {
        router.push("/kr/mypage/payment-methods")
      }
    } catch (error) {
      console.error("계좌 조회 오류:", error)
      alert("계좌 조회 중 오류가 발생했습니다.")
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

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        {/* 은행 선택 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">은행</label>
          <select
            {...register("bank", { required: "은행을 선택해주세요" })}
            className="rounded-md border border-gray-300 px-4 py-3"
          >
            <option value="">은행 선택</option>
            <option value="우리은행">우리은행</option>
            <option value="KB국민은행">KB국민은행</option>
            <option value="신한은행">신한은행</option>
            <option value="하나은행">하나은행</option>
            <option value="NH농협은행">NH농협은행</option>
          </select>
          {errors.bank && (
            <p className="mt-1 text-xs text-red-500">{errors.bank.message}</p>
          )}
        </div>

        {/* 계좌번호 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">계좌번호</label>
          <Input
            {...register("accountNumber", {
              required: "계좌번호를 입력해주세요",
            })}
            placeholder="계좌번호 입력"
          />
          {errors.accountNumber && (
            <p className="mt-1 text-xs text-red-500">
              {errors.accountNumber.message}
            </p>
          )}
        </div>

        {/* 예금주명 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">예금주명</label>
          <Input
            {...register("accountHolder", {
              required: "예금주명을 입력해주세요",
            })}
            placeholder="홍길동"
          />
          {errors.accountHolder && (
            <p className="mt-1 text-xs text-red-500">
              {errors.accountHolder.message}
            </p>
          )}
        </div>
        <div className="flex justify-end">
          <div className="w-[150px]">
            <CustomButton
              variant="fill"
              color="primary"
              size="lg"
              fullWidth={true}
              type="button"
              onClick={handleSubmit(onSubmit)}
              disabled={isSubmitting}
            >
              {isSubmitting ? "조회 중..." : "계좌 조회"}
            </CustomButton>
          </div>
        </div>
        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-4 w-full rounded-md bg-amber-500 py-3 font-semibold text-white disabled:opacity-50"
        >
          {isSubmitting ? "처리 중..." : "다음"}
        </button>
      </form>
    </div>
  )
}
