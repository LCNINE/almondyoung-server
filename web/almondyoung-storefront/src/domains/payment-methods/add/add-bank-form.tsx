"use client"
import { useRouter } from "next/navigation"

export default function AddBankForm() {
  const router = useRouter()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // 비즈니스 로직은 추후 구현
    // 임시로 등록 완료 알림 후 결제수단 목록으로 복귀
    alert("계좌가 등록되었습니다 (임시)")
    router.push("/kr/mypage/payment-methods")
  }

  return (
    <div className="flex min-h-screen flex-col bg-white p-4">
      <h1 className="mb-6 text-2xl font-bold">계좌 등록</h1>

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
          <input
            type="text"
            placeholder="계좌번호 입력"
            className="rounded-md border border-gray-300 px-4 py-3"
          />
        </div>

        {/* 예금주명 */}
        <div className="flex flex-col">
          <label className="mb-2 text-sm font-medium">예금주명</label>
          <input
            type="text"
            placeholder="홍길동"
            className="rounded-md border border-gray-300 px-4 py-3"
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
