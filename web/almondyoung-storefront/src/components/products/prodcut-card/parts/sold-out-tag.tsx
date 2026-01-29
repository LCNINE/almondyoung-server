"use client"

// TODO: 재고 연동 후 활성화
export const SoldOutTag = ({ isSoldOut }: { isSoldOut: boolean }) => {
  // 재고 연동 전까지 항상 숨김
  return null

  // return (
  //   isSoldOut && (
  //     <span className="text-xs font-bold text-black md:text-base">품절</span>
  //   )
  // )
}
