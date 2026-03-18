import { cn } from "@/lib/utils"
import { HttpTypes } from "@medusajs/types"
import { useMemo } from "react"

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

function getButtonStyle(
  isCurrent: boolean,
  isSelected: boolean,
  isOutOfStock: boolean
): string {
  if (isOutOfStock) return "border-gray-200 bg-gray-100 text-gray-400"
  if (isCurrent) return "border-primary bg-primary text-primary-foreground"
  if (isSelected) return "border-primary text-primary"
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
  const { visibleValues, outOfStockSet } = useMemo(() => {
    const allValues = (option.values ?? []).map((v) => v.value)
    if (!variants) {
      return { visibleValues: allValues, outOfStockSet: new Set<string>() }
    }

    const visible: string[] = []
    const outOfStock = new Set<string>()

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
    }

    return { visibleValues: visible, outOfStockSet: outOfStock }
  }, [option, variants, selectedOptions])

  return (
    <div className="flex flex-col gap-y-3">
      <span className="text-sm font-medium">{title}</span>
      <div className="flex flex-wrap gap-2">
        {visibleValues.map((v) => {
          const isOutOfStock = outOfStockSet.has(v)
          const isSelected = selectedValues?.has(v) ?? false
          const isCurrent = v === current
          const isDisabled = disabled || isOutOfStock

          return (
            <button
              key={v}
              onClick={() => updateOption(option.id, v)}
              disabled={isDisabled}
              className={cn(
                "rounded-full border px-4 py-2 text-sm transition-colors",
                getButtonStyle(isCurrent, isSelected, isOutOfStock),
                isDisabled && "pointer-events-none"
              )}
              data-testid="option-button"
            >
              {isOutOfStock ? `${v} (품절)` : v}
            </button>
          )
        })}
      </div>
    </div>
  )
}
