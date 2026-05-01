"use client"

import { Search } from "lucide-react"
import { useState } from "react"

export function OrderSearch() {
  const [searchQuery, setSearchQuery] = useState("")

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    console.log("검색:", searchQuery)
  }

  return (
    <section className="flex items-center gap-1.5 bg-white">
      {/* 🔍 검색 입력 영역 */}
      <form className="relative flex-1">
        <input
          type="search"
          placeholder="주문한 상품을 검색할 수 있어요"
          className="h-9 w-full rounded-[5px] border border-zinc-300 px-3 font-['Pretendard'] text-xs leading-4 text-gray-400 focus:border-gray-400 focus:outline-none"
        />
      </form>

      {/* 🔍 검색 아이콘 버튼 */}
      <button
        type="submit"
        className="flex h-9 w-9 items-center justify-center rounded-[5px] text-white transition"
        aria-label="검색"
      >
        <Search className="h-5 w-5 text-black" aria-hidden="true" />
      </button>
    </section>
  )
}
