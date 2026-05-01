import { RefObject, useEffect, useState } from "react"

export function useIntersection(
  ref: RefObject<HTMLElement | null>,
  rootMargin = "0px"
): boolean {
  const [isIntersecting, setIsIntersecting] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting)
      },
      { rootMargin }
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [ref, rootMargin])

  return isIntersecting
}
