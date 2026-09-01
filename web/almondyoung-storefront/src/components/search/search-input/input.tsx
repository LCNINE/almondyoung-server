"use client"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Search, X } from "lucide-react"
import { forwardRef, useLayoutEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"

interface SearchInputProps extends React.HTMLAttributes<HTMLDivElement> {
  searchTerm: string
  setSearchTerm: (searchTerm: string) => void
  onSearchKeyword: (searchTerm: string) => void
  onSearch: () => void
  inputClassName?: string
}

export const SearchInput = forwardRef<HTMLDivElement, SearchInputProps>(
  (
    {
      searchTerm,
      setSearchTerm,
      onSearchKeyword,
      onSearch,
      inputClassName,
      className,
      ...props
    },
    ref
  ) => {
    const t = useTranslations("search")
    const inputRef = useRef<HTMLInputElement>(null)
    const [hintLeft, setHintLeft] = useState<number | null>(null)

    useLayoutEffect(() => {
      const el = inputRef.current
      if (!el || !searchTerm) {
        setHintLeft(null)
        return
      }

      const style = getComputedStyle(el)
      const ctx = document.createElement("canvas").getContext("2d")
      if (!ctx) return

      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const textEnd =
        parseFloat(style.paddingLeft) + ctx.measureText(searchTerm).width + 8
      const limit = el.clientWidth - parseFloat(style.paddingRight) - 60

      setHintLeft(textEnd > limit ? null : textEnd)
    }, [searchTerm])

    return (
      <div ref={ref} {...props} className={cn("w-full", className)}>
        <div className="relative w-full">
          <Input
            ref={inputRef}
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              // 한글 IME 조합 중에는 Enter 무시
              // 이렇게해야 엔터한번에 검색됌
              if (e.nativeEvent.isComposing) return
              if (e.key === "Enter") {
                e.stopPropagation()
                e.preventDefault()
              }
              onSearchKeyword(e.key)
            }}
            placeholder={t("inputPlaceholder")}
            className={cn(
              "w-full rounded-xl border-none bg-gray-100 py-4 pr-20 pl-5 text-sm font-normal transition-all placeholder:text-gray-400 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-0",
              inputClassName
            )}
          />
          {hintLeft !== null && (
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              style={{ left: hintLeft }}
              onClick={(e) => {
                e.stopPropagation()
                onSearch()
              }}
              className="bg-primary hover:bg-primary/90 absolute top-1/2 flex -translate-y-1/2 cursor-pointer items-center gap-1 rounded-full py-1 pr-2.5 pl-2 text-[11px] font-semibold text-white shadow-sm transition-colors"
            >
              <Search className="h-3 w-3" />
              {t("submit")}
            </button>
          )}

          <div className="absolute top-1/2 right-3.5 flex -translate-y-1/2 items-center gap-2.5">
            {searchTerm && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setSearchTerm("")
                }}
                className="rounded-full bg-gray-400 p-1 text-white"
              >
                <X className="h-3 w-3" />
              </button>
            )}

            <button
              type="button"
              className="group relative flex cursor-pointer items-center justify-center rounded-full p-2 transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] active:scale-90"
              onClick={(e) => {
                e.stopPropagation()
                onSearch()
              }}
            >
              <div className="absolute inset-0 rounded-full bg-gray-200 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

              <Search
                className={cn(
                  "relative h-5 w-5 text-gray-800 transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
                  "group-hover:scale-110 group-hover:text-black"
                )}
              />
            </button>
          </div>
        </div>
      </div>
    )
  }
)

SearchInput.displayName = "SearchInput"
