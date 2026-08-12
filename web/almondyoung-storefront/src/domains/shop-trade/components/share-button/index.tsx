"use client"

import { useState } from "react"
import { Check, Share2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

export function ShareButton({ title }: { title: string }) {
  const t = useTranslations("shopTrade")
  const [copied, setCopied] = useState(false)

  const handleShare = async () => {
    const url = window.location.href

    if (navigator.share) {
      try {
        await navigator.share({ title, url })
        return
      } catch {
        // 사용자가 공유 시트를 닫은 경우 — 복사로 넘어간다
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success(t("linkCopied"))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t("shareFailed"))
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleShare()}
      className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors"
    >
      {copied ? (
        <Check className="h-4 w-4" />
      ) : (
        <Share2 className="h-4 w-4" />
      )}
      {t("share")}
    </button>
  )
}
