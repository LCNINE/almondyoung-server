import Image from "next/image" // next/image 사용 권장 (일반 img도 가능)
import { ChevronRight, CreditCard } from "lucide-react" // 1. 아이콘 임포트
export default function PayLaterBanner() {
  return (
    <section className="relative flex w-full max-w-md items-center justify-between overflow-hidden bg-[#ff9a1a] px-6 py-3 shadow-sm">
      {/* 1. Left Content (Text) */}
      {/* z-10: 장식 텍스트보다 위에 오도록 설정 */}
      <div className="z-10 flex flex-col gap-1">
        <h2 className="text-[21px] leading-tight font-bold text-white">
          상품먼저 받고
          <br />
          결제는 나중에 하세요!
        </h2>
      </div>

      {/* 2. Right Content (Image) */}
      {/* z-10: 장식 텍스트보다 위에 오도록 설정 */}
      <div className="z-10 flex items-center gap-3">
        <img
          src="caecb47a-aff1-441d-b904-7f5b4a8fc1d7-1.png"
          alt="상품 이미지"
          className="h-[81px] w-[81px] rounded-[10px] object-cover"
        />

        {/* [추가] 화살표 아이콘 */}
        <ChevronRight
          className="h-5 w-5 text-white opacity-80"
          strokeWidth={3} // 두께를 조금 굵게 하여 가독성 확보
        />
      </div>

      {/* 3. Decorative Element (Background Icon) */}
      {/* [수정] 텍스트 대신 lucide 아이콘 사용 */}
      <CreditCard
        className="pointer-events-none absolute right-[24%] bottom-[-5px] h-12 w-12 text-[#1d1e1d] opacity-10"
        aria-hidden="true"
        strokeWidth={2.5} // bold 텍스트 느낌을 살리기 위해 두께 조절
      />
    </section>
  )
}
