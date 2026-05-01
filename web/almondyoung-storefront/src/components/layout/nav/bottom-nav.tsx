"use client"

import { CategorySheet } from "@/components/category/sheet"
import { useSearchSheetStore } from "@/hooks/ui/use-search-sheet-store"
import { cn } from "@/lib/utils"
import { House, Menu, Search, ShoppingCart, User } from "lucide-react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"

export function BottomNavigation() {
  const pathname = usePathname()
  const { countryCode } = useParams()
  const { onOpen } = useSearchSheetStore()

  const navItems = [
    { label: "홈", icon: House, href: `/${countryCode}`, type: "link" },
    { label: "카테고리", icon: Menu, type: "sheet" },
    { label: "검색", icon: Search, type: "action", onClick: onOpen },
    {
      label: "장바구니",
      icon: ShoppingCart,
      href: `/${countryCode}/cart`,
      type: "link",
    },
    {
      label: "마이",
      icon: User,
      href: `/${countryCode}/mypage`,
      type: "link",
    },
  ]

  return (
    <nav className="bg-background pb-safe fixed right-0 bottom-0 left-0 z-50 flex h-16 items-center justify-around border-t px-2 md:hidden">
      {navItems.map((item) => {
        const isActive = item.href ? pathname === item.href : false
        const commonClassName = cn(
          "flex flex-1 flex-col items-center justify-center gap-1 transition-colors cursor-pointer bg-transparent border-none outline-none",
          isActive ? "text-primary" : "text-muted-foreground hover:text-primary"
        )

        // (Sheet 타입)
        if (item.type === "sheet" && item.label === "카테고리") {
          return (
            <CategorySheet
              key={item.label}
              trigger={
                <button className={commonClassName} type="button">
                  <item.icon
                    className={cn("h-6 w-6", isActive && "fill-current")}
                  />
                  <span className="text-[10px] leading-none font-medium">
                    {item.label}
                  </span>
                </button>
              }
            />
          )
        }

        //  검색 시트 트리거
        if (item.type === "action") {
          return (
            <button
              key={item.label}
              onClick={item.onClick}
              className={commonClassName}
              type="button"
            >
              <item.icon
                className={cn("h-6 w-6", isActive && "fill-current")}
              />
              <span className="text-[10px] leading-none font-medium">
                {item.label}
              </span>
            </button>
          )
        }

        // 일반 링크
        return (
          <Link
            key={item.label}
            href={item.href || "#"}
            className={commonClassName}
          >
            <item.icon className={cn("h-6 w-6", isActive && "fill-current")} />
            <span className="text-[10px] leading-none font-medium">
              {item.label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
