"use client"

import { useState, useTransition } from "react"
import type { Promotion } from "@/lib/types/ui/promotion"
import { formatPrice } from "@/lib/utils/price-utils"
import { couponName, discountParts, shouldShowCap } from "@/lib/utils/coupon-discount"
import { Copy, Check } from "lucide-react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

export function CouponCard({
  promo,
  expiry,
  onClaim,
  expired = false,
  badgeLabel,
}: {
  promo: Promotion
  expiry: string
  onClaim?: () => Promise<void>
  /** 「지난 쿠폰」 스타일(흐림 + 배지, 발급 버튼 없음). 만료·사용완료 탭이 공유한다. */
  expired?: boolean
  /**
   * 배지 문구를 갈아끼운다. 기본값은 「만료됨」 (#488 A1 — 사용완료 탭이 같은 카드를
   * 쓰면서 배지만 「사용완료」로 바꾼다). `expired` 가 false 면 배지 자체가 없으므로 무시된다.
   */
  badgeLabel?: string
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

  // 레일은 숫자와 단위를 나눠 싣는다 (#790) — 「1,000원」이 한 덩어리로 들어가 88px 를
  // 넘겨 접혔다. 「할인」 줄에 단위 글자가 합류할 뿐이라 카드 높이는 변하지 않는다.
  const parts = discountParts(promo.application_method)
  const unitLabel = parts
    ? parts.unit === "percent"
      ? t("unitPercentDiscount")
      : t("unitWonDiscount")
    : t("discount")

  // #789. 이름이 있으면 그것이 제목이고, 코드는 아래 부제로 내려간다. 이름이 없으면
  // 지금까지의 화면 그대로다 — 「받기 전」엔 코드가 쓸모없어 할인 라벨을 대신 보여준다.
  const name = couponName(promo.name)
  const title = name ?? (onClaim ? discountLabel : promo.code)

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
            className={`whitespace-nowrap text-2xl font-bold tabular-nums leading-tight ${
              expired ? "text-stone-400" : "text-amber-600"
            }`}
          >
            {parts?.value ?? discountLabel}
          </span>
          <span className={`mt-1 text-xs ${expired ? "text-stone-400" : "text-amber-600/70"}`}>
            {unitLabel}
          </span>
          {shouldShowCap(promo.application_method, promo.max_discount_amount) && (
            <span
              className={`mt-0.5 text-[10px] leading-tight ${
                expired ? "text-stone-400" : "text-amber-600/70"
              }`}
            >
              {t("maxCap", {
                amount: formatPrice(promo.max_discount_amount as number),
              })}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-4 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              {/* 제목이 이름이면 sans 체다 — 코드일 때만 mono 로 「기계가 읽는 값」임을 드러낸다.
                  `truncate` 가 없으면 긴 이름이 카드를 밀어 #790 과 같은 종류로 무너진다. */}
              <span
                className={`min-w-0 truncate text-sm font-semibold ${name ? "" : "font-mono"} ${
                  expired ? "text-stone-400" : "text-stone-800"
                }`}
              >
                {title}
              </span>
              {!expired && promo.is_assigned && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  {t("exclusive")}
                </span>
              )}
            </div>
            {/* 제목이 이름으로 올라갔을 때만 코드를 부제로 남긴다 — 이름이 없으면 제목이
                이미 코드라, 같은 문자열이 두 줄로 찍힌다. */}
            {name && (
              <p
                className={`truncate font-mono text-xs ${
                  expired ? "text-stone-400" : "text-stone-500"
                }`}
              >
                {promo.code}
              </p>
            )}
            <p className={`text-xs ${expired ? "text-stone-400" : "text-stone-500"}`}>{expiry}</p>
          </div>

          {expired ? (
            <span className="shrink-0 rounded-full bg-stone-200 px-2.5 py-1 text-[11px] font-medium text-stone-500">
              {badgeLabel ?? t("expiredBadge")}
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
