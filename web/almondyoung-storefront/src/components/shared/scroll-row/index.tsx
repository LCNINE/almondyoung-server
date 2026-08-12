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
}

export function ScrollRow({
  children,
  className,
  step = 0.8,
  ariaLabel,
  labels,
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

  const fadeLeft = !atStart
  const fadeRight = !atEnd

  return (
    <div className="relative min-w-0">
      {fadeLeft && (
        <button
          type="button"
          aria-label={labels.prev}
          onClick={() => scrollByStep(-1)}
          className="absolute top-1/2 -left-2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      <div
        ref={ref}
        onScroll={sync}
        aria-label={ariaLabel}
        className={cn(
          // globals.css 의 .scrollbar-hide 는 max-width:768px 안에만 있어 데스크톱에선 안 먹는다
          "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className
        )}
        style={
          fadeLeft || fadeRight
            ? {
                maskImage: `linear-gradient(to right, ${
                  fadeLeft ? "transparent 0, black 32px" : "black 0"
                }, ${
                  fadeRight ? "black calc(100% - 32px), transparent 100%" : "black 100%"
                })`,
              }
            : undefined
        }
      >
        {children}
      </div>

      {fadeRight && (
        <button
          type="button"
          aria-label={labels.next}
          onClick={() => scrollByStep(1)}
          className="absolute top-1/2 -right-2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
