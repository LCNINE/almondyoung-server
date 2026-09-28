"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface ScrollRowProps {
  children: React.ReactNode
  className?: string
  step?: number
  ariaLabel?: string
  labels: { prev: string; next: string }
  fadeClassName?: string
}

export function ScrollRow({
  children,
  className,
  step = 0.8,
  ariaLabel,
  labels,
  fadeClassName = "from-white",
}: ScrollRowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)

  const sync = useCallback(() => {
    const el = ref.current
    if (!el) return

    const maxScroll = el.scrollWidth - el.clientWidth
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(el.scrollLeft >= maxScroll - 1)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)

    return () => observer.disconnect()
  }, [sync])

  const scrollByStep = (direction: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * step, behavior: "smooth" })
  }

  const overflows = !(atStart && atEnd)

  return (
    <div className="flex min-w-0 items-center gap-1">
      {overflows && (
        <button
          type="button"
          aria-label={labels.prev}
          disabled={atStart}
          onClick={() => scrollByStep(-1)}
          className="flex h-6 w-5 shrink-0 items-center justify-center opacity-70 transition-opacity hover:opacity-100 disabled:opacity-25"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
        </button>
      )}

      <div className="relative min-w-0 flex-1">
        <div
          ref={ref}
          onScroll={sync}
          aria-label={ariaLabel}
          className={cn(
            // globals.css 의 .scrollbar-hide 는 max-width:768px 안에만 있어 데스크톱에선 안 먹는다
            "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            className
          )}
        >
          {children}
        </div>

        {!atEnd && (
          <div
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l to-transparent",
              fadeClassName
            )}
          />
        )}
      </div>

      {overflows && (
        <button
          type="button"
          aria-label={labels.next}
          disabled={atEnd}
          onClick={() => scrollByStep(1)}
          className="flex h-6 w-5 shrink-0 items-center justify-center opacity-70 transition-opacity hover:opacity-100 disabled:opacity-25"
        >
          <ChevronRight className="h-5 w-5" strokeWidth={1.5} />
        </button>
      )}
    </div>
  )
}
