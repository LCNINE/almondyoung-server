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
  const isLoadingRef = useRef(isLoading)
  const hasMoreRef = useRef(hasMore)

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  }, [onLoadMore])

  useEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading])

  useEffect(() => {
    hasMoreRef.current = hasMore
  }, [hasMore])

  useEffect(() => {
    const target = sentinelRef.current
    if (!target) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        if (isLoadingRef.current || !hasMoreRef.current) return
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
  }, [rootMargin, threshold])

  return { sentinelRef }
}
