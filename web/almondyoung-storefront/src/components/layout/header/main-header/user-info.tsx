"use client"

import { Spinner } from "@/components/shared/spinner"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { useUser } from "@/contexts/user-context"
import { signout } from "@/lib/api/users/signout"
import { notifyAppLogout } from "@/lib/app-context/notify-app"
import { useTranslations } from "next-intl"
import { useTransition } from "react"

export function MobileAuthLinks() {
  const { user } = useUser()
  const t = useTranslations("header.utility")

  if (user) return <UserInfo mobile />

  return (
    <>
      <LocalizedClientLink href="/login">{t("login")}</LocalizedClientLink>
      <LocalizedClientLink href="/signup">{t("signup")}</LocalizedClientLink>
    </>
  )
}

export function UserInfo({ mobile = false }: { mobile?: boolean }) {
  const [isPending, startTransition] = useTransition()
  const { user, setUser } = useUser()
  const t = useTranslations("header.userInfo")

  const handleLogout = () => {
    startTransition(async () => {
      setUser(null)
      notifyAppLogout()
      await signout()
    })
  }

  if (!user) return null

  const nickname = user.nickname
  const displayName =
    nickname.length > 5 ? `${nickname.slice(0, 5)}...` : nickname

  return (
    <div className="flex items-center gap-2">
      <span>
        <strong className={mobile ? "text-white" : "text-sm"}>
          {displayName}
        </strong>
        {mobile && t("nameSuffix") && ` ${t("nameSuffix")}`}
      </span>

      <button
        type="button"
        onClick={handleLogout}
        disabled={isPending}
        className={
          mobile
            ? "cursor-pointer border border-white/40 px-1.5 py-px disabled:opacity-50"
            : "cursor-pointer disabled:opacity-50"
        }
      >
        {isPending ? <Spinner size="sm" color="gray" /> : t("logout")}
      </button>
    </div>
  )
}
