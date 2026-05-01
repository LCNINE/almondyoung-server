import { useState } from "react"

/**
 * 별점 상태 관리 커스텀 훅
 * - rating: 클릭으로 선택된 평점만 관리 (API 요청 시 사용)
 * - hover는 UI 피드백일 뿐이므로 상태로 관리하지 않음
 */
export function useRating(initialRating = 0) {
  const [rating, setRating] = useState(initialRating)

  const handleRatingChange = (newRating: number) => {
    setRating(newRating)
  }

  return {
    rating,
    handleRatingChange,
  }
}
