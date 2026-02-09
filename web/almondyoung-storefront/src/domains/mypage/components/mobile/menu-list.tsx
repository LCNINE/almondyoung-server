"use client"

import { useUser } from "@/contexts/user-context"
import { signout } from "@lib/api/users/signout"
import { ChevronRight } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import type { MenuItem, MenuSection } from "../../types/mypage-types"

interface MenuListProps {
  sections: MenuSection[]
}

export function MenuList({ sections }: MenuListProps) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const { setUser } = useUser()

  const handleLogout = () => {
    startTransition(async () => {
      try {
        await signout()
        setUser(null)
        router.replace("/")
      } catch (error) {
        console.error("로그아웃 중 오류가 발생했습니다:", error)
      }
    })
  }

  const renderMenuItem = (item: MenuItem, isLast: boolean) => {
    const itemClassName = `flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-10 ${
      !isLast ? "border-b border-gray-100" : ""
    }`

    if (item.action === "logout") {
      return (
        <button
          type="button"
          onClick={handleLogout}
          disabled={isPending}
          className={itemClassName}
        >
          <span className="text-lg">{item.icon}</span>
          <span className="flex-1 text-left text-sm text-gray-700">
            {item.label}
          </span>
          <ChevronRight className="h-4 w-4 text-gray-400" />
        </button>
      )
    }

    return (
      <Link href={item.path ?? "#"} className={itemClassName}>
        <span className="text-lg">{item.icon}</span>
        <span className="flex-1 text-sm text-gray-700">{item.label}</span>
        <ChevronRight className="h-4 w-4 text-gray-400" />
      </Link>
    )
  }

  return (
    <nav aria-label="마이페이지 메뉴" className="space-y-4 px-4 py-4">
      {sections.map((section, sectionIndex) => (
        <div
          key={sectionIndex}
          className="overflow-hidden rounded-sm bg-white shadow-sm"
        >
          <div className="border-b border-gray-100 px-4 py-2.5">
            <h3 className="text-xs font-semibold tracking-wider uppercase">
              {section.title}
            </h3>
          </div>
          <ul>
            {section.items.map((item, itemIndex) => (
              <li key={item.label}>
                {renderMenuItem(item, itemIndex === section.items.length - 1)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
