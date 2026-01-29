"use client"

import { Spinner } from "@/components/shared/spinner"
import { useUser } from "@/contexts/user-context"
import { signout } from "@lib/api/users/signout"
import { ChevronRight } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { MenuItem } from "../../types/mypage-types"

interface MenuListProps {
  items: MenuItem[]
}

function ListIcon({ children }: { children: React.ReactNode }) {
  return <div className="h-6 w-6 text-2xl text-gray-500">{children}</div>
}

export function MenuList({ items }: MenuListProps) {
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

  const itemClassName = (index: number) =>
    `hover:bg-gray-10 flex w-full items-center gap-4 p-4 transition-colors ${index > 0 ? "border-muted border-t" : ""}`

  return (
    <nav aria-label="마이페이지 메뉴">
      <ul className="rounded-lg bg-white shadow-sm">
        {items.map((item, index) => (
          <li key={item.label}>
            {item.action === "logout" ? (
              <button
                type="button"
                onClick={handleLogout}
                disabled={isPending}
                className={itemClassName(index)}
              >
                <ListIcon>
                  {isPending ? <Spinner size="sm" color="gray" /> : item.icon}
                </ListIcon>
                <span className="grow text-left text-base text-gray-800">
                  {item.label}
                </span>
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <Link href={item.path ?? "#"} className={itemClassName(index)}>
                <ListIcon>{item.icon}</ListIcon>
                <span className="grow text-base text-gray-800">
                  {item.label}
                </span>
                <ChevronRight className="h-5 w-5" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
