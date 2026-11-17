"use client"

import { Children, useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

const NAV_SIZE = 44
const EDGE = 4

const COLUMNS = {
  five: "md:auto-cols-[calc((100%_-_48px)/4)] lg:auto-cols-[calc((100%_-_64px)/5)]",
  four: "md:auto-cols-[calc((100%_-_48px)/4)]",
} as const

interface HomeRailProps {
  children: React.ReactNode
  columns?: keyof typeof COLUMNS
  /** 카드 위쪽 사진의 세로/가로 비율. 화살표를 사진 한가운데에 맞춘다 */
  thumbRatio?: number
  className?: string
}

export function HomeRail({
  children,
  columns = "five",
  thumbRatio = 1,
  className,
}: HomeRailProps) {
  const t = useTranslations("header.quickLinks")
  const trackRef = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)
  const [navTop, setNavTop] = useState<number | null>(null)
  const itemCount = Children.count(children)

  const sync = useCallback(() => {
    const track = trackRef.current
    if (!track) return

    setAtStart(track.scrollLeft < EDGE)
    setAtEnd(track.scrollLeft + track.clientWidth >= track.scrollWidth - EDGE)

    const first = track.firstElementChild
    if (first instanceof HTMLElement) {
      setNavTop((first.offsetWidth * thumbRatio) / 2 - NAV_SIZE / 2)
    }
  }, [thumbRatio])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(track)

    return () => observer.disconnect()
  }, [sync, itemCount])

  const scrollPage = (direction: 1 | -1) => {
    const track = trackRef.current
    if (!track) return

    track.scrollBy({ left: direction * track.clientWidth, behavior: "smooth" })
  }

  const navClassName =
    "absolute z-[2] hidden size-11 place-items-center rounded-full bg-white text-ink shadow-[0_2px_10px_rgba(20,22,23,0.16)] transition-opacity disabled:pointer-events-none disabled:opacity-0 md:grid"

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        aria-label={t("prev")}
        disabled={atStart}
        onClick={() => scrollPage(-1)}
        style={navTop === null ? undefined : { top: navTop }}
        className={cn(navClassName, "top-[30%] -left-[22px]")}
      >
        <ChevronLeft className="size-5" strokeWidth={2.2} />
      </button>

      <div
        ref={trackRef}
        onScroll={sync}
        className={cn(
          "grid snap-x snap-mandatory auto-cols-[42%] grid-flow-col gap-3 overflow-x-auto md:gap-4",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "[&>*]:min-w-0 [&>*]:snap-start",
          COLUMNS[columns]
        )}
      >
        {children}
      </div>

      <button
        type="button"
        aria-label={t("next")}
        disabled={atEnd}
        onClick={() => scrollPage(1)}
        style={navTop === null ? undefined : { top: navTop }}
        className={cn(navClassName, "top-[30%] -right-[22px]")}
      >
        <ChevronRight className="size-5" strokeWidth={2.2} />
      </button>
    </div>
  )
}
