"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import PageSizeSelect from "./page-size-select"
import SortProducts, { type SortOptions } from "./sort-products"

type RefinementListProps = {
  sortBy: SortOptions
  pageSize: number
  search?: boolean
}

export default function RefinementList({
  sortBy,
  pageSize,
}: RefinementListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setQueryParams = (name: string, value: string) => {
    const params = new URLSearchParams(searchParams)
    params.set(name, value)

    // 정렬·개수 변경 시 페이지를 1로 초기화
    if (name === "sortBy" || name === "limit") {
      params.delete("page")
    }

    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="bg-muted flex items-center justify-between gap-4 rounded-lg px-3 py-1.5 sm:px-4">
      <div className="min-w-0 flex-1">
        <SortProducts sortBy={sortBy} setQueryParams={setQueryParams} />
      </div>
      {/* ponytail: 무한 스크롤이라 모바일에선 로드 배치 크기 노출 생략 */}
      <div className="hidden shrink-0 sm:block">
        <PageSizeSelect pageSize={pageSize} setQueryParams={setQueryParams} />
      </div>
    </div>
  )
}
