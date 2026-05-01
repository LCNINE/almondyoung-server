"use client"

import { SharedPagination } from "@/components/shared/pagination"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

interface PointHistoryPaginationProps {
  currentPage: number
  totalPages: number
}

export function PointHistoryPagination({
  currentPage,
  totalPages,
}: PointHistoryPaginationProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (page <= 1) {
      params.delete("page")
    } else {
      params.set("page", page.toString())
    }

    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <SharedPagination
      currentPage={currentPage}
      totalPages={totalPages}
      onPageChange={handlePageChange}
    />
  )
}
