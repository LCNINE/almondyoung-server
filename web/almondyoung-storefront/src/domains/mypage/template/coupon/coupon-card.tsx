"use client"

import { useState } from "react"
import type { Promotion } from "@/lib/types/ui/promotion"
import { Copy, Check } from "lucide-react"

export function CouponCard({
  promo,
  expiry,
}: {
  promo: Promotion
  expiry: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(promo.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <li className="relative overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="flex items-stretch">
        <div className="flex w-28 shrink-0 flex-col items-center justify-center bg-amber-50 px-3 py-5">
          <span className="text-2xl font-bold text-amber-600 tabular-nums leading-tight">
            {promo.application_method?.type === "percentage"
              ? `${promo.application_method.value}%`
              : `${(promo.application_method?.value ?? 0).toLocaleString("ko-KR")}원`}
          </span>
          <span className="mt-1 text-xs text-amber-600/70">할인</span>
        </div>

        <div className="flex flex-1 items-center justify-between gap-2 px-4 py-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-stone-800">
                {promo.code}
              </span>
              {promo.is_assigned && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  전용 쿠폰
                </span>
              )}
            </div>
            <p className="text-xs text-stone-500">{expiry}</p>
          </div>

          <button
            onClick={handleCopy}
            className="shrink-0 rounded-lg border border-stone-200 p-1.5 text-stone-400 transition-colors hover:border-amber-300 hover:text-amber-600"
            aria-label="쿠폰 코드 복사"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div className="absolute left-[112px] top-0 h-full w-px border-l border-dashed border-stone-200" />
    </li>
  )
}
