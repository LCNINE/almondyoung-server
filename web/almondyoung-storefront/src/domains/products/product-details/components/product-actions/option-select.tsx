import { cn } from "@/lib/utils"
import { HttpTypes } from "@medusajs/types"

interface OptionSelectProps {
  option: HttpTypes.StoreProductOption
  current?: string
  updateOption: (optionId: string, value: string) => void
  title: string
  disabled?: boolean
  disabledValues?: Set<string>
  selectedValues?: Set<string> // 이미 선택된 항목의 옵션 값들
}

export default function OptionSelect({
  option,
  current,
  updateOption,
  title,
  disabled,
  disabledValues,
  selectedValues,
}: OptionSelectProps) {
  const filteredOptions = (option.values ?? []).map((v) => v.value)

  return (
    <div className="flex flex-col gap-y-3">
      <span className="text-sm font-medium">{title}</span>
      <div className="flex flex-wrap gap-2">
        {filteredOptions.map((v) => {
          const isUnavailable = disabledValues?.has(v)
          const isSelected = selectedValues?.has(v)
          const isCurrent = v === current

          return (
            <button
              onClick={() => updateOption(option.id, v)}
              key={v}
              className={cn(
                "rounded-full border px-4 py-2 text-sm transition-colors",
                {
                  // 현재 선택 중
                  "border-primary bg-primary text-primary-foreground":
                    isCurrent && !isUnavailable,
                  // 이미 선택된 항목
                  "border-primary text-primary":
                    isSelected && !isCurrent && !isUnavailable,
                  // 기본 상태
                  "border-gray-200 hover:border-gray-400":
                    !isCurrent && !isSelected && !isUnavailable,
                  "pointer-events-none": disabled || isUnavailable,
                  "border-gray-200 bg-gray-100 text-gray-400": isUnavailable,
                }
              )}
              disabled={disabled || isUnavailable}
              data-testid="option-button"
            >
              {isUnavailable ? `${v} (품절)` : v}
            </button>
          )
        })}
      </div>
    </div>
  )
}
