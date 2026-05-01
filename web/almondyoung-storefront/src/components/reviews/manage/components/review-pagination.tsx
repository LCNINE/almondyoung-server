"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"
import { SharedPagination } from "@/components/shared/pagination"

interface ReviewPaginationProps {
  currentPage: number
  totalPages: number
}

export const ReviewPagination = ({
  currentPage,
  totalPages,
}: ReviewPaginationProps) => {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handlePageChange = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("page", String(page))
      router.push(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  return (
    <SharedPagination
      currentPage={currentPage}
      totalPages={totalPages}
      onPageChange={handlePageChange}
      size="sm"
    />
  )
}
