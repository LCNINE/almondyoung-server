"use client"

import { useEffect, useState, useCallback } from "react"
import { getReviewsByProductId } from "@/lib/api/ugc"
import type { ReviewResponseDto, ReviewRatingFilter } from "@/lib/types/dto/ugc"
import { ReviewSummary } from "./summary/review-summary"
import { ReviewDetailCard, type ReviewDetail } from "./details/review-detail-card"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationEllipsis,
} from "@components/common/ui/pagination"
import { ChevronLeft, ChevronRight } from "lucide-react"

type Props = {
  productId: string
  totalReviews: number
  averageRating: number
}

const ITEMS_PER_PAGE = 10

const RATING_FILTERS: { label: string; value: ReviewRatingFilter | "all" }[] = [
  { label: "전체", value: "all" },
  { label: "긍정 (4-5점)", value: "positive" },
  { label: "부정 (1-2점)", value: "negative" },
  { label: "5점", value: "5" },
  { label: "4점", value: "4" },
  { label: "3점", value: "3" },
  { label: "2점", value: "2" },
  { label: "1점", value: "1" },
]

function mapToReviewDetail(dto: ReviewResponseDto): ReviewDetail {
  return {
    id: dto.id,
    author: "구매자",
    rating: dto.rating,
    date: dto.createdAt,
    tags: [],
    text: dto.content,
    thumbnails: dto.mediaFileIds.map((fileId, index) => ({
      src: `${process.env.NEXT_PUBLIC_FILE_SERVICE_URL || ""}/files/${fileId}`,
      alt: `리뷰 이미지 ${index + 1}`,
    })),
    likeCount: 0,
  }
}

export function ProductReviewSection({
  productId,
  totalReviews,
  averageRating,
}: Props) {
  const [reviews, setReviews] = useState<ReviewDetail[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(totalReviews)
  const [selectedFilter, setSelectedFilter] = useState<
    ReviewRatingFilter | "all"
  >("all")

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  const fetchReviews = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await getReviewsByProductId({
        productId,
        rating: selectedFilter === "all" ? undefined : selectedFilter,
        page: currentPage,
        limit: ITEMS_PER_PAGE,
      })
      setReviews(result.data.map(mapToReviewDetail))
      setTotal(result.total)
    } catch (error) {
      console.error("리뷰 로드 실패:", error)
      setReviews([])
    } finally {
      setIsLoading(false)
    }
  }, [productId, selectedFilter, currentPage])

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

  const getPageNumbers = () => {
    const pages: (number | "ellipsis")[] = []
    const maxVisible = 5
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i)
        pages.push("ellipsis")
        pages.push(totalPages)
      } else if (currentPage >= totalPages - 2) {
        pages.push(1)
        pages.push("ellipsis")
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i)
      } else {
        pages.push(1)
        pages.push("ellipsis")
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i)
        pages.push("ellipsis")
        pages.push(totalPages)
      }
    }
    return pages
  }

  return (
    <section className="space-y-6">
      <ReviewSummary
        totalReviews={totalReviews}
        averageRating={averageRating}
        summaryTags={[]}
      />

      {/* 필터 */}
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

      {/* 리뷰 목록 */}
      {isLoading ? (
        <div className="py-12 text-center text-gray-500">리뷰 로딩 중...</div>
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
                <ReviewDetailCard review={review} />
              </li>
            ))}
          </ul>

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <Pagination>
              <PaginationContent className="flex-wrap justify-center">
                <PaginationItem>
                  <PaginationLink
                    aria-label="Previous page"
                    onClick={() =>
                      currentPage > 1 && handlePageChange(currentPage - 1)
                    }
                    className={
                      currentPage === 1
                        ? "pointer-events-none opacity-50"
                        : "cursor-pointer"
                    }
                  >
                    <ChevronLeft className="h-4 w-4" />
                    <span className="ml-1 hidden sm:inline">이전</span>
                  </PaginationLink>
                </PaginationItem>

                {getPageNumbers().map((page, index) =>
                  page === "ellipsis" ? (
                    <PaginationItem key={`ellipsis-${index}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  ) : (
                    <PaginationItem key={page}>
                      <PaginationLink
                        onClick={() => handlePageChange(page as number)}
                        isActive={currentPage === page}
                        className="cursor-pointer"
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  )
                )}

                <PaginationItem>
                  <PaginationLink
                    aria-label="Next page"
                    onClick={() =>
                      currentPage < totalPages &&
                      handlePageChange(currentPage + 1)
                    }
                    className={
                      currentPage === totalPages
                        ? "pointer-events-none opacity-50"
                        : "cursor-pointer"
                    }
                  >
                    <span className="mr-1 hidden sm:inline">다음</span>
                    <ChevronRight className="h-4 w-4" />
                  </PaginationLink>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
    </section>
  )
}
