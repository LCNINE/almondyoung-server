import Image from "next/image"
import { Star } from "lucide-react"
import { getTranslations } from "next-intl/server"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@components/common/ui/card"
import { Separator } from "@components/common/ui/separator"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { ReviewThumbnailGallery } from "@/components/reviews/ui/review-thumbnail-gallery"
import type { WrittenReview } from "../../types"

interface ReviewCardWrittenProps {
  review: WrittenReview
}

export const ReviewCardWritten = async ({ review }: ReviewCardWrittenProps) => {
  const t = await getTranslations("mypage.reviews")
  const formattedDate = formatDate(review.createdAt, DATE_FORMATS.KO_DOT)
  const hasMedia = review.mediaFileIds.length > 0

  return (
    <Card className="border-0 shadow-none">
      <article>
        <CardHeader className="flex flex-row items-start gap-3 p-4">
          <figure className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-[#F0F0F0]">
            <Image
              src={getThumbnailUrl(review.productImage)}
              alt={t("thumbnailAlt", { name: review.productName })}
              width={80}
              height={80}
              className="object-cover"
            />
          </figure>
          <div className="flex-1">
            <CardTitle className="line-clamp-2 text-[15px] leading-snug font-semibold">
              {review.productName}
            </CardTitle>
            <p className="mt-1 text-[12px] text-gray-400">{formattedDate}</p>
          </div>
        </CardHeader>

        <Separator className="mx-4 w-auto" />

        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, index) => {
                  const isFilled = index < review.rating
                  return (
                    <Star
                      key={index}
                      className={`h-5 w-5 ${
                        isFilled
                          ? "fill-[#FF9500] text-[#FF9500]"
                          : "text-gray-300"
                      }`}
                    />
                  )
                })}
              </div>
              <span className="text-base font-bold text-gray-900">
                {review.rating}
              </span>
            </div>
          </div>

          {review.content && (
            <p className="mt-3 text-[14px] leading-relaxed whitespace-pre-wrap text-[#333333]">
              {review.content}
            </p>
          )}

          {hasMedia && (
            <div className="mt-3">
              <ReviewThumbnailGallery thumbnails={review.mediaFileIds} />
            </div>
          )}
        </CardContent>
      </article>
    </Card>
  )
}
