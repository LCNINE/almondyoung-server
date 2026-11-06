"use client"

import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import type { MemberTierHint, TierRow } from "@/lib/utils/quantity-discount"

type QuantityBundlePickerProps = {
  rows: TierRow[]
  /** 비회원에게 알릴 회원 전용 구간(회원·멤버십가 숨김 상품은 빈 배열) */
  memberHints?: MemberTierHint[]
  /** 1개 기준 지금 가격 */
  currentPrice: number
  /** 고른 수량 — 같은 수량의 카드를 선택 상태로 보인다 */
  quantity?: number
  /** 없으면 보여주기만 한다(수량을 바꿀 수 없는 자리) */
  onSelect?: (quantity: number) => void
  /** 옵션이 여럿일 때 어느 옵션 가격 기준인지 */
  optionLabel?: string
  className?: string
}

/** «1개 / N개 묶음» 카드. 기본 선택은 1개이고, 카드를 누르면 그 묶음 수량으로 바꾼다. */
export default function QuantityBundlePicker({
  rows,
  memberHints = [],
  currentPrice,
  quantity = 1,
  onSelect,
  optionLabel,
  className,
}: QuantityBundlePickerProps) {
  const t = useTranslations("productDetail.quantityDiscount")
  if (rows.length === 0 && memberHints.length === 0) return null

  const memberHintLine = memberHints.length > 0 && (
    <p className="text-muted-foreground text-xs">
      {t("memberHint", {
        items: memberHints
          .map((hint) => t("memberHintItem", { count: hint.minQuantity, amount: hint.unitPrice.toLocaleString() }))
          .join(" · "),
      })}
    </p>
  )

  if (rows.length === 0) {
    return <div className={cn("flex flex-col gap-1", className)}>{memberHintLine}</div>
  }

  const options = [
    { quantity: 1, unitPrice: currentPrice, percent: 0 },
    ...rows.map((row) => ({ quantity: row.minQuantity, unitPrice: row.unitPrice, percent: row.percent })),
  ]
  const lastQuantity = options[options.length - 1].quantity

  return (
    <section className={cn("flex flex-col gap-2", className)} aria-label={t("bundleTitle")}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold">{t("bundleTitle")}</h3>
        <span className="text-muted-foreground text-xs">
          {optionLabel ? t("basisOption", { option: optionLabel }) : t("basis")}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => {
          const total = option.unitPrice * option.quantity
          const saving = currentPrice * option.quantity - total
          const selected = option.quantity === quantity
          const body = (
            <>
              <span className="text-sm font-bold">
                {option.quantity === 1 ? t("single") : t("bundle", { count: option.quantity })}
              </span>
              <span className="text-base font-bold tabular-nums">
                {t("total", { amount: total.toLocaleString() })}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t("unitPrice", { amount: option.unitPrice.toLocaleString() })}
              </span>
              {saving > 0 && (
                <span className="text-xs font-medium tabular-nums">
                  {t("saving", { amount: saving.toLocaleString() })} · {option.percent}%
                </span>
              )}
              {option.quantity === lastQuantity && option.quantity > 1 && (
                <span className="text-primary text-xs font-medium">{t("best")}</span>
              )}
            </>
          )
          const cardClass = cn(
            "flex min-h-24 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left",
            selected ? "border-primary bg-yellow-10" : "border-border bg-background"
          )
          return onSelect ? (
            <button
              key={option.quantity}
              type="button"
              data-bundle-quantity={option.quantity}
              aria-pressed={selected}
              className={cn(cardClass, "focus-visible:ring-ring transition-colors duration-150 focus-visible:ring-2")}
              onClick={() => onSelect(option.quantity)}
            >
              {body}
            </button>
          ) : (
            <div key={option.quantity} data-bundle-quantity={option.quantity} data-selected={selected} className={cardClass}>
              {body}
            </div>
          )
        })}
      </div>
      {memberHintLine}
    </section>
  )
}
