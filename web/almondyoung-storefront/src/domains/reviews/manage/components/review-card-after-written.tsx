"use client"

import Image from "next/image"
import { Star, X, Undo2, Check, Loader2 } from "lucide-react"
import { useState } from "react"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  CardContent,
} from "@components/common/ui/card"
import { Button } from "@components/common/ui/button"
import { Separator } from "@components/common/ui/separator"
import { Textarea } from "@components/common/ui/textarea"
import type { ProductInfo, ReviewInfo } from "../types"

interface ReviewCardProps {
  product: ProductInfo
  review: ReviewInfo
  onSave: (data: ReviewInfo) => Promise<void>
  onDelete: () => void
}

/**
 * 작성된 리뷰 카드 컴포넌트
 * 읽기/수정 모드를 내부에서 관리하여 응집도를 높임
 */
export const ReviewCardAfterWritten = ({
  product,
  review,
  onSave,
  onDelete,
}: ReviewCardProps) => {
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [currentRating, setCurrentRating] = useState(review.rating)
  const [currentText, setCurrentText] = useState(review.text)
  const [hoverRating, setHoverRating] = useState(0)

  const hasValidRating = currentRating > 0
  const canSave = hasValidRating && !isLoading

  const handleSaveClick = async () => {
    if (!canSave) return

    setIsLoading(true)
    try {
      await onSave({ rating: currentRating, text: currentText })
      setIsEditing(false)
    } catch (error) {
      console.error("리뷰 저장 실패:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancelClick = () => {
    setCurrentRating(review.rating)
    setCurrentText(review.text)
    setIsEditing(false)
  }

  return (
    <Card>
      <article>
        {/* 상품 정보 섹션 */}
        <CardHeader className="flex flex-row items-start gap-3 p-4">
          <figure className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-md border">
            <Image
              src={product.imageUrl}
              alt={`${product.title} 썸네일`}
              width={80}
              height={80}
              className="object-cover"
            />
          </figure>

          <div className="flex-1">
            <CardDescription className="mb-0.5 text-xs">
              {product.storeName}
            </CardDescription>
            <CardTitle className="line-clamp-2 text-base leading-snug font-semibold">
              {product.title}
            </CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              {product.options}
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label="리뷰 삭제"
            className="h-8 w-8 flex-shrink-0 text-gray-400"
          >
            <X className="h-5 w-5" />
          </Button>
        </CardHeader>

        <Separator className="mx-4 w-auto" />

        {/* 리뷰 내용 섹션 */}
        <CardContent className="p-4">
          {isEditing ? (
            // 수정 모드
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                {/* 수정 가능한 별점 */}
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
                      const isFilled =
                        (hoverRating || currentRating) >= ratingValue
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
                            className={`h-5 w-5 transition-colors ${
                              isFilled
                                ? "fill-red-500 text-red-500"
                                : "text-gray-300"
                            }`}
                          />
                        </button>
                      )
                    })}
                  </div>
                  <span className="text-lg font-bold text-gray-900">
                    {currentRating}
                  </span>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancelClick}
                    disabled={isLoading}
                  >
                    <Undo2 className="mr-1.5 h-4 w-4" />
                    취소
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveClick}
                    disabled={!canSave}
                  >
                    {isLoading ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-1.5 h-4 w-4" />
                    )}
                    저장
                  </Button>
                </div>
              </div>
              <Textarea
                value={currentText}
                onChange={(e) => setCurrentText(e.target.value)}
                placeholder="리뷰 내용을 입력해주세요."
                className="min-h-[120px]"
              />
            </div>
          ) : (
            // 읽기 모드
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                {/* 읽기 전용 별점 */}
                <div
                  className="flex items-center gap-1.5"
                  aria-label={`5점 만점에 ${review.rating}점`}
                >
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star
                        key={index}
                        className={`h-5 w-5 ${
                          index < review.rating
                            ? "fill-red-500 text-red-500"
                            : "text-gray-300"
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-lg font-bold text-gray-900">
                    {review.rating}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                >
                  수정
                </Button>
              </div>
              <p className="text-base leading-relaxed text-gray-800">
                {review.text}
              </p>
            </div>
          )}
        </CardContent>
      </article>
    </Card>
  )
}
