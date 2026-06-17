"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"

import { CustomButton } from "@/components/shared/custom-buttons"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const CAFE24_MIGRATOR_BASE = "https://almondyoung.com/migrator/confirm.html"
const STORAGE_KEY = "notice:cafe24-link:v1:hideUntil"

interface Cafe24LinkPopupProps {
  countryCode: string
}

export function Cafe24LinkPopup({ countryCode }: Cafe24LinkPopupProps) {
  const t = useTranslations("notice.cafe24Link")
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    const hideUntil = localStorage.getItem(STORAGE_KEY)
    if (hideUntil && Date.now() < Number(hideUntil)) return

    setOpen(true)
  }, [])

  const hideForToday = () => {
    const endOfDay = new Date()
    endOfDay.setHours(23, 59, 59, 999)
    localStorage.setItem(STORAGE_KEY, String(endOfDay.getTime()))
    setOpen(false)
  }

  const handleLink = () => {
    const postUrl = `${window.location.origin}/${countryCode}/mypage/account/cafe24/confirm`
    window.location.href = `${CAFE24_MIGRATOR_BASE}?redirect_to=${encodeURIComponent(postUrl)}`
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[460px]">
        <DialogHeader className="space-y-2.5 px-7 pt-7 text-left">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-primary font-medium">{t("label")}</span>
            <span className="text-gray-300">·</span>
            <span className="text-gray-400">{t("date")}</span>
          </div>
          <DialogTitle className="text-[19px] leading-snug font-bold tracking-tight text-gray-900">
            {t("title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-7 pt-5 pb-7 text-[15px] leading-7 text-gray-600">
          <p>{t("p1")}</p>
          <p>{t("p2")}</p>
          <p>{t("p3")}</p>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-7 py-4">
          <button
            type="button"
            onClick={hideForToday}
            className="text-[13px] text-gray-400 transition-colors hover:text-gray-600"
          >
            {t("hideForToday")}
          </button>
          <CustomButton type="button" size="sm" onClick={handleLink} className="px-5">
            {t("link")}
          </CustomButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
