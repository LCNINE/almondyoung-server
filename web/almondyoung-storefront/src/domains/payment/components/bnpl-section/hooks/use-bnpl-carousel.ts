import { useState, useCallback } from "react"

/**
 * BNPL 캐러셀 훅
 * 여러 BNPL 프로필을 캐러셀 형태로 보여주기 위한 상태 관리
 */
export function useBnplCarousel(totalItems: number) {
  const [currentIndex, setCurrentIndex] = useState(0)

  // 이전 항목으로 이동
  const handlePrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? totalItems - 1 : prev - 1))
  }, [totalItems])

  // 다음 항목으로 이동
  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev === totalItems - 1 ? 0 : prev + 1))
  }, [totalItems])

  // 특정 인덱스로 이동
  const goToIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < totalItems) {
        setCurrentIndex(index)
      }
    },
    [totalItems]
  )

  return {
    currentIndex,
    handlePrevious,
    handleNext,
    goToIndex,
    hasMultipleItems: totalItems > 1,
  }
}
