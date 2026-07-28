"use client"

import { cn } from "@/lib/utils"
import { FEATURES } from "@/lib/config/features"
import { useScrollSpyWindow } from "@/hooks/use-scroll-spy-window"
import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"

export type SectionTab = "detail" | "review" | "qna"

// QnA 기능을 닫은 동안 Q&A 탭은 네비/스크롤스파이/URL 대상에서 제외한다.
const VALID_TABS: SectionTab[] = FEATURES.qna
  ? ["detail", "review", "qna"]
  : ["detail", "review"]
const DEFAULT_SECTION_OFFSET = 160

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

  const navRef = useRef<HTMLElement>(null)
  const [sectionOffset, setSectionOffset] = useState(DEFAULT_SECTION_OFFSET)

  // 스크롤스파이 판정과 앵커 스크롤(scroll-mt)에 쓰는 값. 헤더가 보이는 상태를 기준으로
  // 잡는다 — 탭을 눌러 위로 스크롤하면 auto-hide 헤더가 다시 나타나므로 그게 맞다.
  useEffect(() => {
    const measure = () => {
      const headerH = document.getElementById("site-header")?.offsetHeight ?? 0
      const navH = navRef.current?.offsetHeight ?? 0
      document.documentElement.style.setProperty(
        "--pdp-section-offset",
        `${headerH + navH}px`
      )
      setSectionOffset(headerH + navH)
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [])

  // sticky 탭의 top 오프셋. 헤더는 스크롤에 따라 `-translate-y-full` 로 숨는데,
  // `offsetHeight` 는 transform 을 반영하지 않아 헤더가 사라져도 값이 그대로다.
  // 그걸 top 으로 쓰면 헤더가 없어진 자리에 빈 띠가 남고 그 아래에 탭이 떠 있게 된다.
  // `getBoundingClientRect().bottom` 은 transform 을 반영하므로 실제로 화면에 보이는
  // 아래 끝을 준다 — 숨으면 0 이하가 되니 0 으로 클램프한다.
  useEffect(() => {
    let raf = 0
    let lastValue = -1
    let settledFrames = 0

    const apply = () => {
      raf = 0
      const header = document.getElementById("site-header")
      const visibleBottom = header
        ? Math.max(0, header.getBoundingClientRect().bottom)
        : 0

      if (visibleBottom !== lastValue) {
        lastValue = visibleBottom
        settledFrames = 0
        document.documentElement.style.setProperty(
          "--pdp-header-h",
          `${visibleBottom}px`
        )
      } else {
        settledFrames += 1
      }

      // 헤더는 300ms transition 으로 움직인다. 스크롤 이벤트는 그보다 먼저 멎으므로,
      // 값이 안정될 때까지 몇 프레임 더 따라가야 탭이 헤더와 같이 부드럽게 붙는다.
      if (settledFrames < 3) schedule()
    }

    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(apply)
    }

    schedule()
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    return () => {
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  const activeIdRaw = useScrollSpyWindow(tabIds, { topOffset: sectionOffset })
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
        ? "border-b-[#ff6600] text-[#ff6600]"
        : "border-b-transparent text-[#666666] hover:text-[#333333]"
    )

  return (
    <div className="w-full">
      <nav
        ref={navRef}
        aria-label={t("ariaLabel")}
        className="sticky top-(--pdp-header-h) z-10 mb-8 flex h-auto w-full border-b border-[#e5e5e5] bg-white"
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
