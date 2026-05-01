"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useState } from "react"

export type CsTab = "faq" | "inquiry" | "notice"

const VALID_TABS: CsTab[] = ["faq", "inquiry", "notice"]

const TAB_LABELS: Record<CsTab, string> = {
  faq: "FAQ",
  inquiry: "1:1 문의",
  notice: "공지사항",
}

const triggerClassName =
  "flex-1 cursor-pointer !rounded-none !border-0 !border-b-2 !border-b-transparent !bg-transparent px-4 py-3 text-sm font-bold text-[#666666] !shadow-none transition-colors focus-visible:!ring-0 focus-visible:!outline-none !after:hidden data-[state=active]:!border-0 data-[state=active]:!border-b-2 data-[state=active]:!border-b-[#f29219] data-[state=active]:!bg-transparent data-[state=active]:!text-[#f29219] data-[state=active]:!shadow-none hover:!bg-transparent hover:text-[#f29219]"

interface CsTabsProps {
  children: React.ReactNode
}

export function CsTabs({ children }: CsTabsProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const tabParam = searchParams.get("tab") as CsTab | null
  const initialTab: CsTab =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : "faq"
  const [activeTab, setActiveTabState] = useState<CsTab>(initialTab)

  const setActiveTab = useCallback(
    (tab: CsTab) => {
      setActiveTabState(tab)
      const params = new URLSearchParams(searchParams.toString())
      if (tab === "faq") {
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

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as CsTab)}
      className="w-full"
    >
      <TabsList className="sticky top-0 z-10 inline-flex !h-14 w-full rounded-none border-b border-[#e5e5e5] bg-white p-0">
        {VALID_TABS.map((tab) => (
          <TabsTrigger key={tab} value={tab} className={triggerClassName}>
            {TAB_LABELS[tab]}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  )
}

interface CsTabPanelProps {
  value: CsTab
  className?: string
  children: React.ReactNode
}

export function CsTabPanel({ value, className, children }: CsTabPanelProps) {
  return (
    <TabsContent value={value} className={className}>
      {children}
    </TabsContent>
  )
}
