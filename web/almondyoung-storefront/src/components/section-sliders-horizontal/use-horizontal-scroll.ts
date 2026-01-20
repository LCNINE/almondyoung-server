import { useRef } from "react"

/**
 * 가로 스크롤 기능을 제공하는 커스텀 훅
 * @param itemCount - 전체 아이템 개수
 * @returns scrollRef, handleScrollPrev, handleScrollNext
 */
export function useHorizontalScroll(itemCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleScrollPrev = () => {
    if (scrollRef.current) {
      const cardWidth = scrollRef.current.scrollWidth / itemCount
      const visibleCards = Math.floor(scrollRef.current.clientWidth / cardWidth)
      scrollRef.current.scrollBy({
        left: -(cardWidth * visibleCards),
        behavior: "smooth",
      })
    }
  }

  const handleScrollNext = () => {
    if (scrollRef.current) {
      const cardWidth = scrollRef.current.scrollWidth / itemCount
      const visibleCards = Math.floor(scrollRef.current.clientWidth / cardWidth)
      scrollRef.current.scrollBy({
        left: cardWidth * visibleCards,
        behavior: "smooth",
      })
    }
  }

  return {
    scrollRef,
    handleScrollPrev,
    handleScrollNext,
  }
}
