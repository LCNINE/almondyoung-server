"use client"

type AlternativeProductButtonProps = {
  isSoldOut: boolean
  className?: string
}

// TODO: 재고 연동 후 활성화
export const AlternativeProductButton = ({
  isSoldOut,
  className = "",
}: AlternativeProductButtonProps) => {
  // 재고 연동 전까지 항상 숨김
  return null

  // if (!isSoldOut) return null
  //
  // return (
  //   <button
  //     type="button"
  //     className={`mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-gray-300 hover:text-gray-800 ${className}`}
  //     aria-label="대체 상품 보기"
  //   >
  //     대체 상품 보기
  //   </button>
  // )
}
