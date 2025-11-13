import { StarRating } from "../ui/star-rating"
import { ReviewAuthor } from "../ui/review-author"
import { ReviewThumbnailGallery } from "../ui/review-thumbnail-gallery"
import { ReviewHelpfulButton } from "../ui/review-helpful-button"

export type ReviewDetail = {
  id: string
  author: string
  rating: number
  date: string
  tags: string[]
  text: string
  productOption?: string
  thumbnails?: {
    src: string
    alt: string
  }[]
  likeCount: number
}

type Props = {
  review: ReviewDetail
  onLike?: (reviewId: string, liked: boolean) => void
}

/**
 * @description 리뷰 상세 페이지용 카드
 * <article>을 사용하고, <header>, <section>, <footer>로 구조를 명확히 함.
 */
export function ReviewDetailCard({ review, onLike }: Props) {
  const displayDate = new Date(review.date)
    .toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/ /g, "")

  return (
    <article className="w-full space-y-3 border-t border-gray-200  py-8">
      {/* 1. 헤더: 작성자, 별점, 날짜 정보 */}
      <header className="space-y-2">
        {/* 공통 컴포넌트 재사용 */}
        <ReviewAuthor author={review.author} tags={review.tags} />

        <div className="flex items-center gap-2.5">
          {/* 공통 컴포넌트 재사용 */}
          <StarRating rating={review.rating} />
          <time
            dateTime={review.date}
            className="text-xs font-medium text-gray-500"
          >
            {displayDate}
          </time>
        </div>
      </header>

      {/* 2. 본문: 상품 옵션, 썸네일, 텍스트 */}
      <section className="space-y-3">
        {review.productOption && (
          <p className="text-xs text-black">{review.productOption}</p>
        )}

        {/* 신규 컴포넌트: 가로 스크롤 갤러리 */}
        {review.thumbnails && (
          <ReviewThumbnailGallery thumbnails={review.thumbnails} />
        )}

        <p className="text-xs text-black">
          {review.text.split("\n").map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </p>
      </section>

      {/* 3. 푸터: 도움돼요 버튼, 좋아요 카운트 */}
      <ReviewHelpfulButton
        initialLikeCount={review.likeCount}
        onLike={(liked) => onLike?.(review.id, liked)}
      />
    </article>
  )
}
