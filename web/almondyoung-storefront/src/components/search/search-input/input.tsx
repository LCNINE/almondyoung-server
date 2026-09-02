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
                aria-label={t("clearInput")}
                onClick={(e) => {
                  e.stopPropagation()
                  setSearchTerm("")
                }}
                className="relative flex size-5 cursor-pointer items-center justify-center rounded-full bg-gray-400 text-white before:absolute before:-inset-1 before:content-['']"
              >
                <X className="h-3 w-3" />
              </button>
            )}

            <button
              type="button"
              aria-label={t("submit")}
              title={t("submit")}
              className={cn(
                "group relative flex size-8 cursor-pointer items-center justify-center rounded-full transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] active:scale-90",
                // 버튼 자체는 입력창 높이에 맞춰 작지만, 실제 터치 영역은 넓힌다.
                "before:absolute before:-inset-1.5 before:content-['']",
                // 아이콘만 두면 눌러도 되는 버튼인지 안 보여서, 평상시에도 옅은 면을
                // 깔아 클릭 대상임을 드러낸다.
                "bg-secondary hover:bg-primary"
              )}
              onClick={(e) => {
                e.stopPropagation()
                onSearch()
              }}
            >
              <Search
                className={cn(
                  "relative h-5 w-5 transition-colors duration-200",
                  "text-foreground group-hover:text-white"
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
