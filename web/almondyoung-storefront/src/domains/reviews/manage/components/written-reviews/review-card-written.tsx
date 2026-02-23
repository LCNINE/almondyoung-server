import Image from "next/image"
import { Star } from "lucide-react"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@components/common/ui/card"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import type { WrittenReview } from "../../types"

interface ReviewCardWrittenProps {
  review: WrittenReview
}

export const ReviewCardWritten = ({ review }: ReviewCardWrittenProps) => {
  const { productInfo, reviewData } = review

  return (
    <Card className="border-0 shadow-none">
      <article>
        <CardHeader className="flex flex-row items-start gap-3 p-4">
          <figure className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-[#F0F0F0]">
            <Image
              src={getThumbnailUrl(productInfo.imageUrl)}
              alt={`${productInfo.title} 썸네일`}
              width={80}
              height={80}
              className="object-cover"
            />
          </figure>
          <div className="flex-1">
            <CardTitle className="line-clamp-2 text-[15px] leading-snug font-semibold">
              {productInfo.title}
            </CardTitle>
            {productInfo.options && (
              <p className="mt-1 text-[13px] text-[#666666]">
                {productInfo.options}
              </p>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-4 pt-0">
          <div className="flex items-center gap-1.5">
            <div className="flex gap-0.5">
              {Array.from({ length: 5 }).map((_, index) => {
                const isFilled = index < reviewData.rating
                return (
                  <Star
                    key={index}
                    className={`h-6 w-6 ${
                      isFilled
                        ? "fill-[#FF9500] text-[#FF9500]"
                        : "text-gray-300"
                    }`}
                  />
                )
              })}
            </div>
            <span className="text-lg font-bold text-gray-900">
              {reviewData.rating}
            </span>
          </div>
          {reviewData.text && (
            <p className="mt-3 text-[14px] text-[#333333] whitespace-pre-wrap">
              {reviewData.text}
            </p>
          )}
        </CardContent>
      </article>
    </Card>
  )
}
