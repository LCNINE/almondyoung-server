"use client"

import { cn } from "@lib/utils"
import { motion } from "framer-motion"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import { useRef, useState } from "react"

/*───────────────────────────
 * 카테고리 네비게이션 컴포넌트
 * 데스크탑 main header에서 사용되는 카테고리 네비게이션 컴포넌트입니다.
 *──────────────────────────*/
export function CategoryNavigation({
  mainCategories,
}: {
  mainCategories: readonly { name: string; handle: string }[]
}) {
  const { countryCode } = useParams()
  const pathname = usePathname()
  const scrollRef = useRef<HTMLDivElement>(null)

  // 드래그 상태 관리 (모바일 터치 외 마우스 드래그 허용 시 필요)
  const [isDrag, setIsDrag] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  const getIsActive = (handle?: string) => {
    if (!handle) return pathname === `/${countryCode}`
    return pathname?.startsWith(`/${countryCode}/category/${handle}`)
  }

  // Medusa 카테고리의 handle을 사용 (category page와 일관성 유지)
  const allTabs = [
    ...mainCategories.map((c) => ({ name: c.name, handle: c.handle })),
  ]

  // 마우스 드래그 핸들러 (선택 사항)
  const onDragStart = (e: React.MouseEvent) => {
    if (!scrollRef.current) return
    setIsDrag(true)
    setStartX(e.pageX - scrollRef.current.offsetLeft)
    setScrollLeft(scrollRef.current.scrollLeft)
  }

  const onDragEnd = () => setIsDrag(false)

  const onDragMove = (e: React.MouseEvent) => {
    if (!isDrag || !scrollRef.current) return
    e.preventDefault()
    const x = e.pageX - scrollRef.current.offsetLeft
    const walk = (x - startX) * 2
    scrollRef.current.scrollLeft = scrollLeft - walk
  }

  return (
    <nav className="w-full">
      {/* ─── 모바일: 가로 스크롤 네비게이션 ─── */}
      <div
        ref={scrollRef}
        onMouseDown={onDragStart}
        onMouseMove={onDragMove}
        onMouseUp={onDragEnd}
        onMouseLeave={onDragEnd}
        className={cn(
          "scrollbar-hide flex w-full items-center gap-4 overflow-x-auto py-2 select-none md:hidden md:px-4",
          isDrag ? "cursor-grabbing" : "cursor-grab"
        )}
      >
        {allTabs.map((tab) => (
          <NavItem
            key={tab.name}
            tab={tab}
            isActive={getIsActive(tab.handle)}
            countryCode={countryCode as string}
          />
        ))}
      </div>
      {/* ─── 데스크탑 ─── */}
      <ul className="hidden items-center gap-[clamp(0.875rem,2vw,1.75rem)] md:flex">
        {allTabs.map((tab) => (
          <NavItem
            key={tab.name}
            tab={tab}
            isActive={getIsActive(tab.handle)}
            countryCode={countryCode as string}
          />
        ))}
      </ul>
    </nav>
  )
}

function NavItem({
  tab,
  isActive,
  countryCode,
}: {
  tab: { name: string; handle?: string }
  isActive: boolean
  countryCode: string
}) {
  return (
    <li className="relative shrink-0 list-none py-2">
      <Link
        href={
          tab.handle
            ? `/${countryCode}/category/${tab.handle}`
            : `/${countryCode}`
        }
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        className={cn(
          "relative z-10 text-sm font-semibold transition-colors duration-300 md:text-xl",
          "outline-none select-none",
          isActive ? "text-white" : "text-white/50 hover:text-white"
        )}
      >
        {tab.name}
      </Link>

      {isActive && (
        <motion.div
          layoutId="active-underline"
          className="absolute right-0 bottom-0 left-0 h-[2px] bg-white"
          transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
        />
      )}
    </li>
  )
}
