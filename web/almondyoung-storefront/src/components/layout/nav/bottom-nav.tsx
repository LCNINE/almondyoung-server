"use client"

import { CategorySheet } from "@/components/category/sheet"
import { useSearchSheetStore } from "@/hooks/ui/use-search-sheet-store"
import { cn } from "@/lib/utils"
import { House, LayoutGrid, Search, ShoppingCart, User } from "lucide-react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"

export function BottomNavigation() {
  const pathname = usePathname()
  const { countryCode } = useParams()
  const { onOpen } = useSearchSheetStore()
  const t = useTranslations("nav")

  // 결제 진입 화면은 하단 고정 CTA 가 같은 자리를 쓴다. success/fail 은 제외.
  if (/\/checkout(\/membership)?$/.test(pathname ?? "")) return null

  // 홈이 가운데 오도록 카테고리 → 검색 → 홈 → 장바구니 → 마이 순서로 고정
  const navItems = [
    { label: t("category"), icon: LayoutGrid, type: "sheet" },
    { label: t("search"), icon: Search, type: "action", onClick: onOpen },
    { label: t("home"), icon: House, href: `/${countryCode}`, type: "link" },
    {
      label: t("cart"),
      icon: ShoppingCart,
      href: `/${countryCode}/cart`,
      type: "link",
    },
    {
      label: t("myPage"),
      icon: User,
      href: `/${countryCode}/mypage`,
      type: "link",
    },
  ]

  return (
    <nav className="bg-background pb-safe fixed right-0 bottom-0 left-0 z-50 flex min-h-16 items-center justify-around border-t px-2 xl:hidden">
      {navItems.map((item) => {
        // 홈은 정확히 일치할 때만, 나머지 링크는 하위 경로까지 활성 처리
        const isActive = !item.href
          ? false
          : item.href === `/${countryCode}`
            ? pathname === item.href
            : (pathname?.startsWith(item.href) ?? false)
        const commonClassName = cn(
          "flex flex-1 flex-col items-center justify-center gap-1 transition-colors cursor-pointer bg-transparent border-none outline-none",
          isActive ? "text-primary" : "text-muted-foreground hover:text-primary"
        )

        // (Sheet 타입)
        if (item.type === "sheet" && item.label === t("category")) {
          return (
            <CategorySheet
              key={item.label}
              trigger={
                <button className={commonClassName} type="button">
                  <item.icon
                    className={cn("h-6 w-6", isActive && "stroke-[2.4]")}
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
                className={cn("h-6 w-6", isActive && "stroke-[2.4]")}
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
            <item.icon className={cn("h-6 w-6", isActive && "stroke-[2.4]")} />
            <span className="text-[10px] leading-none font-medium">
              {item.label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
