"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

export type SectionTab = "detail" | "review" | "qna"

const VALID_TABS: SectionTab[] = ["detail", "review", "qna"]

const triggerClassName =
  "flex-1 cursor-pointer !rounded-none !border-0 !border-b-2 !border-b-transparent !bg-transparent px-4 py-3 text-sm font-bold text-[#666666] !shadow-none transition-colors focus-visible:!ring-0 focus-visible:!outline-none !after:hidden data-[state=active]:!border-0 data-[state=active]:!border-b-2 data-[state=active]:!border-b-[#f29219] data-[state=active]:!bg-transparent data-[state=active]:!text-[#f29219] data-[state=active]:!shadow-none data-[state=inactive]:hover:text-[#333333] lg:text-base"

interface SectionTabsProps {
  reviewCountSlot?: React.ReactNode
  qnaCountSlot?: React.ReactNode
  children: React.ReactNode
}

export function SectionTabs({
  reviewCountSlot,
  qnaCountSlot,
  children,
}: SectionTabsProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const tabParam = searchParams.get("tab") as SectionTab | null
  const initialTab: SectionTab =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : "detail"
  const [activeTab, setActiveTabState] = useState<SectionTab>(initialTab)

  const tabsRef = useRef<HTMLDivElement>(null)

  const setActiveTab = useCallback(
    (tab: SectionTab) => {
      setActiveTabState(tab)
      const params = new URLSearchParams(searchParams.toString())
      if (tab === "detail") {
        params.delete("tab")
      } else {
        params.set("tab", tab)
      }
      const query = params.toString()
      window.history.replaceState(
        null,
        "",
        `${pathname}${query ? `?${query}` : ""}`
      )
    },
    [pathname, searchParams]
  )

  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<SectionTab>).detail
      if (VALID_TABS.includes(tab)) {
        setActiveTab(tab)
        tabsRef.current?.scrollIntoView({ behavior: "smooth" })
      }
    }
    window.addEventListener("navigate-tab", handler)
    return () => window.removeEventListener("navigate-tab", handler)
  }, [setActiveTab])

  return (
    <Tabs
      ref={tabsRef}
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as SectionTab)}
      className="w-full"
    >
      <TabsList className="sticky top-0 z-10 mb-8 inline-flex h-auto w-full rounded-none border-b border-[#e5e5e5] bg-white p-0">
        <TabsTrigger value="detail" className={triggerClassName}>
          상세정보
        </TabsTrigger>
        <TabsTrigger value="review" className={triggerClassName}>
          리뷰
          {reviewCountSlot}
        </TabsTrigger>

        <TabsTrigger value="qna" className={triggerClassName}>
          Q&A
          {qnaCountSlot}
        </TabsTrigger>
      </TabsList>
      {children}
    </Tabs>
  )
}

interface SectionTabPanelProps {
  value: SectionTab
  className?: string
  children: React.ReactNode
}

export function SectionTabPanel({
  value,
  className,
  children,
}: SectionTabPanelProps) {
  return (
    <TabsContent value={value} className={className}>
      {children}
    </TabsContent>
  )
}
