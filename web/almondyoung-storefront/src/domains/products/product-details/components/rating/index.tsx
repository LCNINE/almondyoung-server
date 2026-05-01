"use client"

import { Star } from "lucide-react"

type Props = {
  rating: number
  reviewCount: number
}

/**
 * @description 상품 평점 컴팩트 표시 컴포넌트
 * ★★★★☆ 4.3 리뷰 128건 > 형태로 한 줄 표시
 */
export function Rating({ rating, reviewCount }: Props) {
  const clampedRating = Math.max(0, Math.min(5, rating))
  const fullStars = Math.floor(clampedRating)
  const partialFill = (clampedRating - fullStars) * 100
  const emptyStars = 5 - fullStars - (partialFill > 0 ? 1 : 0)

  if (reviewCount === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-1.5 py-1">
      {/* 별점 */}
      <div className="flex" role="img" aria-label={`평점 ${rating}점`}>
        {Array.from({ length: fullStars }).map((_, i) => (
          <Star
            key={`full-${i}`}
            className="fill-primary text-primary h-4 w-4"
            aria-hidden="true"
          />
        ))}

        {partialFill > 0 && (
          <div className="relative h-4 w-4" key="partial">
            <Star
              className="fill-gray-20 text-gray-20 absolute h-4 w-4"
              aria-hidden="true"
            />
            <div
              className="absolute overflow-hidden"
              style={{ width: `${partialFill}%` }}
            >
              <Star
                className="fill-primary text-primary h-4 w-4"
                aria-hidden="true"
              />
            </div>
          </div>
        )}

        {Array.from({ length: emptyStars }).map((_, i) => (
          <Star
            key={`empty-${i}`}
            className="fill-gray-20 text-gray-20 h-4 w-4"
            aria-hidden="true"
          />
        ))}
      </div>

      {/* 숫자 평점 */}
      <span className="text-sm font-bold">{clampedRating.toFixed(1)}</span>

      {/* 구분선 */}
      <span className="text-gray-20">|</span>

      {/* 리뷰 수 (클릭 시 리뷰 섹션 이동) */}
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground cursor-pointer text-sm transition-colors"
        onClick={() => {
          window.dispatchEvent(
            new CustomEvent("navigate-tab", { detail: "review" })
          )
        }}
      >
        리뷰 {reviewCount.toLocaleString()}건<span className="ml-0.5">+</span>
      </button>
    </div>
  )
}
