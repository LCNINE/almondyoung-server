"use client"

import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useCallback } from "react"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@components/common/ui/tabs"
import { REVIEW_TAB_VALUES } from "../utils/constants"

interface ReviewsTabsProps {
  writableContent: React.ReactNode
  writtenContent: React.ReactNode
}

export const ReviewsTabs = ({
  writableContent,
  writtenContent,
}: ReviewsTabsProps) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentTab =
    searchParams.get("tab") === REVIEW_TAB_VALUES.WRITTEN
      ? REVIEW_TAB_VALUES.WRITTEN
      : REVIEW_TAB_VALUES.WRITABLE

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("tab", value)
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  return (
    <Tabs
      value={currentTab}
      onValueChange={handleTabChange}
      className="mt-3 w-full"
    >
      <TabsList className="inline-flex h-auto w-full justify-start rounded-none border-b border-[#e5e5e5] bg-transparent p-0">
        <TabsTrigger
          value={REVIEW_TAB_VALUES.WRITABLE}
          className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 text-[15px] font-bold text-[#666666] shadow-none transition-colors focus-visible:ring-0 focus-visible:outline-none data-[state=active]:border-[#f29219] data-[state=active]:text-[#f29219] data-[state=active]:shadow-none data-[state=inactive]:hover:text-[#333333]"
        >
          작성 가능한 리뷰
        </TabsTrigger>
        <TabsTrigger
          value={REVIEW_TAB_VALUES.WRITTEN}
          className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 text-[15px] font-bold text-[#666666] shadow-none transition-colors focus-visible:ring-0 focus-visible:outline-none data-[state=active]:border-[#f29219] data-[state=active]:text-[#f29219] data-[state=active]:shadow-none data-[state=inactive]:hover:text-[#333333]"
        >
          내가 작성한 리뷰
        </TabsTrigger>
      </TabsList>

      <TabsContent value={REVIEW_TAB_VALUES.WRITABLE} className="mt-4">
        {writableContent}
      </TabsContent>

      <TabsContent value={REVIEW_TAB_VALUES.WRITTEN} className="mt-4">
        {writtenContent}
      </TabsContent>
    </Tabs>
  )
}
