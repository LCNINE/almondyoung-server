"use client"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useSearchHistory } from "@/hooks/ui/use-search-history"
import { X } from "lucide-react"

export function SearchPopover({
  isOpen,
  setIsOpen,
  children,
}: {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={-2}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="mt-2 w-(--radix-popover-trigger-width) min-w-[580px] overflow-hidden rounded-[30px] bg-white p-0 py-7"
      >
        <div className="flex min-h-[420px]">
          <SearchHistory />
          {/* todo: 급상승 검색어(미연결 구간) 임시 비활성화 */}
          {/* <SearchTrending
            items={trendingKeywords}
            updatedAt={updatedAt}
            onClose={() => setIsOpen(false)}
          /> */}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// --- 서브 컴포넌트: 최근 검색어 섹션 ---
function SearchHistory() {
  const {
    keywords: history,
    removeKeyword,
    clearAll,
    disableSave,
    setDisableSave,
  } = useSearchHistory()

  return (
    <div className="flex flex-1 flex-col justify-between border-r border-gray-100 px-8">
      <div>
        <h3 className="mb-5 text-[17px] font-bold text-gray-900">
          최근 검색어
        </h3>
        {disableSave ? (
          <p className="mt-10 text-sm text-gray-400">
            검색어 저장 기능을 껐어요.
          </p>
        ) : history.length > 0 ? (
          <ul className="space-y-4">
            {history.map((item, i) => (
              <li
                key={i}
                className="group flex cursor-pointer items-center justify-between"
              >
                <span className="text-[15px] text-gray-600 transition-colors hover:text-black">
                  {item}
                </span>
                <button
                  className="cursor-pointer text-gray-300 hover:text-gray-500"
                  onClick={() => removeKeyword(item)}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-10 text-left text-sm text-gray-400">
            최근 검색어가 없어요.
          </p>
        )}
      </div>

      <div className="mt-8 flex gap-4 pb-2 text-[13px] text-gray-400">
        <button
          type="button"
          className="cursor-pointer transition-colors hover:text-gray-600"
          onClick={clearAll}
        >
          전체 삭제
        </button>
        <button
          type="button"
          className="cursor-pointer transition-colors hover:text-gray-600"
          onClick={() => setDisableSave(!disableSave)}
        >
          {disableSave ? "검색어 저장 켜기" : "검색어 저장 끄기"}
        </button>
      </div>
    </div>
  )
}
