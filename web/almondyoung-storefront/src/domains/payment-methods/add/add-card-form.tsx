"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { createHmsCardProfile } from "@lib/api/wallet/wallet-api"
import { toast } from "sonner"
import { ApiError } from "@lib/api/api-error"
import { ChevronLeft } from "lucide-react"

interface AddCardFormProps {
  onComplete?: () => void
  onBack?: () => void
}

export default function AddCardForm({ onComplete, onBack }: AddCardFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    memberName: "",
    phone: "",
    payerNumber: "",
    paymentNumber: "",
    payerName: "",
    validUntil: "",
    password: "",
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      // 유효기간 파싱 (MMYY 형식)
      const validMonth = formData.validUntil.slice(0, 2)
      const validYear = formData.validUntil.slice(2, 4)

      // HMS 카드 등록 API 호출
      await createHmsCardProfile({
        memberName: formData.payerName,
        phone: formData.phone,
        payerNumber: formData.payerNumber,
        paymentNumber: formData.paymentNumber.replace(/-/g, ""), // 하이픈 제거
        payerName: formData.payerName,
        validYear: validYear,
        validMonth: validMonth,
        validUntil: formData.validUntil,
        password: formData.password,
      })

      toast.success("카드가 등록되었습니다!")

      if (onComplete) {
        onComplete()
      } else {
        router.push("/kr/mypage/payment-methods")
      }
      router.refresh()
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message)
      } else {
        toast.error("카드 등록에 실패했습니다.")
      }
      console.error(error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col bg-white p-4">
      <div className="mb-6 flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="-ml-2 p-1">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <h1 className="text-2xl font-bold">멤버십 카드 등록</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* 카드 소유자명 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">카드 소유자명</label>
          <input
            type="text"
            name="payerName"
            value={formData.payerName}
            onChange={handleChange}
            placeholder="홍길동"
            className="rounded-md border border-gray-300 px-4 py-3"
            required
          />
        </div>

        {/* 생년월일/사업자번호 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">
            6자리 생년월일/사업자번호
          </label>
          <input
            type="text"
            name="payerNumber"
            value={formData.payerNumber}
            onChange={handleChange}
            placeholder="YYMMDD"
            className="rounded-md border border-gray-300 px-4 py-3"
            maxLength={6}
            required
          />
        </div>

        {/* 전화번호 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">전화번호</label>
          <input
            type="text"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            placeholder="01012345678"
            className="rounded-md border border-gray-300 px-4 py-3"
            maxLength={11}
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            하이픈 없이 10-11자리 입력 (예: 01012345678)
          </p>
        </div>

        {/* 카드번호 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">카드번호</label>
          <input
            type="text"
            name="paymentNumber"
            value={formData.paymentNumber}
            onChange={handleChange}
            placeholder="0000-0000-0000-0000"
            className="rounded-md border border-gray-300 px-4 py-3"
            maxLength={19}
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            테스트 환경: 끝자리가 짝수여야 합니다
          </p>
        </div>

        {/* 유효기간 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">유효기간</label>
          <input
            type="text"
            name="validUntil"
            value={formData.validUntil}
            onChange={handleChange}
            placeholder="MMYY"
            className="rounded-md border border-gray-300 px-4 py-3"
            maxLength={4}
            required
          />
        </div>

        {/* 비밀번호 앞 2자리 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">비밀번호 앞 2자리</label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            placeholder="••"
            className="rounded-md border border-gray-300 px-4 py-3"
            maxLength={2}
            required
          />
        </div>

        {/* 제출 버튼 */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-4 w-full rounded-md bg-amber-500 py-3 font-semibold text-white disabled:opacity-50"
        >
          {isSubmitting ? "등록 중..." : "등록"}
        </button>
      </form>
    </div>
  )
}
