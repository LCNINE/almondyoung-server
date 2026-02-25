"use client"

import { SharedPagination } from "@/components/shared/pagination"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { getReviewsByProductId, toggleReviewReaction } from "@/lib/api/ugc"
import { ReviewRatingFilter, ReviewSortOption } from "@/lib/types/common/filter"
import { ReviewDetail } from "@/lib/types/ui/ugc"
import { useCallback, useEffect, useState } from "react"
import { ReviewDetailCard } from "./review-detail-card"
import { ReviewSummary } from "../summary/review-summary"

type Props = {
  productId: string
  totalReviews: number
  averageRating: number
  onTotalChange?: (total: number) => void
  onAverageRatingChange?: (rating: number) => void
}

const ITEMS_PER_PAGE = 10

const SORT_OPTIONS: { label: string; value: ReviewSortOption }[] = [
  { label: "최신순", value: "latest" },
  { label: "오래된순", value: "oldest" },
  { label: "별점 높은순", value: "rating_high" },
  { label: "별점 낮은순", value: "rating_low" },
]

const RATING_FILTERS: { label: string; value: ReviewRatingFilter | "all" }[] = [
  { label: "전체", value: "all" },
  { label: "5점", value: "5" },
  { label: "4점", value: "4" },
  { label: "3점", value: "3" },
  { label: "2점", value: "2" },
  { label: "1점", value: "1" },
]

export function ReviewDetailCardList({
  productId,
  totalReviews,
  averageRating,
  onTotalChange,
  onAverageRatingChange,
}: Props) {
  const [reviews, setReviews] = useState<ReviewDetail[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(totalReviews)
  const [calculatedAverage, setCalculatedAverage] = useState(averageRating)
  const [selectedFilter, setSelectedFilter] = useState<
    ReviewRatingFilter | "all"
  >("all")
  const [sortOption, setSortOption] = useState<ReviewSortOption>("latest")

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  const fetchReviews = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await getReviewsByProductId({
        productId,
        rating: selectedFilter === "all" ? undefined : selectedFilter,
        sort: sortOption,
        page: currentPage,
        limit: ITEMS_PER_PAGE,
      })

      // status가 active인 리뷰만 필터링
      const activeReviews = (result.data ?? []).filter(
        (review) => review.status === "active"
      )
      setReviews(activeReviews)
      setTotal(result.total ?? 0)
      onTotalChange?.(result.total)

      // 별점 평균 계산 (현재 페이지 기준 - 전체 평균은 API 지원 필요)
      if (activeReviews.length > 0) {
        const sum = activeReviews.reduce((acc, r) => acc + r.rating, 0)
        const avg = Math.round((sum / activeReviews.length) * 10) / 10
        setCalculatedAverage(avg)
        onAverageRatingChange?.(avg)
      }
    } catch (error) {
      console.error("리뷰 로드 실패:", error)
      setReviews([])
    } finally {
      setIsLoading(false)
    }
  }, [productId, selectedFilter, sortOption, currentPage])

  useEffect(() => {
    fetchReviews()
  }, [fetchReviews])

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  const handleFilterChange = (filter: ReviewRatingFilter | "all") => {
    setSelectedFilter(filter)
    setCurrentPage(1)
  }

  const handleSortChange = (value: ReviewSortOption) => {
    setSortOption(value)
    setCurrentPage(1)
  }

  const handleLike = useCallback(async (reviewId: string, _liked: boolean) => {
    return await toggleReviewReaction(reviewId, { type: "helpful" })
  }, [])

  return (
    <section className="space-y-6">
      <ReviewSummary
        totalReviews={total}
        averageRating={calculatedAverage}
        summaryTags={[]}
      />

      {/* 정렬 및 필터 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* 정렬 드롭다운 */}
        <Select value={sortOption} onValueChange={handleSortChange}>
          <SelectTrigger className="w-[140px] bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 별점 필터 */}
        <div className="flex flex-wrap gap-2">
          {RATING_FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => handleFilterChange(filter.value)}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                selectedFilter === filter.value
                  ? "bg-black text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* 리뷰 목록 */}
      {isLoading ? (
        <div className="space-y-4 py-6">
          <Skeleton className="h-4 w-40" />
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`review-skeleton-${index}`}
                className="rounded-lg border border-gray-100 p-4"
              >
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : reviews.length === 0 ? (
        <div className="py-12 text-center text-gray-500">
          {selectedFilter === "all"
            ? "아직 작성된 리뷰가 없습니다."
            : "해당 조건의 리뷰가 없습니다."}
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-gray-600">
            총 <span className="font-semibold">{total}</span>개의 리뷰
          </p>

          <ul className="divide-y divide-gray-200">
            {reviews.map((review) => (
              <li key={review.id}>
                <ReviewDetailCard review={review} onLike={handleLike} />
              </li>
            ))}
          </ul>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <SharedPagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          )}
        </div>
      )}
    </section>
  )
}
