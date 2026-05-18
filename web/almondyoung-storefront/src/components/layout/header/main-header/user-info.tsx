"use client"

import { Spinner } from "@/components/shared/spinner"
import { useUser } from "@/contexts/user-context"
import { signout } from "@/lib/api/users/signout"
import { useTranslations } from "next-intl"
import { useTransition } from "react"

export function UserInfo() {
  const [isPending, startTransition] = useTransition()
  const { user, setUser } = useUser()
  const t = useTranslations("header.userInfo")

  const handleLogout = () => {
    startTransition(async () => {
      setUser(null)
      await signout()
    })
  }

  if (!user) return null

  const nickname = user.nickname
  const displayName =
    nickname.length > 5 ? `${nickname.slice(0, 5)}...` : nickname

  return (
    <div className="flex items-center gap-2">
      <strong className="text-sm">{displayName}</strong>

      <button
        type="button"
        onClick={handleLogout}
        disabled={isPending}
        className="cursor-pointer disabled:opacity-50"
      >
        {isPending ? <Spinner size="sm" color="gray" /> : t("logout")}
      </button>
    </div>
  )
}
