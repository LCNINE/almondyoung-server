"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Search } from "lucide-react"
import { useState, useRef, useEffect } from "react"

const SEARCH_DEBOUNCE_MS = 300

interface WishlistQueryProps {
  initialQuery: string
  onSearchChange: (query: string) => void
  excludeSoldout: boolean
  onExcludeSoldoutChange: (checked: boolean) => void
  totalCount: number
}

export function WishlistQuery({
  initialQuery,
  onSearchChange,
  excludeSoldout,
  onExcludeSoldoutChange,
  totalCount,
}: WishlistQueryProps) {
  const [inputValue, setInputValue] = useState(initialQuery)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 입력값 변경 시 debounce 후 검색 트리거
  const handleInputChange = (value: string) => {
    setInputValue(value)

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      onSearchChange(value)
    }, SEARCH_DEBOUNCE_MS)
  }

  // cleanup
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  return (
    <div className="mb-4 space-y-3">
      {/* 상품 개수 */}
      <div className="text-sm text-gray-600">
        총 <span className="font-medium text-gray-900">{totalCount}</span>개
      </div>

      {/* 검색창 */}
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          type="text"
          placeholder="찜한 상품 중 검색"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          className="bg-background h-10 pl-10"
        />
      </div>

      {/* 품절상품 제외 체크박스 */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="exclude-soldout"
          checked={excludeSoldout}
          onCheckedChange={(checked) =>
            onExcludeSoldoutChange(checked === true)
          }
        />
        <Label
          htmlFor="exclude-soldout"
          className="cursor-pointer text-sm text-gray-700"
        >
          품절상품 제외
        </Label>
      </div>
    </div>
  )
}
