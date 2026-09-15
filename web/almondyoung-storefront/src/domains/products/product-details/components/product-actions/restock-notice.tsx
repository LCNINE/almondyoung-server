"use client"

import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { pickComingSoon } from "./coming-soon"
import { pickEarliestRestock } from "./restock"
import { HttpTypes } from "@medusajs/types"
import { Calendar } from "lucide-react"
import { useTranslations } from "next-intl"

interface Props {
  variants: (HttpTypes.StoreProductVariant | undefined)[]
}

// 품절 버튼 대신 안내를 띄울지 판정한다. 출시예정과 재입고예정 둘 중 하나라도 있으면 안내 쪽.
export function hasStockNotice(variants: Props["variants"]) {
  return Boolean(pickComingSoon(variants) ?? pickEarliestRestock(variants))
}

/**
 * 상세페이지 품절 시 "일시 품절 + 재입고 예정" 안내.
 */
export function RestockNotice({ variants }: Props) {
  const t = useTranslations("productDetail.options")
  // 출시예정이 재입고보다 우선 — 아직 한 번도 안 나온 상품에 "재입고" 는 틀린 안내다.
  const comingSoon = pickComingSoon(variants)

  if (comingSoon) {
    return (
      <div className="bg-yellow-30 flex h-12 w-full items-center justify-center gap-2 rounded-lg px-4">
        <Calendar className="h-5 w-5 shrink-0 text-white" aria-hidden="true" />
        <span className="text-[15px] font-bold text-white">
          {comingSoon.date
            ? t("comingSoonDated", {
                date: formatDate(comingSoon.date, DATE_FORMATS.KO_LONG),
              })
            : t("comingSoon")}
        </span>
      </div>
    )
  }

  const restock = pickEarliestRestock(variants)
  if (!restock) return null

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <span className="text-[15px] font-bold text-gray-800">
        {t("soldOutTemporary")}
      </span>
      <div className="bg-yellow-30 flex h-12 w-full items-center justify-center gap-2 rounded-lg px-4">
        <Calendar className="h-5 w-5 shrink-0 text-white" aria-hidden="true" />
        <span className="text-[15px] font-bold text-white">
          {t("restockExpected", {
            date: formatDate(restock.date, DATE_FORMATS.KO_LONG),
          })}
        </span>
      </div>
      {restock.approximate && (
        <span className="text-[11px] leading-tight text-gray-400">
          {t("restockApproximate")}
        </span>
      )}
    </div>
  )
}
