"use client"

export const SoldOutTag = ({ isSoldOut }: { isSoldOut: boolean }) => {
  return (
    isSoldOut && (
      <span className="text-xs leading-[15px] font-bold text-black">품절</span>
    )
  )
}
