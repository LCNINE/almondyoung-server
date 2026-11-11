"use client"

import { ArrowRight, Check, PackagePlus, Plus, Sparkles } from "lucide-react"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import type { MemberTierHint, TierRow } from "@/lib/utils/quantity-discount"

type QuantityBundlePickerProps = {
  rows: TierRow[]
  /** 비회원에게 알릴 회원 전용 구간(회원·멤버십가 숨김 상품은 빈 배열) */
  memberHints?: MemberTierHint[]
  hiddenMemberQuantity?: number | null
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

/** 수량별 혜택 비교와 묶음 선택. 회원 전용 혜택은 가입 조건을 별도로 안내한다. */
export default function QuantityBundlePicker({
  rows,
  memberHints = [],
  hiddenMemberQuantity,
  currentPrice,
  quantity = 1,
  onSelect,
  optionLabel,
  className,
}: QuantityBundlePickerProps) {
  const t = useTranslations("productDetail.quantityDiscount")

  if (rows.length === 0 && memberHints.length === 0 && !hiddenMemberQuantity)
    return null

  const options = [
    { quantity: 1, unitPrice: currentPrice, percent: 0 },
    ...rows.map((row) => ({
      quantity: row.minQuantity,
      unitPrice: row.unitPrice,
      percent: row.percent,
    })),
  ]
  const best = rows.at(-1)

  return (
    <section
      className={cn(
        "border-mint-deep/40 bg-mint-tint/50 flex flex-col gap-3 rounded-2xl border-2 p-4",
        className
      )}
      aria-label={t("bundleTitle")}
    >
      <div className="flex items-start gap-3">
        <PackagePlus
          aria-hidden="true"
          className="text-mint-deep mt-0.5 size-6 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground text-base font-bold">
            {t("bundleTitle")}
          </h3>
          <p className="text-foreground mt-1 text-sm">
            {best
              ? t("headline", {
                  count: rows[0].minQuantity,
                  percent: best.percent,
                })
              : t("memberHeadline")}
          </p>
        </div>
      </div>

      <p className="text-muted-foreground text-xs break-words">
        {optionLabel ? t("basisOption", { option: optionLabel }) : t("basis")}
      </p>

      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          {options.map((option) => {
            const total = option.unitPrice * option.quantity
            const saving = currentPrice * option.quantity - total
            const selected = option.quantity === quantity

            const body = (
              <>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    {option.quantity === 1
                      ? t("single")
                      : t("bundle", { count: option.quantity })}
                    {option.quantity === best?.minQuantity && (
                      <span className="bg-primary rounded-full px-2 py-0.5 text-xs text-black">
                        {t("best")}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {t("total", { amount: total.toLocaleString() })}
                  </span>
                  {saving > 0 && (
                    <span className="text-mint-deep text-sm font-semibold tabular-nums">
                      {t("saving", { amount: saving.toLocaleString() })} ·{" "}
                      {option.percent}%
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-foreground text-base font-bold tabular-nums">
                    {t("unitPrice", {
                      amount: option.unitPrice.toLocaleString(),
                    })}
                  </span>
                  {onSelect && (
                    <span className="text-mint-deep flex items-center gap-1 text-xs font-semibold">
                      {selected ? (
                        <Check aria-hidden="true" className="size-3.5" />
                      ) : (
                        <Plus aria-hidden="true" className="size-3.5" />
                      )}
                      {t(selected ? "selected" : "selectBundle")}
                    </span>
                  )}
                </div>
              </>
            )

            const cardClass = cn(
              "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left",
              selected && onSelect
                ? "border-mint-deep bg-mint-tint ring-mint-deep ring-1"
                : "border-border bg-background"
            )

            return onSelect ? (
              <button
                key={option.quantity}
                type="button"
                data-bundle-quantity={option.quantity}
                aria-pressed={selected}
                className={cn(
                  cardClass,
                  "hover:border-mint-deep focus-visible:ring-ring cursor-pointer transition-colors focus-visible:ring-2"
                )}
                onClick={() => onSelect(option.quantity)}
              >
                {body}
              </button>
            ) : (
              <div
                key={option.quantity}
                data-bundle-quantity={option.quantity}
                className={cardClass}
              >
                {body}
              </div>
            )
          })}
        </div>
      )}

      {(memberHints.length > 0 || hiddenMemberQuantity) && (
        <div className="border-primary/40 bg-background flex flex-col gap-3 rounded-xl border p-3">
          <p className="text-mint-deep flex items-center gap-2 text-sm font-bold">
            <Sparkles aria-hidden="true" className="size-4 shrink-0" />
            {t("memberBundleTitle")}
          </p>
          {hiddenMemberQuantity && (
            <p className="text-mint-deep text-sm font-semibold">
              {t("hiddenMemberOffer", { count: hiddenMemberQuantity })}
            </p>
          )}
          {memberHints.map((hint) => (
            <div
              key={hint.minQuantity}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
            >
              <span className="text-sm font-medium">
                {t("minQuantity", { count: hint.minQuantity })}
              </span>
              <span className="text-mint-deep text-base font-bold tabular-nums">
                {t("unitPrice", { amount: hint.unitPrice.toLocaleString() })}
              </span>
              <span className="text-muted-foreground w-full text-right text-xs tabular-nums">
                {t("bundleTotal", {
                  count: hint.minQuantity,
                  amount: (hint.unitPrice * hint.minQuantity).toLocaleString(),
                })}
              </span>
            </div>
          ))}
          <p className="text-muted-foreground text-xs">
            {t("memberCondition")}
          </p>
          <LocalizedClientLink
            href="/mypage/membership"
            className="bg-primary flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-sm font-bold text-black"
          >
            {t("joinForBundle")}
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </LocalizedClientLink>
        </div>
      )}

      {rows.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {t(onSelect ? "automaticDiscount" : "chooseOptionFirst")}
        </p>
      )}
    </section>
  )
}
