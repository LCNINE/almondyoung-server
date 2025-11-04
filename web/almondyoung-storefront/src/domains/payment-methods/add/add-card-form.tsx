"use client"
import { useRouter } from "next/navigation"

export default function AddCardForm() {
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // 비즈니스 로직은 추후 구현
    // 임시로 등록 완료 알림 후 결제수단 목록으로 복귀
    alert("카드가 등록되었습니다 (임시)")
    router.push("/kr/mypage/payment-methods")
  }

  return (
    <div className="flex min-h-screen flex-col bg-white p-4">
      <h1 className="mb-6 text-2xl font-bold">카드 등록</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* 카드번호 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">카드번호</label>
          <input
            type="text"
            placeholder="0000-0000-0000-0000"
            className="rounded-md border border-gray-300 px-4 py-3"
            maxLength={19}
          />
        </div>

        {/* 유효기간 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">유효기간</label>
          <input
            type="text"
            placeholder="MM/YY"
            className="rounded-md border border-gray-300 px-4 py-3"
            maxLength={5}
          />
        </div>

        {/* 카드 소유자명 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">카드 소유자명</label>
          <input
            type="text"
            placeholder="홍길동"
            className="rounded-md border border-gray-300 px-4 py-3"
          />
        </div>

        {/* CVC */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">CVC</label>
          <input
            type="text"
            placeholder="000"
            className="rounded-md border border-gray-300 px-4 py-3"
            maxLength={3}
          />
        </div>

        {/* 제출 버튼 */}
        <button
          type="submit"
          className="mt-4 w-full rounded-md bg-amber-500 py-3 font-semibold text-white"
        >
          등록
        </button>
      </form>
    </div>
  )
}
