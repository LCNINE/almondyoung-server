"use client"

import { ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import LocalizedClientLink from "@/components/shared/localized-client-link"

const menuItems = [
  { labelKey: "menuSecurity" as const, href: "/mypage/payment/security" },
  { labelKey: "menuReceipt" as const, href: "/mypage/payment/receipt" },
  { labelKey: "menuTerms" as const, href: "/mypage/payment/terms" },
]

export default function PaymentMenuList() {
  const t = useTranslations("mypage.payment")
  return (
    <div className="mt-8">
      {menuItems.map((item, idx) => (
        <LocalizedClientLink
          key={item.href}
          href={item.href}
          className={`border-gray-20 hover:bg-gray-10 flex cursor-pointer items-center justify-between border-t px-7 py-4 ${idx === menuItems.length - 1 ? "border-b" : ""} `}
        >
          <span className="text-sm">{t(item.labelKey)}</span>
          <ChevronRight className="h-4 w-4 text-gray-400" />
        </LocalizedClientLink>
      ))}
    </div>
  )
}
