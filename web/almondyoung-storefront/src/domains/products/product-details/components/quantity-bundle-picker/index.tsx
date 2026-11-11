"use client"

import { ArrowRight, Check, PackagePlus, Plus, Sparkles } from "lucide-react"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import type { MemberTierHint, TierRow } from "@/lib/utils/quantity-discount"

type QuantityBundlePickerProps = {
  rows: TierRow[]
  memberHints?: MemberTierHint[]
  hiddenMemberQuantity?: number | null
  currentPrice: number
  /** 회원 묶음의 절약액을 계산할 1개 기준 회원가. */
  memberBasePrice?: number
  quantity?: number
  onSelect?: (quantity: number) => void
  optionLabel?: string
  className?: string
}

export default function QuantityBundlePicker({
  rows,
  memberHints = [],
  hiddenMemberQuantity,
  currentPrice,
  memberBasePrice,
  quantity = 1,
  onSelect,
  optionLabel,
  className,
}: QuantityBundlePickerProps) {
  const t = useTranslations("productDetail.quantityDiscount")
  const memberOnly = rows.length === 0
  const best = rows.at(-1)

  if (!rows.length && !memberHints.length && !hiddenMemberQuantity) return null

  return (
    <section
      className={cn(
        "border-mint-deep/40 bg-mint-tint/50 flex flex-col gap-3 rounded-2xl border-2 p-4",
        className
      )}
      aria-label={t(memberOnly ? "memberBundleTitle" : "bundleTitle")}
    >
      <div className="flex items-start gap-3">
        <PackagePlus
          aria-hidden="true"
          className="text-mint-deep mt-0.5 size-6 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground text-base font-bold">
            {t(memberOnly ? "memberBundleTitle" : "bundleTitle")}
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
        <BundlePriceCards
          rows={rows}
          currentPrice={currentPrice}
          quantity={quantity}
          onSelect={onSelect}
        />
      )}

      {(memberHints.length > 0 || hiddenMemberQuantity) && (
        <div
          className={cn(
            "flex flex-col gap-3",
            !memberOnly &&
              "border-primary/40 bg-background rounded-xl border p-3"
          )}
        >
          {!memberOnly && (
            <p className="text-mint-deep flex items-center gap-2 text-sm font-bold">
              <Sparkles aria-hidden="true" className="size-4 shrink-0" />
              {t("memberBundleTitle")}
            </p>
          )}
          {hiddenMemberQuantity ? (
            <p className="text-mint-deep text-sm font-semibold">
              {t("hiddenMemberOffer", { count: hiddenMemberQuantity })}
            </p>
          ) : (
            <>
              <p className="text-mint-deep text-sm font-semibold">
                {t("memberPricePreview")}
              </p>
              <BundlePriceCards
                rows={memberHints}
                currentPrice={memberBasePrice ?? currentPrice}
                memberOffer
              />
            </>
          )}
          <p className="text-foreground text-sm">{t("memberCondition")}</p>
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
          {t(onSelect ? "automaticDiscount" : "previewPurchaseHint")}
        </p>
      )}
    </section>
  )
}

type BundlePriceCardsProps = {
  rows: TierRow[]
  currentPrice: number
  quantity?: number
  onSelect?: (quantity: number) => void
  memberOffer?: boolean
}

function BundlePriceCards({
  rows,
  currentPrice,
  quantity,
  onSelect,
  memberOffer = false,
}: BundlePriceCardsProps) {
  const t = useTranslations("productDetail.quantityDiscount")
  const options = [
    { minQuantity: 1, unitPrice: currentPrice, percent: 0 },
    ...rows,
  ]
  const bestQuantity = rows.at(-1)?.minQuantity

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {options.map((option) => {
        const count = option.minQuantity
        const total = option.unitPrice * count
        const saving = Math.max(0, (currentPrice - option.unitPrice) * count)
        const selected = count === quantity
        const className = cn(
          "flex min-w-0 flex-col items-start gap-2 rounded-xl border bg-background px-3 py-3 text-left",
          onSelect && selected
            ? "border-mint-deep bg-mint-tint ring-mint-deep ring-1"
            : "border-border"
        )

        const body = (
          <>
            <span className="flex min-h-5 flex-wrap items-center gap-1 text-sm font-bold">
              {count === 1 ? t("single") : t("bundle", { count })}
              {count === bestQuantity && (
                <span className="bg-primary rounded-full px-2 py-0.5 text-xs text-black">
                  {t("best")}
                </span>
              )}
            </span>
            <span className="text-foreground text-base font-bold break-words tabular-nums">
              {t("unitPrice", { amount: option.unitPrice.toLocaleString() })}
            </span>
            <span className="text-muted-foreground text-xs break-words tabular-nums">
              {t("bundleTotal", { count, amount: total.toLocaleString() })}
            </span>
            {saving > 0 && (
              <span className="text-mint-deep text-sm font-semibold tabular-nums">
                {t("saving", { amount: saving.toLocaleString() })}
              </span>
            )}
            {onSelect && (
              <span className="text-mint-deep mt-auto flex items-center gap-1 pt-1 text-xs font-semibold">
                {selected ? (
                  <Check aria-hidden="true" className="size-3.5 shrink-0" />
                ) : (
                  <Plus aria-hidden="true" className="size-3.5 shrink-0" />
                )}
                {t(selected ? "selected" : "selectBundle")}
              </span>
            )}
          </>
        )

        return onSelect ? (
          <button
            key={count}
            type="button"
            data-bundle-quantity={count}
            aria-pressed={selected}
            className={cn(
              className,
              "hover:border-mint-deep focus-visible:ring-ring cursor-pointer transition-colors focus-visible:ring-2"
            )}
            onClick={() => onSelect(count)}
          >
            {body}
          </button>
        ) : (
          <div
            key={count}
            data-bundle-quantity={memberOffer ? undefined : count}
            data-member-bundle-quantity={memberOffer ? count : undefined}
            className={className}
          >
            {body}
          </div>
        )
      })}
    </div>
  )
}
