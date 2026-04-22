"use client"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useSearchHistory } from "@/hooks/ui/use-search-history"
import { useSearchSheetStore } from "@hooks/ui/use-search-sheet-store"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowLeft } from "lucide-react"
import { useEffect, useState } from "react"
import { SearchCombobox } from "../search-combobox"
import { SearchHistory } from "../search-history"
import { SearchHotKeyword } from "../search-hot-keyword"
import { SearchPopularKeyword } from "../search-popular-keyword"

export function SearchSheet() {
  const { keywords } = useSearchHistory()
  const [isHydrated, setIsHydrated] = useState(false)

  const { isOpen, onClose } = useSearchSheetStore()

  useEffect(() => {
    setIsHydrated(true)
    if (isOpen) {
      window.history.pushState({ view: "search" }, "")
      document.body.style.overflow = "hidden"
    }
    const handlePopState = () => {
      if (isOpen) onClose()
    }
    window.addEventListener("popstate", handlePopState)
    return () => {
      window.removeEventListener("popstate", handlePopState)
      document.body.style.overflow = "unset"
    }
  }, [isOpen, onClose])

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full border-none bg-white p-0 sm:max-w-full [&>button]:hidden"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>아몬드영 검색</SheetTitle>
        </SheetHeader>

        <div className="flex h-full flex-col">
          {/* 검색 헤더 */}
          <header className="bg-gray-60 sticky top-0 z-10 flex items-center px-2 py-2.5 shadow-sm transition-all">
            <button
              onClick={onClose}
              className="p-3 transition-transform active:scale-95"
              aria-label="뒤로 가기"
            >
              <ArrowLeft className="h-6 w-6 text-white" />
            </button>
            <SearchCombobox />
          </header>

          {/* 최근 검색어 섹션 */}
          <div className="flex-1 overflow-y-auto px-6 py-8">
            <AnimatePresence initial={false}>
              {isHydrated && keywords.length > 0 && (
                <motion.section
                  key="recent-search-area"
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: "auto", marginBottom: 40 }}
                  exit={{
                    opacity: 0,
                    height: 0,
                    marginBottom: 0,
                    transition: { duration: 0.3, ease: "easeInOut" },
                  }}
                  className="overflow-hidden"
                >
                  <SearchHistory />
                </motion.section>
              )}
            </AnimatePresence>

            <section className="mb-6">
              <SearchPopularKeyword />
            </section>
            <section>
              <SearchHotKeyword />
            </section>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
