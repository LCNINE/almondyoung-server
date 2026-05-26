"use client"

import { useState, useTransition } from "react"
import type { Promotion } from "@/lib/types/ui/promotion"
import { Copy, Check } from "lucide-react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export function CouponCard({
  promo,
  expiry,
  onClaim,
}: {
  promo: Promotion
  expiry: string
  onClaim?: () => Promise<void>
}) {
  const t = useTranslations("mypage.coupon")
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [claimed, setClaimed] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleCopy = async () => {
    await navigator.clipboard.writeText(promo.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClaim = () => {
    if (!onClaim) return
    startTransition(async () => {
      try {
        await onClaim()
        setClaimed(true)
        toast.success(t("toasts.claimSuccess"))
        router.refresh()
      } catch {
        toast.error(t("toasts.claimFailed"))
      }
    })
  }

  const discountLabel =
    promo.application_method?.type === "percentage"
      ? `${promo.application_method.value}%`
      : `${(promo.application_method?.value ?? 0).toLocaleString("ko-KR")}원`

  return (
    <li className="relative overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="flex items-stretch">
        <div className="flex w-28 shrink-0 flex-col items-center justify-center bg-amber-50 px-3 py-5">
          <span className="text-2xl font-bold text-amber-600 tabular-nums leading-tight">
            {discountLabel}
          </span>
          <span className="mt-1 text-xs text-amber-600/70">{t("discount")}</span>
        </div>

        <div className="flex flex-1 items-center justify-between gap-2 px-4 py-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-stone-800">
                {onClaim ? discountLabel : promo.code}
              </span>
              {promo.is_assigned && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  {t("exclusive")}
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500">{expiry}</p>
          </div>

          {onClaim ? (
            <button
              onClick={handleClaim}
              disabled={isPending || claimed}
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {claimed ? t("claimed") : isPending ? t("claiming") : t("claimButton")}
            </button>
          ) : (
            <button
              onClick={handleCopy}
              className="shrink-0 rounded-lg border border-stone-200 p-1.5 text-stone-400 transition-colors hover:border-amber-300 hover:text-amber-600"
              aria-label={t("copyAria")}
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>

      <div className="absolute left-[112px] top-0 h-full w-px border-l border-dashed border-stone-200" />
    </li>
  )
}
