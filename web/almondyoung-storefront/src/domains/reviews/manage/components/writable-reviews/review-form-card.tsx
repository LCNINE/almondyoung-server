"use client"

import Image from "next/image"
import { Star, X, Loader2 } from "lucide-react"
import { useState } from "react"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@components/common/ui/card"
import { Button } from "@components/common/ui/button"
import { Separator } from "@components/common/ui/separator"
import { Textarea } from "@components/common/ui/textarea"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import type { WritableReview, ReviewInfo } from "../../types"

interface ReviewFormCardProps {
  review: WritableReview
  onSave: (data: ReviewInfo) => Promise<void>
  onCancel: () => void
}

export const ReviewFormCard = ({
  review,
  onSave,
  onCancel,
}: ReviewFormCardProps) => {
  const [isLoading, setIsLoading] = useState(false)
  const [currentRating, setCurrentRating] = useState(0)
  const [currentText, setCurrentText] = useState("")
  const [hoverRating, setHoverRating] = useState(0)

  const hasValidRating = currentRating > 0
  const canSave = hasValidRating && !isLoading

  const handleSaveClick = async () => {
    if (!canSave) return
    setIsLoading(true)
    try {
      await onSave({ rating: currentRating, text: currentText })
    } catch (error) {
      console.error("리뷰 저장 실패:", error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="border-0 shadow-none">
      <article>
        <CardHeader className="flex flex-row items-start gap-3 p-4">
          <figure className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-[#F0F0F0]">
            <Image
              src={getThumbnailUrl(review.productImage)}
              alt={`${review.productName} 썸네일`}
              width={80}
              height={80}
              className="object-cover"
            />
          </figure>

          <div className="flex-1">
            <CardTitle className="line-clamp-2 text-[15px] leading-snug font-semibold">
              {review.productName}
            </CardTitle>
            {review.variantTitle && (
              <p className="mt-1 text-[13px] text-[#666666]">
                {review.variantTitle}
              </p>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            aria-label="리뷰 작성 취소"
            className="h-8 w-8 shrink-0 text-gray-400"
          >
            <X className="h-5 w-5" />
          </Button>
        </CardHeader>

        <Separator className="mx-4 w-auto" />

        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            <div
              className="flex items-center gap-1.5"
              role="radiogroup"
              aria-label="별점 평가"
            >
              <div
                className="flex gap-0.5"
                onMouseLeave={() => setHoverRating(0)}
              >
                {Array.from({ length: 5 }).map((_, index) => {
                  const ratingValue = index + 1
                  const isFilled = (hoverRating || currentRating) >= ratingValue
                  return (
                    <button
                      key={index}
                      type="button"
                      role="radio"
                      aria-checked={currentRating === ratingValue}
                      aria-label={`${ratingValue}점`}
                      onClick={() => setCurrentRating(ratingValue)}
                      onMouseEnter={() => setHoverRating(ratingValue)}
                      className="cursor-pointer border-none bg-transparent p-0"
                    >
                      <Star
                        className={`h-6 w-6 transition-colors ${
                          isFilled
                            ? "fill-[#FF9500] text-[#FF9500]"
                            : "text-gray-300"
                        }`}
                      />
                    </button>
                  )
                })}
              </div>
              {currentRating > 0 && (
                <span className="text-lg font-bold text-gray-900">
                  {currentRating}
                </span>
              )}
            </div>

            <Textarea
              value={currentText}
              onChange={(e) => setCurrentText(e.target.value)}
              placeholder="리뷰 내용을 입력해주세요."
              className="min-h-[120px]"
            />

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onCancel} disabled={isLoading}>
                취소
              </Button>
              <Button
                onClick={handleSaveClick}
                disabled={!canSave}
                className="bg-[#FF9500] hover:bg-[#FF9500]/90"
              >
                {isLoading && (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                )}
                등록
              </Button>
            </div>
          </div>
        </CardContent>
      </article>
    </Card>
  )
}
