"use client"

import { useState, useTransition } from "react"
import type { Promotion } from "@/lib/types/ui/promotion"
import { formatPrice } from "@/lib/utils/price-utils"
import { Copy, Check } from "lucide-react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export function CouponCard({
  promo,
  expiry,
  onClaim,
  expired = false,
}: {
  promo: Promotion
  expiry: string
  onClaim?: () => Promise<void>
  expired?: boolean
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
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        // UNAUTHORIZED는 삼키지 않고 re-throw → error.tsx 토큰 복구 처리
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(t("toasts.claimFailed"))
      }
    })
  }

  const discountLabel =
    promo.application_method?.type === "percentage"
      ? t("percentValue", { value: promo.application_method.value })
      : t("amountValue", {
          amount: formatPrice(promo.application_method?.value ?? 0),
        })

  return (
    <li
      className={`relative overflow-hidden rounded-2xl border shadow-sm ${
        expired ? "border-stone-200 bg-stone-50" : "border-stone-200 bg-white"
      }`}
    >
      <div className="flex items-stretch">
        <div
          className={`flex w-28 shrink-0 flex-col items-center justify-center px-3 py-5 ${
            expired ? "bg-stone-100" : "bg-amber-50"
          }`}
        >
          <span
            className={`text-2xl font-bold tabular-nums leading-tight ${
              expired ? "text-stone-400" : "text-amber-600"
            }`}
          >
            {discountLabel}
          </span>
          <span className={`mt-1 text-xs ${expired ? "text-stone-400" : "text-amber-600/70"}`}>
            {t("discount")}
          </span>
        </div>

        <div className="flex flex-1 items-center justify-between gap-2 px-4 py-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span
                className={`font-mono text-sm font-semibold ${
                  expired ? "text-stone-400" : "text-stone-800"
                }`}
              >
                {onClaim ? discountLabel : promo.code}
              </span>
              {!expired && promo.is_assigned && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  {t("exclusive")}
                </span>
              )}
            </div>
            <p className={`text-xs ${expired ? "text-stone-400" : "text-stone-500"}`}>{expiry}</p>
          </div>

          {expired ? (
            <span className="shrink-0 rounded-full bg-stone-200 px-2.5 py-1 text-[11px] font-medium text-stone-500">
              {t("expiredBadge")}
            </span>
          ) : onClaim ? (
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
