"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Eye, Heart, Package, ShoppingBag } from "lucide-react"
import { useTranslations } from "next-intl"

export function QuickMenuSection() {
  const t = useTranslations("mypage.quickLink")

  const menuItems = [
    {
      label: t("orderList"),
      icon: <Package size={32} className="text-amber-500" />,
      href: "/mypage/order/list",
    },
    {
      label: t("wish"),
      icon: <Heart size={32} className="text-amber-500" />,
      href: "/mypage/wish",
    },
    {
      label: t("rebuy"),
      icon: <ShoppingBag size={32} className="text-amber-500" />,
      href: "/mypage/rebuy",
    },
    {
      label: t("recent"),
      icon: <Eye size={32} className="text-amber-500" />,
      href: "/mypage/recent",
    },
  ]

  return (
    <nav className="rounded-lg bg-white">
      <div className="px-5 py-4">
        <div className="mx-auto max-w-[600px]">
          <ul className="grid grid-cols-4 gap-8">
            {menuItems.map((item) => (
              <li key={item.label}>
                <LocalizedClientLink
                  href={item.href}
                  className="flex w-full flex-col items-center gap-2 transition-opacity hover:opacity-70"
                >
                  <div className="flex h-10 w-10 items-center justify-center">
                    {item.icon}
                  </div>
                  <span className="font-['Pretendard'] text-sm font-medium text-black">
                    {item.label}
                  </span>
                </LocalizedClientLink>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </nav>
  )
}
