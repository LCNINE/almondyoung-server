import { ReviewSummaryStarRating } from "./review-summary-star-rating"

export type ReviewSummaryProps = {
  totalReviews: number
  averageRating: number
  summaryTags: string[]
}

/**
 * @description 리뷰 통계 및 키워드 요약 (반응형)
 * 모바일: 작은 크기
 * 데스크탑: 큰 크기
 */
export function ReviewSummary({
  totalReviews,
  averageRating,
  summaryTags,
}: ReviewSummaryProps) {
  return (
    <section
      className="space-y-4 md:space-y-[34px]"
      aria-labelledby="product-review-heading"
    >
      {/* 1. 평점 표시 */}
      <div className="flex items-center gap-2 md:gap-3.5">
        <ReviewSummaryStarRating rating={averageRating} />
        <span className="text-2xl font-bold text-black">{averageRating}</span>
      </div>

      {/* 2. 리뷰 요약 제목 */}
      <div className="flex items-end gap-2 md:gap-[11px]">
        <h3 className="text-xs font-bold text-black md:text-lg">리뷰요약</h3>
        <p className="text-xs font-medium text-gray-500 md:text-base md:text-[#767676]">
          구매하신 분들의 리뷰를 분석했어요!
        </p>
      </div>

      {/* 3. 리뷰 키워드 태그 */}
      <ul className="flex flex-wrap gap-1.5 md:gap-2.5">
        {summaryTags.map((tag) => (
          <li
            key={tag}
            className="rounded-full bg-gray-100 px-1.5 py-1 text-[11px] text-black md:rounded-[1000px] md:bg-[#ebedf0] md:px-2.5 md:py-1.5 md:text-base"
          >
            {tag}
          </li>
        ))}
      </ul>
    </section>
  )
}
