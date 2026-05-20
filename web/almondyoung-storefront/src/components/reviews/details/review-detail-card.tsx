import type { ReviewDetail } from "@/lib/types/ui/ugc"
import { formatDate, DATE_FORMATS } from "@/lib/utils/format-date"
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

export function ReviewDetailCard({ countryCode, review }: Props) {
  const authorName = getAuthorName(
    review.legacy_author_name || null,
    review.userId
  )

  return (
    <article className="border-border w-full space-y-3 border-t py-6">
      <header className="space-y-1.5">
        <ReviewAuthor author={authorName} tags={[]} />

        <div className="flex items-center gap-2.5">
          <StarRating rating={review.rating} />
          <time
            dateTime={review.createdAt}
            className="text-muted-foreground text-xs"
          >
            {formatDate(review.createdAt, DATE_FORMATS.KO_DOT)}
          </time>
        </div>
      </header>

      <section className="space-y-3">
        {review.mediaFileIds.length > 0 && (
          <ReviewThumbnailGallery thumbnails={review.mediaFileIds} />
        )}
        <ExpandableReviewContent content={review.content} />
      </section>

      <ReviewHelpfulButton
        countryCode={countryCode}
        reviewId={review.id}
        initialLikeCount={review.helpfulCount}
      />
    </article>
  )
}
