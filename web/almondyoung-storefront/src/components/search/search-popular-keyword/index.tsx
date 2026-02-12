"use client"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import chunk from "lodash/chunk"
import {
  getPopularKeywords,
  type PopularKeyword,
} from "@lib/api/pim/search"
import { Skeleton } from "@/components/ui/skeleton"

export function SearchPopularKeyword() {
  const router = useRouter()
  const [keywords, setKeywords] = useState<PopularKeyword[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchKeywords = async () => {
      try {
        const result = await getPopularKeywords()
        if ("data" in result && result.data) {
          setKeywords(result.data.keywords)
        }
      } catch (error) {
        console.error("추천 검색어 로드 실패:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchKeywords()
  }, [])

  const handleKeywordClick = (keyword: string) => {
    router.push(`/search?q=${encodeURIComponent(keyword)}`)
  }

  // 데이터를 2개씩 묶어주는 로직 (두 줄 배치를 위해)
  const rows = chunk(keywords, 2)

  if (isLoading) {
    return (
      <>
        <h3 className="text-base leading-none font-bold text-gray-900">
          추천 검색어
        </h3>
        <div className="flex gap-2 py-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skeleton key={idx} className="h-7 w-16 rounded-full" />
          ))}
        </div>
      </>
    )
  }

  if (keywords.length === 0) {
    return null
  }

  return (
    <>
      <h3 className="text-base leading-none font-bold text-gray-900">
        추천 검색어
      </h3>
      <Carousel opts={{ align: "start", dragFree: true }} className="w-full">
        <CarouselContent className="-ml-2 py-4">
          {rows.map((pair, idx) => (
            <CarouselItem key={`column-${idx}`} className="basis-auto pl-2">
              <div className="flex flex-col gap-2">
                {pair.map((item) => (
                  <div
                    key={item.keyword}
                    className="cursor-pointer rounded-full border border-gray-200 bg-white px-5 py-1 text-center text-xs font-medium whitespace-nowrap text-gray-500"
                    onClick={() => handleKeywordClick(item.keyword)}
                  >
                    {item.keyword}
                  </div>
                ))}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </>
  )
}
