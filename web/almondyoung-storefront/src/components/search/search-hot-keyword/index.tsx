"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import chunk from "lodash/chunk"
import {
  getTrendingKeywords,
  type TrendingKeyword,
} from "@lib/api/pim/search"
import { Skeleton } from "@/components/ui/skeleton"
import { useSearchSheetStore } from "@/hooks/ui/use-search-sheet-store"
import { formatDate } from "@/lib/utils/format-date"

export function SearchHotKeyword() {
  const router = useRouter()
  const { setSearchTerm, onClose } = useSearchSheetStore()
  const params = useParams<{ countryCode?: string }>()
  const countryCode =
    typeof params?.countryCode === "string" ? params.countryCode : undefined
  const searchBasePath = countryCode ? `/${countryCode}/search` : "/search"

  const [keywords, setKeywords] = useState<TrendingKeyword[]>([])
  const [updatedAt, setUpdatedAt] = useState<string>("")
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchKeywords = async () => {
      try {
        const result = await getTrendingKeywords()
        if ("data" in result && result.data) {
          setKeywords(result.data.keywords)
          setUpdatedAt(formatDate(result.data.updatedAt, "HH:mm", ""))
        }
      } catch (error) {
        console.error("급상승 검색어 로드 실패:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchKeywords()
  }, [])

  // 데이터를 반으로 나눔 (예: 10개면 5개씩 2덩어리)
  const columns = chunk(keywords, Math.ceil(keywords.length / 2))

  const handleHotKeywordClick = (keyword: string) => {
    setSearchTerm(keyword)
    router.push(`${searchBasePath}?q=${encodeURIComponent(keyword)}`)
    onClose()
  }

  if (isLoading) {
    return (
      <section>
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-base leading-none font-bold text-gray-900">
            급상승 검색어
          </h3>
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          {Array.from({ length: 10 }).map((_, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 flex-1 rounded" />
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (keywords.length === 0) {
    return null
  }

  return (
    <section>
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-base leading-none font-bold text-gray-900">
          급상승 검색어
        </h3>
        <span className="text-[12px] font-normal text-gray-400">
          {updatedAt} 기준
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-2">
        {columns.map((col, colIdx) => (
          <div key={colIdx} className="flex flex-col gap-y-4">
            {col.map((item, itemIdx) => {
              // 전체 순서를 계산
              const overallIdx =
                colIdx * Math.ceil(keywords.length / 2) + itemIdx

              return (
                <div
                  key={item.keyword}
                  className="flex cursor-pointer items-center gap-3 transition-opacity hover:opacity-70"
                  onClick={() => handleHotKeywordClick(item.keyword)}
                >
                  <span className="w-5 text-center font-black text-green-700 italic">
                    {overallIdx + 1}
                  </span>
                  <span className="flex-1 truncate text-[15px] font-medium text-gray-800">
                    {item.keyword}
                  </span>
                  <div className="flex w-8 justify-end">
                    {item.status === "new" ? (
                      <span className="rounded-sm bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600">
                        NEW
                      </span>
                    ) : item.status === "up" ? (
                      <span className="text-[10px] text-red-500">▲</span>
                    ) : item.status === "down" ? (
                      <span className="text-[10px] text-blue-500">▼</span>
                    ) : (
                      <span className="text-[10px] text-gray-400">-</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
