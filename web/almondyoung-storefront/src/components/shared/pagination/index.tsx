"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@lib/utils"

interface SharedPaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
  showPageInfo?: boolean // "1 / 10" 형태로 현재 페이지 정보 표시
  size?: "sm" | "md" | "lg"
}

/**
 * 공통 페이지네이션 컴포넌트
 * - 검색, 카테고리, 리뷰 등에서 공통으로 사용
 */
export function SharedPagination({
  currentPage,
  totalPages,
  onPageChange,
  className,
  showPageInfo = false,
  size = "md",
}: SharedPaginationProps) {
  if (totalPages <= 1) return null

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

  const sizeClasses = {
    sm: {
      button: "h-7 w-7 text-xs",
      icon: "h-4 w-4",
    },
    md: {
      button: "h-9 w-9 text-sm",
      icon: "h-5 w-5",
    },
    lg: {
      button: "h-10 w-10 text-base",
      icon: "h-5 w-5",
    },
  }

  const sizes = sizeClasses[size]

  return (
    <nav
      className={cn("flex items-center justify-center gap-1", className)}
      aria-label="페이지네이션"
    >
      {/* 이전 페이지 */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={cn(
          "flex items-center justify-center rounded-lg transition-colors",
          sizes.button,
          currentPage === 1
            ? "cursor-not-allowed text-gray-300"
            : "text-gray-600 hover:bg-gray-100"
        )}
        aria-label="이전 페이지"
      >
        <ChevronLeft className={sizes.icon} />
      </button>

      {/* 페이지 번호 */}
      {pageNumbers.map((page, idx) => {
        if (page === "...") {
          return (
            <span
              key={`ellipsis-${idx}`}
              className={cn(
                "flex items-center justify-center text-gray-400",
                sizes.button
              )}
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
              "flex items-center justify-center rounded-lg font-medium transition-colors",
              sizes.button,
              isActive
                ? "bg-blue-500 text-white"
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
          "flex items-center justify-center rounded-lg transition-colors",
          sizes.button,
          currentPage === totalPages
            ? "cursor-not-allowed text-gray-300"
            : "text-gray-600 hover:bg-gray-100"
        )}
        aria-label="다음 페이지"
      >
        <ChevronRight className={sizes.icon} />
      </button>

      {/* 페이지 정보 (선택적) */}
      {showPageInfo && (
        <span className="ml-4 text-sm text-gray-500">
          {currentPage} / {totalPages}
        </span>
      )}
    </nav>
  )
}

export default SharedPagination
