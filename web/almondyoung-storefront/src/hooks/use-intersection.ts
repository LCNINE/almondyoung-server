import { RefObject, useEffect, useState } from "react"

export function useIntersection(
  ref: RefObject<HTMLElement | null>,
  rootMargin = "0px",
  /** 1 이면 요소가 전부 보일 때만 true */
  threshold = 0
): boolean {
  const [isIntersecting, setIsIntersecting] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1]

        setIsIntersecting(
          entry.isIntersecting && entry.intersectionRatio >= threshold
        )
      },
      { rootMargin, threshold: threshold > 0 ? [0, threshold] : 0 }
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [ref, rootMargin, threshold])

  return isIntersecting
}
