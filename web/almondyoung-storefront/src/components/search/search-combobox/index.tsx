"use client"

import { useState } from "react"
import { SearchInput } from "../search-input/input"
import { SearchPopover } from "../search-popover"
import { useRouter } from "next/navigation"
import { useSearchHistory } from "@/hooks/ui/use-search-history"

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
