"use client"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useSearchHistory } from "@/hooks/ui/use-search-history"
import { useSearchSheetStore } from "@/hooks/ui/use-search-sheet-store"
import { useParams, useRouter } from "next/navigation"
import { X } from "lucide-react"
import { useTranslations } from "next-intl"
import { SearchHotKeyword } from "../search-hot-keyword"

export function SearchPopover({
  isOpen,
  setIsOpen,
  children,
  suggestions = [],
}: {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  children: React.ReactNode
  suggestions?: string[]
}) {
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={-2}
        onOpenAutoFocus={(e) => e.preventDefault()}
        collisionPadding={12}
        className="mt-2 max-h-[70vh] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] min-w-0 overflow-x-hidden overflow-y-auto rounded-2xl bg-white p-0 py-5 sm:max-h-none sm:w-(--radix-popover-trigger-width) sm:max-w-none sm:min-w-[580px] sm:overflow-hidden sm:rounded-[30px] sm:py-7"
      >
        <div className="flex flex-col sm:min-h-[420px] sm:flex-row">
          <SearchHistory
            suggestions={suggestions}
            onClose={() => setIsOpen(false)}
          />
          <div className="min-w-0 flex-1 px-5 pt-6 sm:px-8 sm:py-2">
            <SearchHotKeyword />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// --- 서브 컴포넌트: 최근 검색어 + 자동완성 섹션 ---
function SearchHistory({
  suggestions,
  onClose,
}: {
  suggestions: string[]
  onClose: () => void
}) {
  const t = useTranslations("search.popover")
  const {
    keywords: history,
    removeKeyword,
    clearAll,
    disableSave,
    setDisableSave,
    addKeyword,
  } = useSearchHistory()
  const { onClose: closeSheet, setSearchTerm } = useSearchSheetStore()

  const router = useRouter()
  const params = useParams<{ countryCode?: string }>()
  const countryCode =
    typeof params?.countryCode === "string" ? params.countryCode : undefined
  const searchBasePath = countryCode ? `/${countryCode}/search` : "/search"

  const handleSuggestionClick = (keyword: string) => {
    setSearchTerm(keyword)
    addKeyword(keyword)
    onClose()
    router.push(`${searchBasePath}?q=${encodeURIComponent(keyword)}`)
    closeSheet()
  }

  const handleHistoryClick = (keyword: string) => {
    setSearchTerm(keyword)
    addKeyword(keyword)
    onClose()
    router.push(`${searchBasePath}?q=${encodeURIComponent(keyword)}`)
    closeSheet()
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-between border-b border-gray-100 px-5 pb-5 sm:border-r sm:border-b-0 sm:px-8 sm:pb-0">
      <div>
        {suggestions.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-5 text-[17px] font-bold text-gray-900">
              {t("suggestionsTitle")}
            </h3>
            <ul className="space-y-4">
              {suggestions.map((keyword, i) => (
                <li
                  key={i}
                  className="cursor-pointer text-[15px] text-gray-600 transition-colors hover:text-black"
                  onClick={() => handleSuggestionClick(keyword)}
                >
                  {keyword}
                </li>
              ))}
            </ul>
          </div>
        )}

        <h3 className="mb-5 text-[17px] font-bold text-gray-900">
          {t("historyTitle")}
        </h3>
        {disableSave ? (
          <p className="mt-10 text-sm text-gray-400">
            {t("historyDisabled")}
          </p>
        ) : history.length > 0 ? (
          <ul className="space-y-1">
            {history.map((item, i) => (
              <li
                key={i}
                className="group flex cursor-pointer items-center justify-between gap-2"
                onClick={() => handleHistoryClick(item)}
              >
                <span className="min-w-0 flex-1 truncate py-2.5 text-[15px] text-gray-600 transition-colors hover:text-black">
                  {item}
                </span>
                <button
                  type="button"
                  aria-label={t("removeKeyword", { keyword: item })}
                  className="-mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  onClick={(event) => {
                    event.stopPropagation()
                    removeKeyword(item)
                  }}
                >
                  <X className="h-5 w-5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-10 text-left text-sm text-gray-400">
            {t("historyEmpty")}
          </p>
        )}
      </div>

      <div className="mt-4 flex gap-2 pb-2 text-[13px] text-gray-400 sm:mt-8">
        <button
          type="button"
          className="cursor-pointer px-1 py-2 transition-colors hover:text-gray-600"
          onClick={clearAll}
        >
          {t("clearAll")}
        </button>
        <button
          type="button"
          className="cursor-pointer px-1 py-2 transition-colors hover:text-gray-600"
          onClick={() => setDisableSave(!disableSave)}
        >
          {disableSave ? t("saveOn") : t("saveOff")}
        </button>
      </div>
    </div>
  )
}
