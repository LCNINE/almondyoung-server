"use client"

import { Spinner } from "@/components/shared/spinner"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { useUser } from "@/contexts/user-context"
import { signout } from "@/lib/api/users/signout"
import { notifyAppLogout } from "@/lib/app-context/notify-app"
import { useTranslations } from "next-intl"
import { useTransition } from "react"

const LINK_CLASS_NAME = "hover:text-foreground transition-colors"

export function UserInfo() {
  const [isPending, startTransition] = useTransition()
  const { user, setUser } = useUser()
  const t = useTranslations("header")

  const handleLogout = () => {
    startTransition(async () => {
      setUser(null)
      notifyAppLogout()
      await signout()
    })
  }

  if (!user) {
    return (
      <>
        <LocalizedClientLink href="/login" className={LINK_CLASS_NAME}>
          {t("utility.login")}
        </LocalizedClientLink>
        <LocalizedClientLink href="/signup" className={LINK_CLASS_NAME}>
          {t("utility.signup")}
        </LocalizedClientLink>
      </>
    )
  }

  const nickname = user.nickname
  const displayName =
    nickname.length > 5 ? `${nickname.slice(0, 5)}...` : nickname

  return (
    <div className="flex items-center gap-2">
      <strong className="text-foreground font-semibold">{displayName}</strong>

      <button
        type="button"
        onClick={handleLogout}
        disabled={isPending}
        className={`${LINK_CLASS_NAME} cursor-pointer disabled:opacity-50`}
      >
        {isPending ? <Spinner size="sm" color="gray" /> : t("userInfo.logout")}
      </button>
    </div>
  )
}
