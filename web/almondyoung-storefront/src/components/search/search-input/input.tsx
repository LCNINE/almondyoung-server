"use client"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Search, X } from "lucide-react"
import { forwardRef } from "react"

interface SearchInputProps extends React.HTMLAttributes<HTMLDivElement> {
  searchTerm: string
  setSearchTerm: (searchTerm: string) => void
  onSearchKeyword: (searchTerm: string) => void
  onSearch: () => void
}

export const SearchInput = forwardRef<HTMLDivElement, SearchInputProps>(
  ({ searchTerm, setSearchTerm, onSearchKeyword, onSearch, ...props }, ref) => {
    return (
      <div ref={ref} {...props} className="w-full">
        <div className="relative w-full">
          <Input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => onSearchKeyword(e.key)}
            placeholder="오늘 뭐 살까? 아몬드영"
            className="w-full rounded-xl border-none bg-gray-100 py-4 pr-20 pl-5 text-sm font-normal transition-all placeholder:text-gray-400 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-0"
          />
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
