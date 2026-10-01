"use client"

import { useTranslations } from "next-intl"
import Image from "next/image"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

export function ComingSoonPopup() {
  const t = useTranslations("home.comingSoon")
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (searchParams.get("comingSoon") !== "almond-template") return
    setOpen(true)
    const url = new URL(window.location.href)
    url.searchParams.delete("comingSoon")
    window.history.replaceState(null, "", url.pathname + url.search)
  }, [searchParams])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => setOpen(false), 2500)
    return () => clearTimeout(timer)
  }, [open])

  if (!open) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <button
        type="button"
        role="status"
        onClick={() => setOpen(false)}
        className="animate-in fade-in zoom-in-95 pointer-events-auto flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-left shadow-lg ring-1 ring-black/5 duration-200"
      >
        <Image
          src="/images/almond-template-palette.png"
          alt=""
          width={32}
          height={32}
        />
        <span>
          <span className="text-foreground block text-[15px] font-bold">
            {t("title")}
          </span>
          <span className="text-muted-foreground block text-[13px]">
            {t("description")}
          </span>
        </span>
      </button>
    </div>
  )
}
