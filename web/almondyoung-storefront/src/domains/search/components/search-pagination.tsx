"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@lib/utils"

interface SearchResultPaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function SearchResultPagination({
  currentPage,
  totalPages,
  onPageChange,
}: SearchResultPaginationProps) {
  // 페이지 번호 배열 생성 (현재 페이지 기준으로 표시)
  const getPageNumbers = () => {
    const pages: (number | "...")[] = []
    const maxVisible = 5

    if (totalPages <= maxVisible + 2) {
      // 전체 페이지가 적으면 모두 표시
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // 항상 첫 페이지
      pages.push(1)

      if (currentPage > 3) {
        pages.push("...")
      }

      // 현재 페이지 주변
      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)

      for (let i = start; i <= end; i++) {
        pages.push(i)
      }

      if (currentPage < totalPages - 2) {
        pages.push("...")
      }

      // 항상 마지막 페이지
      pages.push(totalPages)
    }

    return pages
  }

  const pageNumbers = getPageNumbers()

  return (
    <nav
      className="flex items-center justify-center gap-1"
      aria-label="페이지네이션"
    >
      {/* 이전 페이지 */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
          currentPage === 1
            ? "cursor-not-allowed text-gray-300"
            : "text-gray-600 hover:bg-gray-100"
        )}
        aria-label="이전 페이지"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      {/* 페이지 번호 */}
      {pageNumbers.map((page, idx) => {
        if (page === "...") {
          return (
            <span
              key={`ellipsis-${idx}`}
              className="flex h-9 w-9 items-center justify-center text-gray-400"
            >
              ...
            </span>
          )
        }

        const isActive = page === currentPage

        return (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium transition-colors",
              isActive
                ? "bg-olive-600 text-white"
                : "text-gray-600 hover:bg-gray-100"
            )}
            aria-label={`${page} 페이지`}
            aria-current={isActive ? "page" : undefined}
          >
            {page}
          </button>
        )
      })}

      {/* 다음 페이지 */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
          currentPage === totalPages
            ? "cursor-not-allowed text-gray-300"
            : "text-gray-600 hover:bg-gray-100"
        )}
        aria-label="다음 페이지"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </nav>
  )
}
