"use client"

import { Button } from "@/components/ui/button"
import { siteConfig } from "@/lib/config/site"
import { useUser } from "@/contexts/user-context"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { showContestToast } from "./contest-toast"

interface JoinPanelProps {
  countryCode: string
  canSubmit: boolean
  upcomingNotice: string
}

export function JoinPanel({
  countryCode,
  canSubmit,
  upcomingNotice,
}: JoinPanelProps) {
  const t = useTranslations("logoContest.entry")
  const tForm = useTranslations("logoContest.form")
  const router = useRouter()
  const { user } = useUser()
  const handleOpen = () => {
    if (!canSubmit) {
      showContestToast(upcomingNotice)
      return
    }
    if (!user) {
      if (window.confirm(tForm("loginRequired"))) {
        const path = "/logo-contest/submit"
        router.push(
          `/${countryCode}${siteConfig.auth.loginUrl}?redirect_to=${encodeURIComponent(path)}`
        )
      }
      return
    }
    router.push(`/${countryCode}/logo-contest/submit`)
  }

  return (
    <Button
      onClick={handleOpen}
      className="bg-primary h-9 w-full rounded-xl px-3 text-xs font-bold text-white shadow-lg sm:h-[52px] sm:w-auto sm:px-8 sm:text-base"
    >
      {t("submit")}
    </Button>
  )
}
