"use client"

import { cn } from "@/lib/utils"
import { useEffect, useRef, useState } from "react"

/*───────────────────────────
 * 모바일에서 아래로 스크롤하면 헤더를 감추고, 위로 스크롤하면 다시 보여준다.
 * 데스크톱(xl 이상)에서는 항상 고정 노출 — `xl:translate-y-0` 로 무력화.
 *──────────────────────────*/

// 이 높이 아래에서는 항상 노출 (상단 근처에서 깜빡이는 것 방지)
const ALWAYS_VISIBLE_OFFSET = 80
// 방향 전환으로 인정할 최소 이동량
const DIRECTION_THRESHOLD = 8

export function AutoHideHeader({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const [hidden, setHidden] = useState(false)
  const lastY = useRef(0)
  const ticking = useRef(false)

  useEffect(() => {
    lastY.current = window.scrollY

    const update = () => {
      ticking.current = false
      const y = window.scrollY
      const delta = y - lastY.current

      if (Math.abs(delta) < DIRECTION_THRESHOLD) return
      lastY.current = y

      if (y <= ALWAYS_VISIBLE_OFFSET) {
        setHidden(false)
        return
      }
      setHidden(delta > 0)
    }

    const onScroll = () => {
      if (ticking.current) return
      ticking.current = true
      window.requestAnimationFrame(update)
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      id="site-header"
      className={cn(
        "transition-transform duration-300 ease-out will-change-transform",
        hidden ? "-translate-y-full" : "translate-y-0",
        "xl:translate-y-0",
        className
      )}
    >
      {children}
    </header>
  )
}
