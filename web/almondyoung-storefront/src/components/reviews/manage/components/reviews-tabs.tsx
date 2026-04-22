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
      <TabsList className="bg-muted grid h-11 w-full grid-cols-2">
        <TabsTrigger
          value={REVIEW_TAB_VALUES.WRITABLE}
          className="data-[state=active]:bg-primary! data-[state=active]:text-primary-foreground! text-[14px] font-semibold data-[state=active]:shadow-sm"
        >
          작성 가능한 리뷰
        </TabsTrigger>
        <TabsTrigger
          value={REVIEW_TAB_VALUES.WRITTEN}
          className="data-[state=active]:bg-primary! data-[state=active]:text-primary-foreground! text-[14px] font-semibold data-[state=active]:shadow-sm"
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
