import { StarRating } from "../ui/star-rating"
import { ReviewAuthor } from "../ui/review-author"
import { ReviewText } from "../ui/review-text"

export type Review = {
  id: string
  author: string
  rating: number
  date: string // JSON 직렬화를 위해 string 사용 (new Date(date)로 변환)
  tags: string[]
  text: string
  thumbnail?: {
    src: string
    alt: string
    count?: number
  }
}

type Props = {
  review: Review
  onMoreClick?: (reviewId: string) => void
}

/**
 * @description 개별 리뷰 카드 (요약 버전)
 * 하나의 독립된 콘텐츠(리뷰)이므로 <article> 시맨틱 태그 사용
 */
export function ReviewSummaryCard({ review, onMoreClick }: Props) {
  // 날짜 포맷팅 (컴포넌트 내에서 처리)
  const displayDate = new Date(review.date)
    .toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/ /g, "") // 2025.05.09.

  return (
    <article className="flex flex-col gap-2.5 py-4">
      {/* 리뷰의 메타데이터(작성자, 별점, 날짜)를 <header>로 그룹화 */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StarRating rating={review.rating} />
            <span className="text-xs font-medium text-gray-600">
              {review.author}
            </span>
          </div>
          {/* 날짜/시간 정보는 <time> 태그 사용 */}
          <time
            dateTime={review.date}
            className="text-xs font-medium text-gray-500"
          >
            {displayDate}
          </time>
        </div>

        {/* 공통 컴포넌트: 사용자 태그 */}
        <ReviewAuthor author="" tags={review.tags} />
      </header>

      {/* 리뷰 본문 */}
      <div className="flex items-start gap-3">
        {review.thumbnail && (
          //
          // <img> 대신 <figure>를 사용하여 이미지와 캡션(오버레이)을 그룹화
          <figure className="relative h-16 w-16 flex-shrink-0 rounded-md">
            <img
              src={review.thumbnail.src}
              alt={review.thumbnail.alt}
              className="h-full w-full rounded-md object-cover"
              loading="lazy"
            />
            {review.thumbnail.count && (
              <figcaption className="absolute right-0 bottom-0 rounded-br-md bg-black/50 px-1 py-0.5 text-[8px] font-medium text-white">
                {review.thumbnail.count}
              </figcaption>
            )}
          </figure>
        )}

        {/* 공통 컴포넌트: 리뷰 텍스트 (3줄 제한) */}
        <ReviewText
          text={review.text}
          lineClamp={3}
          showMoreButton={true}
          onMoreClick={() => onMoreClick?.(review.id)}
        />
      </div>
    </article>
  )
}
