"use client"

import { useTranslations } from "next-intl"
import { ChevronRight } from "lucide-react"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import { StarRating } from "../ui/star-rating"
import { getAuthorName } from "../utils"
import { formatDate, DATE_FORMATS } from "@/lib/utils/format-date"
import type { ReviewDetail, RatingSummary } from "@/lib/types/ui/ugc"

interface Props {
  reviews: ReviewDetail[]
  ratingSummary: RatingSummary | null
}

export function ReviewPreviewCarousel({ reviews, ratingSummary }: Props) {
  const t = useTranslations("productDetail.review")

  if (!reviews.length) return null

  const highRatingPercent =
    ratingSummary && ratingSummary.totalCount > 0
      ? Math.round(
          (((ratingSummary.ratingDistribution[4] ?? 0) +
            (ratingSummary.ratingDistribution[5] ?? 0)) /
            ratingSummary.totalCount) *
            100
        )
      : null

  const handleViewAll = () => {
    window.dispatchEvent(new CustomEvent("navigate-tab", { detail: "review" }))
  }

  return (
    <section className="mb-4 py-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-sm font-bold text-foreground">
            {t("previewTitle")}
          </h2>
          {highRatingPercent !== null && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("previewHighRating", { percent: highRatingPercent })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleViewAll}
          className="flex items-center gap-0.5 text-xs text-primary/70 hover:text-primary"
        >
          {t("previewViewAll")}
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <Carousel opts={{ align: "start", dragFree: true }} className="w-full">
        <CarouselContent className="-ml-2.5">
          {reviews.map((review) => (
            <CarouselItem
              key={review.id}
              className="pl-2.5 basis-[76%] sm:basis-[46%] lg:basis-[31%]"
            >
              <ReviewPreviewCard review={review} />
            </CarouselItem>
          ))}

          <CarouselItem className="pl-2.5 basis-[50%] sm:basis-[28%] lg:basis-[18%]">
            <button
              type="button"
              onClick={handleViewAll}
              className="flex h-full min-h-[96px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-primary/20 bg-primary/5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <ChevronRight className="h-5 w-5 text-primary/60" />
              {t("previewViewAll")}
            </button>
          </CarouselItem>
        </CarouselContent>
      </Carousel>
    </section>
  )
}

function ReviewPreviewCard({ review }: { review: ReviewDetail }) {
  const authorName = getAuthorName(review.legacy_author_name ?? null, review.userId)

  return (
    <article className="flex h-full min-h-[96px] flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm">
      <StarRating rating={review.rating} size="w-2.5 h-2.5" />
      <p className="line-clamp-3 flex-1 text-xs leading-relaxed text-foreground">
        {review.content}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {authorName} · {formatDate(review.createdAt, DATE_FORMATS.KO_DOT)}
      </p>
    </article>
  )
}
