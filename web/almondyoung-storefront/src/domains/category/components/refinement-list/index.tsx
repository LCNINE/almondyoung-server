"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

import SortProducts, { SortOptions } from "./sort-products"

type RefinementListProps = {
  sortBy: SortOptions
  search?: boolean
}

export default function RefinementList({ sortBy }: RefinementListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setQueryParams = (name: string, value: string) => {
    const params = new URLSearchParams(searchParams)
    params.set(name, value)

    // 정렬 변경 시 페이지를 1로 초기화
    if (name === "sortBy") {
      params.delete("page")
    }

    router.push(`${pathname}?${params.toString()}`)
  }

  return <SortProducts sortBy={sortBy} setQueryParams={setQueryParams} />
}
