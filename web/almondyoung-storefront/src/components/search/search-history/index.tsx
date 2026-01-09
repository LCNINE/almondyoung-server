"use client"

import { Button } from "@/components/ui/button"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import { useSearchHistory } from "@/hooks/ui/use-search-history"
import { Trash2, X } from "lucide-react"
import { useRouter } from "next/navigation"

export function SearchHistory() {
  const { keywords, removeKeyword, clearAll } = useSearchHistory()
  const router = useRouter()

  const handleHistoryClick = (item: string) => {
    router.push(`/search?q=${encodeURIComponent(item)}`)
  }

  return (
    <>
      <div className="mb-4 flex items-end justify-between px-1">
        <h3 className="text-base leading-none font-bold text-gray-900">
          최근 검색어
        </h3>

        <button
          onClick={clearAll}
          className="flex items-center gap-1 text-[13px] text-gray-400 transition-colors hover:text-gray-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
          전체삭제
        </button>
      </div>

      <Carousel
        opts={{
          align: "start",
          dragFree: true,
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-2">
          {keywords.map((item: string, idx: number) => (
            <CarouselItem key={`${item}-${idx}`} className="basis-auto pl-2">
              <div
                className="flex cursor-pointer items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-0 text-xs font-medium text-gray-50"
                onClick={() => handleHistoryClick(item)}
              >
                <span>
                  {item.length > 10 ? item.slice(0, 15) + "..." : item}
                </span>

                <Button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    removeKeyword(item)
                  }}
                  variant="ghost"
                  size="sm"
                  className="text-gray-30 cursor-pointer p-0! hover:bg-transparent hover:text-gray-700"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </>
  )
}
