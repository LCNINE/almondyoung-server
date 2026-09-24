"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { siteConfig } from "@/lib/config/site"
import { getPathWithoutCountry } from "@/lib/utils/get-path-without-country"
import { useUser } from "@/contexts/user-context"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { showContestToast } from "./contest-toast"
import { EntryForm } from "./entry-form"

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
  const [formOpen, setFormOpen] = useState(false)

  const handleOpen = () => {
    if (!canSubmit) {
      showContestToast(upcomingNotice)
      return
    }
    if (!user) {
      if (window.confirm(tForm("loginRequired"))) {
        const path = getPathWithoutCountry(countryCode)
        router.push(
          `/${countryCode}${siteConfig.auth.loginUrl}?redirect_to=${encodeURIComponent(path)}`
        )
      }
      return
    }
    setFormOpen(true)
  }

  return (
    <>
      <Button
        onClick={handleOpen}
        className="bg-primary h-9 w-full rounded-xl px-3 text-xs font-bold text-white shadow-lg sm:h-[52px] sm:w-auto sm:px-8 sm:text-base"
      >
        {t("submit")}
      </Button>
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-[640px]"
        >
          <DialogTitle className="sr-only">{tForm("title")}</DialogTitle>
          <EntryForm onClose={() => setFormOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}
