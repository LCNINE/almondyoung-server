"use client"

import { useState } from "react"
import { SearchInput } from "../search-input/input"
import { SearchPopover } from "../search-popover"
import { useRouter } from "next/navigation"
import { useSearchHistory } from "@/hooks/ui/use-search-history"

/**
 * 이 컴포넌트는 검색 입력(SearchInput)과 팝오버(SearchPopover)를 조합하여
 * 검색창 UI와 인터랙션을 담당합니다.
 *
 * 사용자는 입력창에 검색어를 입력하고, Enter 키나 검색 버튼을 누르면 검색이 실행되고
 * 검색 기록(addKeyword)에 해당 키워드가 저장됩니다.
 * 팝오버(SearchPopover)는 검색어를 입력할 때 보이며, 최근 검색어, 인기 검색어 등
 * 확장적인 검색 관련 정보를 보여줄 수 있습니다.
 */
export function SearchCombobox() {
  const [searchTerm, setSearchTerm] = useState("")
  const [isOpen, setIsOpen] = useState(false)

  const { addKeyword } = useSearchHistory()

  const router = useRouter()

  const handleSearchKeyword = (key: string) => {
    if (key === "Enter" && searchTerm.trim()) {
      addKeyword(searchTerm.trim())
      setIsOpen(false)
      router.push(`/search?q=${encodeURIComponent(searchTerm)}`)
    }
  }

  const handleSearch = () => {
    if (!searchTerm) return

    addKeyword(searchTerm.trim())
    setIsOpen(false)
    router.push(`/search?q=${encodeURIComponent(searchTerm.trim())}`)
  }

  return (
    <SearchPopover isOpen={isOpen} setIsOpen={setIsOpen}>
      <SearchInput
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        onSearchKeyword={handleSearchKeyword}
        onSearch={handleSearch}
      />
    </SearchPopover>
  )
}
