"use client"

import { useEffect, useRef } from "react"

interface UseInfiniteScrollOptions {
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => void | Promise<void>
  rootMargin?: string
  threshold?: number
}

export const useInfiniteScroll = ({
  hasMore,
  isLoading,
  onLoadMore,
  rootMargin = "200px 0px",
  threshold = 0,
}: UseInfiniteScrollOptions) => {
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const onLoadMoreRef = useRef(onLoadMore)

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  }, [onLoadMore])

  useEffect(() => {
    const target = sentinelRef.current
    if (!target || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting || isLoading) return
        onLoadMoreRef.current()
      },
      {
        rootMargin,
        threshold,
      }
    )

    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [hasMore, isLoading, rootMargin, threshold])

  return { sentinelRef }
}
