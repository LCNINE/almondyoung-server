"use client"

import { Button } from "@/components/ui/button"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel"
import { useSearchHistory } from "@/hooks/ui/use-search-history"
import { useSearchSheetStore } from "@/hooks/ui/use-search-sheet-store"
import { Trash2, X } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

export function SearchHistory() {
  const t = useTranslations("search.history")
  const { keywords, removeKeyword, clearAll } = useSearchHistory()
  const { onClose, setSearchTerm } = useSearchSheetStore()
  const router = useRouter()
  const params = useParams<{ countryCode?: string }>()
  const countryCode =
    typeof params?.countryCode === "string" ? params.countryCode : undefined
  const searchBasePath = countryCode ? `/${countryCode}/search` : "/search"

  const handleHistoryClick = (item: string) => {
    setSearchTerm(item)
    router.push(`${searchBasePath}?q=${encodeURIComponent(item)}`)
    onClose()
  }

  return (
    <>
      <div className="mb-4 flex items-end justify-between px-1">
        <h3 className="text-base leading-none font-bold text-gray-900">
          {t("title")}
        </h3>

        <button
          onClick={clearAll}
          className="flex items-center gap-1 px-1 py-1.5 text-[13px] text-gray-400 transition-colors hover:text-gray-600"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("clearAll")}
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
                className="flex h-9 cursor-pointer items-center gap-1 rounded-full border border-gray-200 bg-white py-0 pr-1 pl-4 text-xs font-medium text-gray-500"
                onClick={() => handleHistoryClick(item)}
              >
                <span>
                  {item.length > 15 ? item.slice(0, 15) + "..." : item}
                </span>

                <Button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    removeKeyword(item)
                  }}
                  variant="ghost"
                  size="sm"
                  aria-label={t("removeKeyword", { keyword: item })}
                  className="size-8 shrink-0 cursor-pointer rounded-full p-0! text-gray-400 hover:bg-gray-100 hover:text-gray-700"
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
