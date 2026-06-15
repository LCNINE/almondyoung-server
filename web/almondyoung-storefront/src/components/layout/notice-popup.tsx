"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * 일회성 공지 팝업.
 *
 * - 스토어프론트 진입 시 1회 노출되는 단순 안내 팝업.
 * - "오늘 하루 보지 않기" 를 누르면 해당 브라우저(=그 기기) localStorage 에
 *   숨김 만료 시각을 저장해 자정까지 다시 뜨지 않음
 * - 공지 내용을 바꿔 다시 모두에게 노출하고 싶으면 STORAGE_KEY 의 버전(v1)을 올린다.
 */
const STORAGE_KEY = "notice:signup-renewal:v1:hideUntil"

export function NoticePopup() {
  const t = useTranslations("notice.signupRenewal")
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    const hideUntil = localStorage.getItem(STORAGE_KEY)
    if (hideUntil && Date.now() < Number(hideUntil)) return

    setOpen(true)
  }, [])

  const hideForToday = () => {
    // 오늘 자정까지 숨김
    const endOfDay = new Date()
    endOfDay.setHours(23, 59, 59, 999)
    localStorage.setItem(STORAGE_KEY, String(endOfDay.getTime()))
    setOpen(false)
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
          <p>{t("greeting")}</p>
          <p>{t("p1")}</p>
          <p>
            {t("p2")}
            <br />
            {t("p3")}
          </p>
          <p>{t("p4")}</p>
          <p>{t("p5")}</p>
          <p>{t("p6")}</p>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-7 py-4">
          <button
            type="button"
            onClick={hideForToday}
            className="text-[13px] text-gray-400 transition-colors hover:text-gray-600"
          >
            {t("hideForToday")}
          </button>
          <Button type="button" onClick={() => setOpen(false)} className="px-6">
            {t("close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
