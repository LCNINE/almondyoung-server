import { Info } from "lucide-react" // lucide-react에서 Info 아이콘을 가져옵니다.

// 원본 코드에 상수가 정의되어 있지 않아 임시 값을 설정합니다.
// 실제 프로젝트의 값을 사용해야 합니다.
const MAX_REVIEW_BENEFIT_POINTS = 1000

export const ReviewBenefitBanner = () => {
  return (
    <div
      className="mb-4 flex items-center rounded-md bg-[#FF9500]/10 p-3"
      // [수정] 녹색 배경(rgba(0,168,107,0.1))을
      //       주황색(#FF9500)의 10% 불투명도(bg-[#FF9500]/10)로 변경
    >
      <Info
        className="mr-2 h-5 w-5 flex-shrink-0 text-[#FF9500]"
        // [수정] 녹색 아이콘(text-[#00A86B])을 주황색(text-[#FF9500])으로 변경
      />
      <p className="text-[14px] text-[#333333]">
        리뷰 작성하고{" "}
        <span className="font-bold text-[#FF9500]">
          {/* [수정] 녹색 텍스트(text-[#00A86B])를 주황색(text-[#FF9500])으로 변경 */}
          최대 {MAX_REVIEW_BENEFIT_POINTS.toLocaleString()}원
        </span>
        의 혜택을 받아가세요.
      </p>
    </div>
  )
}
