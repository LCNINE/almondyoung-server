"use client"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useSearchHistory } from "@/hooks/ui/use-search-history"
import { cn } from "@/lib/utils"
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
  // todo: 백엔드에서 데이터를 가져오도록 수정
  const HOT_KEYWORD_LIST = [
    { title: "비타민D", status: "up" },
    { title: "저당 젤리", status: "new" },
    { title: "식물성 단백질", status: "up" },
    { title: "아르기닌 6000", status: "down" },
    { title: "콜라겐 스틱", status: "new" },
    { title: "유산균", status: "up" },
    { title: "오메가3", status: "new" },
    { title: "다이어트 쉐이크", status: "up" },
    { title: "선크림", status: "down" },
    { title: "비타민C", status: "new" },
  ]

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
          <SearchTrending items={HOT_KEYWORD_LIST} />
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
          <p className="mt-10 text-center text-sm text-gray-400">
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

// --- 서브 컴포넌트: 급상승 검색어 섹션 ---
function SearchTrending({
  items,
}: {
  items: { title: string; status: string }[]
}) {
  return (
    <div className="flex flex-1 flex-col justify-between px-8">
      <div>
        <h3 className="mb-5 text-[17px] font-bold text-gray-900">
          급상승 검색어
        </h3>
        <ul className="space-y-4">
          {items.map((item, i) => (
            <li
              key={i}
              className="group flex cursor-pointer items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <span
                  className={cn(
                    "w-4 text-base font-bold",
                    i < 3 ? "text-olive-600" : "text-gray-400"
                  )}
                >
                  {i + 1}
                </span>
                <span className="text-[15px] text-gray-700 group-hover:underline">
                  {item.title}
                </span>
              </div>
              <span className="text-[10px] text-gray-300">—</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 기준 시간 영역 */}
      <div className="mt-8 pb-2">
        <span className="text-[11px] font-medium text-gray-300">
          21:00 기준
        </span>
      </div>
    </div>
  )
}
