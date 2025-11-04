"use client"

import React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  showPageNumbers?: boolean
  className?: string
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  showPageNumbers = true,
  className = ""
}) => {
  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1)
    }
  }

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1)
    }
  }

  if (totalPages <= 1) {
    return null
  }

  return (
    <div className={`mt-6 flex justify-center ${className}`}>
      <div className="flex items-center gap-2">
        {/* 이전 페이지 버튼 */}
        <button
          onClick={handlePrevious}
          disabled={currentPage === 1}
          className="rounded-md border border-gray-300 px-6 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>

        {/* 페이지 번호 표시 */}
        {showPageNumbers && (
          <div className="flex items-center gap-1 px-3 py-2 text-sm">
            <span className="font-bold">{currentPage}</span>
            <span className="font-medium text-gray-500">
              / {totalPages}
            </span>
          </div>
        )}

        {/* 다음 페이지 버튼 */}
        <button
          onClick={handleNext}
          disabled={currentPage === totalPages}
          className="rounded-md border border-gray-300 px-6 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronRightIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

export default Pagination
