"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { currentTierIndex, type TierRow } from "@/lib/utils/quantity-discount"

const VISIBLE_ROWS = 3

type QuantityDiscountTableProps = {
  rows: TierRow[]
  /** 고른 수량 — 그 수량이 닿은 구간을 강조한다 */
  quantity?: number
  /** 옵션이 여럿일 때 어느 옵션 가격 기준인지 */
  optionLabel?: string
  className?: string
}

export default function QuantityDiscountTable({
  rows,
  quantity = 0,
  optionLabel,
  className,
}: QuantityDiscountTableProps) {
  const t = useTranslations("productDetail.quantityDiscount")
  const [expanded, setExpanded] = useState(false)

  if (rows.length === 0) return null

  const current = currentTierIndex(quantity, rows)
  const visible = expanded ? rows : rows.slice(0, VISIBLE_ROWS)

  return (
    <section
      className={cn("rounded-lg border border-border bg-muted px-4 py-3", className)}
      aria-label={t("title")}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">{t("title")}</h3>
        <span className="text-xs text-muted-foreground">
          {optionLabel ? t("basisOption", { option: optionLabel }) : t("basis")}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {visible.map((row, index) => {
          const isCurrent = index === current
          return (
            <li
              key={row.minQuantity}
              data-current={isCurrent ? "true" : "false"}
              className={cn(
                "flex flex-wrap items-baseline justify-between gap-x-2 rounded-lg px-2 py-1 text-sm",
                isCurrent && "bg-background font-bold"
              )}
            >
              <span>{t("minQuantity", { count: row.minQuantity })}</span>
              <span className="flex items-baseline gap-2">
                <span className="tabular-nums">
                  {t("unitPrice", { amount: row.unitPrice.toLocaleString() })}
                </span>
                <span className="text-destructive">{t("percent", { percent: row.percent })}</span>
              </span>
              {row.memberUnitPrice !== undefined && (
                <span className="basis-full text-right text-xs text-muted-foreground">
                  {t("memberOnly", { amount: row.memberUnitPrice.toLocaleString() })}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {rows.length > VISIBLE_ROWS && (
        <button
          type="button"
          className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t("less") : t("more", { count: rows.length - VISIBLE_ROWS })}
        </button>
      )}
    </section>
  )
}
