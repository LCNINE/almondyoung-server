"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FEATURES } from "@/lib/config/features"
import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useState } from "react"
import { useTranslations } from "next-intl"

export type CsTab = "faq" | "inquiry" | "notice"

// QnA 기능을 닫은 동안 1:1 문의(inquiry) 탭은 노출/URL 대상에서 제외한다.
// ?tab=inquiry 로 직접 들어와도 VALID_TABS 검증에서 faq 로 폴백된다.
const VALID_TABS: CsTab[] = FEATURES.qna
  ? ["faq", "inquiry", "notice"]
  : ["faq", "notice"]

const triggerClassName =
  "flex-1 cursor-pointer !rounded-none !border-0 !border-b-2 !border-b-transparent !bg-transparent px-4 py-3 text-sm font-bold text-[#666666] !shadow-none transition-colors focus-visible:!ring-0 focus-visible:!outline-none !after:hidden data-[state=active]:!border-0 data-[state=active]:!border-b-2 data-[state=active]:!border-b-[#f29219] data-[state=active]:!bg-transparent data-[state=active]:!text-[#f29219] data-[state=active]:!shadow-none hover:!bg-transparent hover:text-[#f29219]"

interface CsTabsProps {
  children: React.ReactNode
}

export function CsTabs({ children }: CsTabsProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useTranslations("cs.tabs")

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
            {t(tab)}
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
