import { Info } from "lucide-react"

const MAX_REVIEW_BENEFIT_POINTS = 1000

export const ReviewBenefitBanner = () => {
  return (
    <div className="mb-4 flex items-center rounded-md bg-[#FF9500]/10 p-3">
      <Info className="mr-2 h-5 w-5 shrink-0 text-[#FF9500]" />
      <p className="text-[14px] text-[#333333]">
        리뷰 작성하고{" "}
        <span className="font-bold text-[#FF9500]">
          최대 {MAX_REVIEW_BENEFIT_POINTS.toLocaleString()}원
        </span>
        의 혜택을 받아가세요.
      </p>
    </div>
  )
}
