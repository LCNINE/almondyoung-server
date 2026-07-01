import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { getPricesForVariant } from "@/lib/utils/get-product-price"
import { HttpTypes } from "@medusajs/types"
import { useMemo } from "react"
import { useTranslations } from "next-intl"

// 표시할 옵션 값이 이 개수를 초과하면 칩 대신 드롭다운으로 전환
const DROPDOWN_THRESHOLD = 8

interface OptionSelectProps {
  option: HttpTypes.StoreProductOption
  current?: string
  updateOption: (optionId: string, value: string) => void
  title: string
  disabled?: boolean
  variants?: HttpTypes.StoreProductVariant[] | null
  selectedOptions?: Record<string, string | undefined>
  selectedValues?: Set<string>
}

type VariantOptionsMap = Record<string, string>

function toOptionsMap(
  options: HttpTypes.StoreProductVariant["options"]
): VariantOptionsMap {
  if (!options) return {}
  return Object.fromEntries(options.map((o) => [o.option_id, o.value]))
}

function hasStock(variant: HttpTypes.StoreProductVariant): boolean {
  if (!variant.manage_inventory || variant.allow_backorder) return true
  return (variant.inventory_quantity ?? 0) > 0
}

function getButtonStyle(isCurrent: boolean, isOutOfStock: boolean): string {
  if (isOutOfStock) return "border-gray-200 bg-gray-100 text-gray-400"
  if (isCurrent) return "border-primary bg-primary text-primary-foreground"
  return "border-gray-200 hover:border-gray-400"
}

export default function OptionSelect({
  option,
  current,
  updateOption,
  title,
  disabled,
  variants,
  selectedOptions,
  selectedValues,
}: OptionSelectProps) {
  const t = useTranslations("productDetail.options")
  const { visibleValues, outOfStockSet, priceByValue } = useMemo(() => {
    const allValues = (option.values ?? []).map((v) => v.value)
    if (!variants) {
      return {
        visibleValues: allValues,
        outOfStockSet: new Set<string>(),
        priceByValue: {} as Record<string, number>,
      }
    }

    // 최저가(대표가와 동일 기준) — 옵션 상대가 (+N) 계산용
    const pricedAmounts = variants
      .map((v) => getPricesForVariant(v)?.calculated_price_number)
      .filter((n): n is number => typeof n === "number")
    const cheapest = pricedAmounts.length ? Math.min(...pricedAmounts) : 0

    const visible: string[] = []
    const outOfStock = new Set<string>()
    // 값 → 최저가 대비 추가금(extra). 최저가 옵션은 0.
    const priceByValue: Record<string, number> = {}

    for (const value of allValues) {
      const matchingVariants = variants.filter((v) => {
        const opts = toOptionsMap(v.options)
        if (opts[option.id] !== value) return false

        return Object.entries(selectedOptions ?? {}).every(
          ([key, val]) => key === option.id || !val || opts[key] === val
        )
      })

      if (matchingVariants.length === 0) continue

      visible.push(value)
      if (!matchingVariants.some(hasStock)) {
        outOfStock.add(value)
      }

      // ponytail: 옵션값이 variant 1개에만 매핑될 때만 가격 표기. 다중옵션 상품은
      // 값 하나가 여러 가격에 걸쳐 모호하므로 생략(단일옵션 니들류가 실제 대상).
      if (matchingVariants.length === 1) {
        const p = getPricesForVariant(matchingVariants[0])
        if (p) {
          priceByValue[value] = p.calculated_price_number - cheapest
        }
      }
    }

    return { visibleValues: visible, outOfStockSet: outOfStock, priceByValue }
  }, [option, variants, selectedOptions])

  // 값이 많으면 드롭다운으로 전환해 세로 공간을 절약
  const useDropdown = visibleValues.length > DROPDOWN_THRESHOLD

  const renderPriceLabel = (value: string) => {
    const extra = priceByValue[value]
    // 최저가 대비 추가금이 있을 때만 표기. 최저가 옵션은 라벨 없음.
    if (!extra || extra <= 0) return null
    return (
      <span className="text-xs whitespace-nowrap opacity-70">
        {t("optionPriceExtra", { amount: extra.toLocaleString() })}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-y-3">
      <span className="text-sm font-medium">{title}</span>

      {useDropdown ? (
        <Select
          value={current ?? ""}
          onValueChange={(v) => updateOption(option.id, v)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full" data-testid="option-select-trigger">
            <SelectValue placeholder={t("selectPlaceholder")} />
          </SelectTrigger>
          {/* Tailwind v4에서 select.tsx의 max-h-[--radix-...] 변수 클래스가
              무효라 목록이 잘리므로, 유효한 max-height로 내부 스크롤을 보장 */}
          <SelectContent className="max-h-[50vh]">
            {visibleValues.map((v) => {
              const isOutOfStock = outOfStockSet.has(v)
              return (
                <SelectItem
                  key={v}
                  value={v}
                  disabled={isOutOfStock}
                  data-testid="option-select-item"
                >
                  <span className="flex w-full items-center justify-between gap-3">
                    <span>
                      {isOutOfStock ? t("outOfStockSuffix", { value: v }) : v}
                    </span>
                    {renderPriceLabel(v)}
                  </span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visibleValues.map((v) => {
            const isOutOfStock = outOfStockSet.has(v)
            const isCurrent = v === current
            const isDisabled = disabled || isOutOfStock

            return (
              <button
                key={v}
                onClick={() => updateOption(option.id, v)}
                disabled={isDisabled}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition-colors",
                  getButtonStyle(isCurrent, isOutOfStock),
                  isDisabled && "pointer-events-none"
                )}
                data-testid="option-button"
              >
                <span className="flex flex-col items-center leading-tight">
                  <span>
                    {isOutOfStock ? t("outOfStockSuffix", { value: v }) : v}
                  </span>
                  {renderPriceLabel(v)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
