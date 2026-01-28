import { Star } from "lucide-react"

type Props = {
  rating: number
  reviewCount: number
}

/**
 * @description 상품 평점 표시 컴포넌트
 * rating 값에 따라 부분 별점을 표시합니다.
 * 예: rating=4.3 → 4개 꽉 찬 별 + 1개 30% 채워진 별
 */
export function ProductRatingDisplay({ rating, reviewCount }: Props) {
  const clampedRating = Math.max(0, Math.min(5, rating))
  const fullStars = Math.floor(clampedRating)
  const partialFill = (clampedRating - fullStars) * 100
  const emptyStars = 5 - fullStars - (partialFill > 0 ? 1 : 0)

  return (
    <div className="mb-4 flex items-center gap-2">
      <div className="flex" role="img" aria-label={`평점 ${rating}점`}>
        {/* 꽉 찬 별 */}
        {Array.from({ length: fullStars }).map((_, i) => (
          <Star
            key={`full-${i}`}
            className="h-5 w-5 fill-yellow-400 text-yellow-400"
            aria-hidden="true"
          />
        ))}

        {/* 부분 별 */}
        {partialFill > 0 && (
          <div className="relative h-5 w-5" key="partial">
            <Star
              className="absolute h-5 w-5 text-gray-300"
              aria-hidden="true"
            />
            <div
              className="absolute overflow-hidden"
              style={{ width: `${partialFill}%` }}
            >
              <Star
                className="h-5 w-5 fill-yellow-400 text-yellow-400"
                aria-hidden="true"
              />
            </div>
          </div>
        )}

        {/* 빈 별 */}
        {Array.from({ length: emptyStars }).map((_, i) => (
          <Star
            key={`empty-${i}`}
            className="h-5 w-5 text-gray-300"
            aria-hidden="true"
          />
        ))}
      </div>
      <span className="text-sm">{reviewCount}개의 리뷰</span>
    </div>
  )
}
