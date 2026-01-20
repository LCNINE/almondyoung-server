"use client"
import { useState } from "react"
// ReviewDetailCard 임포트는 실제 경로에 맞게 수정해주세요
import { ReviewDetailCard, ReviewDetail } from "./review-detail-card"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationEllipsis,
} from "@components/common/ui/pagination"
// 아이콘 추가
import { ChevronLeft, ChevronRight } from "lucide-react"

export type ReviewDetailCardListProps = {
  reviews: ReviewDetail[]
  itemsPerPage?: number
  onLike?: (reviewId: string, liked: boolean) => void
}

/**
 * @description 리뷰 상세 카드 목록 with 페이지네이션
 */
export function ReviewDetailCardList({
  reviews,
  itemsPerPage = 10,
  onLike,
}: ReviewDetailCardListProps) {
  const [currentPage, setCurrentPage] = useState(1)

  const totalPages = Math.ceil(reviews.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentReviews = reviews.slice(startIndex, endIndex)

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // 페이지 번호 배열 생성 (로직은 그대로 사용)
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

  if (reviews.length === 0) {
    return (
      <div className="py-12 text-center text-gray-500">
        아직 작성된 리뷰가 없습니다.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 리뷰 목록 */}
      <ul className="divide-y divide-gray-200">
        {currentReviews.map((review) => (
          <li key={review.id}>
            <ReviewDetailCard review={review} onLike={onLike} />
          </li>
        ))}
      </ul>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <Pagination>
          {/* flex-wrap과 justify-center를 유지합니다. */}
          <PaginationContent className="flex-wrap justify-center">
            {/* [수정] PaginationPrevious 대신 PaginationLink 사용 */}
            <PaginationItem>
              <PaginationLink
                aria-label="Previous page"
                onClick={() =>
                  currentPage > 1 && handlePageChange(currentPage - 1)
                }
                className={
                  currentPage === 1
                    ? "pointer-events-none opacity-50" // 비활성화
                    : "cursor-pointer" // 활성화
                }
                // href가 없으면 자동으로 <button>으로 렌더링됩니다.
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="ml-1 hidden sm:inline">이전</span>
              </PaginationLink>
            </PaginationItem>

            {/* 페이지 번호 (기존과 동일) */}
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

            {/* [수정] PaginationNext 대신 PaginationLink 사용 */}
            <PaginationItem>
              <PaginationLink
                aria-label="Next page"
                onClick={() =>
                  currentPage < totalPages && handlePageChange(currentPage + 1)
                }
                className={
                  currentPage === totalPages
                    ? "pointer-events-none opacity-50" // 비활성화
                    : "cursor-pointer" // 활성화
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
  )
}
