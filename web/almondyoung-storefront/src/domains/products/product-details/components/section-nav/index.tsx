"use client"

import { cn } from "@/lib/utils"
import { FEATURES } from "@/lib/config/features"
import { useScrollSpyWindow } from "@/hooks/use-scroll-spy-window"
import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { useTranslations } from "next-intl"

export type SectionTab = "detail" | "review" | "qna"

// QnA 기능을 닫은 동안 Q&A 탭은 네비/스크롤스파이/URL 대상에서 제외한다.
const VALID_TABS: SectionTab[] = FEATURES.qna
  ? ["detail", "review", "qna"]
  : ["detail", "review"]
const NAV_OFFSET = 56

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
  const t = useTranslations("productDetail.section")
  const tabParam = searchParams.get("tab") as SectionTab | null

  const tabIds = useMemo(() => VALID_TABS, [])
  const activeIdRaw = useScrollSpyWindow(tabIds, { topOffset: NAV_OFFSET + 8 })
  const activeTab: SectionTab =
    activeIdRaw && (VALID_TABS as string[]).includes(activeIdRaw)
      ? (activeIdRaw as SectionTab)
      : "detail"

  const scrollToSection = useCallback(
    (tab: SectionTab, behavior: ScrollBehavior = "smooth") => {
      const el = document.getElementById(tab)
      el?.scrollIntoView({ behavior, block: "start" })
    },
    []
  )

  useEffect(() => {
    if (!activeIdRaw) return
    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (activeIdRaw === "detail") {
        params.delete("tab")
      } else {
        params.set("tab", activeIdRaw)
      }
      const query = params.toString()
      window.history.replaceState(
        null,
        "",
        `${pathname}${query ? `?${query}` : ""}`
      )
    }, 80)
    return () => clearTimeout(handle)
  }, [activeIdRaw, pathname, searchParams])

  const didInitialScroll = useRef(false)
  useEffect(() => {
    if (didInitialScroll.current) return
    if (!tabParam || !VALID_TABS.includes(tabParam) || tabParam === "detail") {
      didInitialScroll.current = true
      return
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToSection(tabParam, "auto")
        didInitialScroll.current = true
      })
    })
  }, [tabParam, scrollToSection])

  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<SectionTab>).detail
      if (VALID_TABS.includes(tab)) {
        scrollToSection(tab, "smooth")
      }
    }
    window.addEventListener("navigate-tab", handler)
    return () => window.removeEventListener("navigate-tab", handler)
  }, [scrollToSection])

  const buttonClass = (active: boolean) =>
    cn(
      "flex-1 cursor-pointer border-0 border-b-2 px-4 py-3 text-sm font-bold transition-colors focus-visible:outline-none lg:text-base",
      active
        ? "border-b-[#f29219] text-[#f29219]"
        : "border-b-transparent text-[#666666] hover:text-[#333333]"
    )

  return (
    <div className="w-full">
      <nav
        aria-label={t("ariaLabel")}
        className="sticky top-0 z-10 mb-8 flex h-auto w-full border-b border-[#e5e5e5] bg-white"
      >
        <button
          type="button"
          onClick={() => scrollToSection("detail")}
          aria-current={activeTab === "detail" ? "true" : undefined}
          className={buttonClass(activeTab === "detail")}
        >
          {t("detail")}
        </button>
        <button
          type="button"
          onClick={() => scrollToSection("review")}
          aria-current={activeTab === "review" ? "true" : undefined}
          className={buttonClass(activeTab === "review")}
        >
          {t("review")}
          {reviewCountSlot}
        </button>
        {FEATURES.qna && (
          <button
            type="button"
            onClick={() => scrollToSection("qna")}
            aria-current={activeTab === "qna" ? "true" : undefined}
            className={buttonClass(activeTab === "qna")}
          >
            {t("qna")}
            {qnaCountSlot}
          </button>
        )}
      </nav>
      {children}
    </div>
  )
}

export { SectionTabPanel } from "./section-tab-panel"
