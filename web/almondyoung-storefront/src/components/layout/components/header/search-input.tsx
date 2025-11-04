"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Search, X, Clock, ChevronDown, ChevronUp } from "lucide-react"
import {
  getSearchHistory,
  saveSearchHistory,
  removeSearchHistory,
  SearchHistoryItem,
} from "@lib/utils/search-history"
import { IoCaretDownSharp, IoCaretUpSharp } from "react-icons/io5"
import { MdCancel } from "react-icons/md"

interface SearchInputProps {
  countryCode: string
}

export function SearchInput({ countryCode }: SearchInputProps) {
  const router = useRouter()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [searchQuery, setSearchQuery] = useState("")
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([])
  const [showDropdown, setShowDropdown] = useState(false)

  // 최근 검색어 로드
  useEffect(() => {
    setSearchHistory(getSearchHistory())
  }, [])

  // 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // 검색 수행
  const handleSearch = () => {
    const q = searchQuery.trim()
    if (!q) return

    saveSearchHistory(q)
    setSearchHistory(getSearchHistory())
    router.push(`/${countryCode}/search?q=${encodeURIComponent(q)}`)
    setShowDropdown(false)
  }

  const handleHistoryClick = (query: string) => {
    setSearchQuery(query)
    saveSearchHistory(query)
    setSearchHistory(getSearchHistory())
    router.push(`/${countryCode}/search?q=${encodeURIComponent(query)}`)
    setShowDropdown(false)
  }

  const handleRemoveHistory = (query: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeSearchHistory(query)
    setSearchHistory(getSearchHistory())
  }

  const handleClearSearch = () => setSearchQuery("")

  // ✅ 클릭 시 로직을 mousedown으로 변경
  const handleInputMouseDown = () => {
    if (searchQuery.trim() === "" && showDropdown) {
      // 이미 열려있고 검색어 없으면 닫기
      setShowDropdown(false)
    } else if (searchHistory.length > 0) {
      // 그렇지 않으면 열기
      setShowDropdown(true)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setSearchQuery(val)
    if (val.trim() && searchHistory.length > 0) {
      setShowDropdown(true)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch()
  }

  return (
    <div ref={wrapperRef} className="relative flex flex-1">
      <div
        className={`bg-background border-primary flex flex-1 ${
          showDropdown
            ? "rounded-t-lg border-x-2 border-t-2"
            : "rounded-lg border"
        }`}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="상품명 또는 브랜드 입력"
          value={searchQuery}
          onChange={handleInputChange}
          onKeyPress={handleKeyPress}
          onMouseDown={handleInputMouseDown} // ✅ 여기 핵심
          className={`flex-1 px-4 py-2 text-base outline-none ${
            showDropdown
              ? "placeholder:text-muted-foreground rounded-l-md"
              : "placeholder:text-gray-70 rounded-l-md"
          }`}
        />

        <button
          onClick={handleClearSearch}
          disabled={!searchQuery}
          className={`flex items-center justify-center px-2 ${
            searchQuery
              ? "text-gray-60 hover:text-gray-80"
              : "text-gray-40 cursor-not-allowed"
          }`}
        >
          <MdCancel className="h-5 w-5" />
        </button>

        {searchHistory.length > 0 && (
          <button
            onMouseDown={() => setShowDropdown(!showDropdown)} // ✅ toggle
            className="hover:bg-muted text-primary flex items-center justify-center px-2"
          >
            {showDropdown ? (
              <IoCaretUpSharp className="h-4 w-4" />
            ) : (
              <IoCaretDownSharp className="h-4 w-4" />
            )}
          </button>
        )}

        <button
          onMouseDown={handleSearch}
          className={`flex items-center justify-center rounded-r-md px-3 ${
            showDropdown
              ? "hover:bg-muted"
              : "border-gray-30 hover:bg-muted border-l"
          }`}
        >
          <Search className="text-gray-60 h-5 w-5" />
        </button>
      </div>

      {/* ✅ 항상 존재하지만 visible만 제어 */}
      <div
        className={`border-primary bg-background absolute top-full right-0 left-0 z-[9999] rounded-b-md border-x-2 border-b-2 ${
          showDropdown ? "visible opacity-100" : "invisible opacity-50"
        }`}
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="border-muted border-t py-2">
          <ul className="px-2">
            {searchHistory.map((item, index) => (
              <li key={index} className="list-none">
                <div
                  onClick={() => handleHistoryClick(item.query)}
                  className="group hover:bg-gray-10 flex cursor-pointer items-center justify-between rounded px-2 py-2"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-muted rounded-full p-2">
                      <Clock className="text-muted-foreground/80 h-4 w-4" />
                    </div>
                    <span className="text-base text-black">{item.query}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-60 text-sm">{item.date}</span>
                    <button
                      onClick={(e) => handleRemoveHistory(item.query, e)}
                      className="text-gray-60 hover:text-gray-80 hover:bg-gray-20 rounded p-1 opacity-0 group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
