"use client"

import { cn } from "@/lib/utils"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { pickEarliestRestock } from "@/domains/products/product-details/components/product-actions/restock-notice"
import { HttpTypes } from "@medusajs/types"
import { Calendar } from "lucide-react"
import { useTranslations } from "next-intl"

export function SoldOutOverlay({
  variants,
  size = "card",
  className,
}: {
  variants?: (HttpTypes.StoreProductVariant | undefined)[] | null
  size?: "card" | "detail"
  className?: string
}) {
  const t = useTranslations("productDetail.options")
  const restock = variants ? pickEarliestRestock(variants) : null
  const isDetail = size === "detail"

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
