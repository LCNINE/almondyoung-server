import type { ReviewDetail } from "@/lib/types/ui/ugc"
import { StarRating } from "../ui/star-rating"
import { ReviewAuthor } from "../ui/review-author"
import { ReviewThumbnailGallery } from "../ui/review-thumbnail-gallery"
import { ReviewHelpfulButton } from "../ui/review-helpful-button"
import { ExpandableReviewContent } from "../ui"
import { getAuthorName } from "../utils"

type Props = {
  countryCode: string
  review: ReviewDetail
}

/**
 * @description 리뷰 상세 페이지용 카드
 */
export function ReviewDetailCard({ countryCode, review }: Props) {
  const displayDate = new Date(review.createdAt)
    .toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/ /g, "")

  // 작성자명 처리
  const authorName = getAuthorName(
    review.legacy_author_name || null,
    review.userId
  )

  return (
    <article className="w-full space-y-3 border-t border-gray-200 py-8">
      {/*  작성자, 별점, 날짜 정보 */}
      <header className="space-y-2">
        <ReviewAuthor author={authorName} tags={[]} />

        <div className="flex items-center gap-2.5">
          <StarRating rating={review.rating} />
          <time
            dateTime={review.createdAt}
            className="text-xs font-medium text-gray-500"
          >
            {displayDate}
          </time>
        </div>
      </header>

      {/*  본문: 썸네일, 텍스트 */}
      <section className="space-y-3">
        {/* 가로 스크롤 갤러리 */}
        {review.mediaFileIds.length > 0 && (
          <ReviewThumbnailGallery thumbnails={review.mediaFileIds} />
        )}

        <ExpandableReviewContent content={review.content} />
      </section>

      {/* 푸터: 도움돼요 버튼 */}
      <ReviewHelpfulButton
        countryCode={countryCode}
        reviewId={review.id}
        initialLikeCount={review.helpfulCount}
      />
    </article>
  )
}
