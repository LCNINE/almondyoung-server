// components/layout/bottom-navigation.tsx
"use client"

import { useState, useEffect } from "react"
import { usePathname, useParams } from "next/navigation"
import { cn } from "@lib/utils"
import {
  CategoryNavButton,
  HomeNavButton,
  MyPageNavButton,
  SearchNavButton,
  CartNavButton,
} from "@components/common/Icon-text/icon-texts"

export function BottomNavigation({ className }: { className?: string }) {
  const pathname = (usePathname() ?? "/").split("?")[0]
  const params = useParams() as { countryCode?: string }
  const [currentRoot, setCurrentRoot] = useState("")

  // 경로 파싱 로직 (네비게이션 활성화 상태 확인용)
  useEffect(() => {
    const segments = pathname.split("/").filter(Boolean)
    const isCountry = (s?: string) => !!s && /^[a-z]{2}$/i.test(s)

    let i = 0
    while (i < segments.length && isCountry(segments[i])) i++

    const rest = segments.slice(i)
    const newCurrentRoot = (rest[0] ?? "").toLowerCase()

    setCurrentRoot(newCurrentRoot)
  }, [pathname, params])

  return (
    <nav
      className={cn(
        "bg-background fixed inset-x-0 bottom-0 z-50 w-full border-t pb-[env(safe-area-inset-bottom)] md:hidden",
        className
      )}
      aria-label="모바일 하단 네비게이션"
    >
      <ul className="grid w-full grid-cols-5 items-center justify-between">
        <li>
          <HomeNavButton
            isActive={currentRoot === "" || currentRoot === "home"}
          />
        </li>
        <li>
          <CategoryNavButton isActive={currentRoot === "category"} />
        </li>
        <li>
          <CartNavButton isActive={currentRoot === "cart"} />
        </li>
        <li>
          <SearchNavButton isActive={currentRoot === "search"} />
        </li>
        <li>
          <MyPageNavButton isActive={currentRoot === "mypage"} />
        </li>
      </ul>
    </nav>
  )
}
