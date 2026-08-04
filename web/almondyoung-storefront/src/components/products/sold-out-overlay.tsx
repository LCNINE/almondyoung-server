"use client"

import { cn } from "@/lib/utils"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { pickComingSoon } from "@/domains/products/product-details/components/product-actions/coming-soon"
import { pickEarliestRestock } from "@/domains/products/product-details/components/product-actions/restock-notice"
import { HttpTypes } from "@medusajs/types"
import { Calendar } from "lucide-react"
import { useTranslations } from "next-intl"

export function SoldOutOverlay({
  variants,
  comingSoon: comingSoonProp,
  size = "card",
  className,
}: {
  variants?: (HttpTypes.StoreProductVariant | undefined)[] | null
  /** 목록 카드처럼 variants 를 들고 있지 않은 경로에서 미리 계산해 넘긴다. */
  comingSoon?: { date: string | null } | null
  size?: "card" | "detail"
  className?: string
}) {
  const t = useTranslations("productDetail.options")
  // 출시예정이 재입고보다 우선한다 — 아직 한 번도 안 나온 상품에 "재입고" 는 틀린 안내다.
  const comingSoon = comingSoonProp ?? pickComingSoon(variants)
  const restock = !comingSoon && variants ? pickEarliestRestock(variants) : null
  const isDetail = size === "detail"

  if (comingSoon) {
    return (
      <div
        className={cn(
          "absolute inset-0 z-[5] flex items-end justify-center bg-gradient-to-b from-transparent via-transparent to-black/55",
          isDetail ? "pb-6" : "pb-3.5",
          className
        )}
      >
        <span className="flex flex-col items-center text-center text-white">
          <span
            className={cn(
              "font-extrabold tracking-tight [text-shadow:0_1px_1px_rgba(0,0,0,0.22),0_3px_10px_rgba(0,0,0,0.28),0_0_22px_rgba(255,255,255,0.32),0_0_44px_rgba(255,255,255,0.18)]",
              isDetail ? "text-[26px]" : "text-[17px]"
            )}
          >
            {comingSoon.date
              ? t("comingSoonHeadlineDated", {
                  date: formatDate(
                    comingSoon.date,
                    isDetail ? DATE_FORMATS.KO_LONG : DATE_FORMATS.KO_DOT
                  ),
                })
              : t("comingSoonHeadline")}
          </span>
          <span
            className={cn(
              "font-semibold text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.3),0_0_14px_rgba(255,255,255,0.22)]",
              isDetail ? "text-[13px]" : "text-[11px]"
            )}
          >
            {comingSoon.date ? t("comingSoonSubDated") : t("comingSoonSub")}
          </span>
        </span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2 bg-black/45",
        className
      )}
    >
      <span
        className={cn(
          "font-bold text-white drop-shadow-sm",
          isDetail ? "text-2xl" : "text-base"
        )}
      >
        {restock ? t("soldOutTemporary") : t("soldOut")}
      </span>
      {restock && (
        <span
          className={cn(
            "flex items-center gap-1.5 font-medium text-white/90",
            isDetail ? "text-sm" : "text-[11px]"
          )}
        >
          <Calendar
            className={cn("shrink-0", isDetail ? "h-4 w-4" : "h-3 w-3")}
            aria-hidden="true"
          />
          {t("restockExpected", {
            date: formatDate(
              restock.date,
              isDetail ? DATE_FORMATS.KO_LONG : DATE_FORMATS.KO_DOT
            ),
          })}
        </span>
      )}
    </div>
  )
}
