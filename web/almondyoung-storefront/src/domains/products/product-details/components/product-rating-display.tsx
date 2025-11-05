import { Star } from "lucide-react"

type Props = {
  rating: number
  reviewCount: number
}

/**
 * @description 상품 평점 표시 컴포넌트
 */
export function ProductRatingDisplay({ rating, reviewCount }: Props) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <div className="flex" role="img" aria-label={`평점 ${rating}점`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className="h-5 w-5 fill-yellow-400 text-yellow-400"
            aria-hidden="true"
          />
        ))}
      </div>
      <span className="text-sm">{reviewCount}개의 리뷰</span>
    </div>
  )
}
