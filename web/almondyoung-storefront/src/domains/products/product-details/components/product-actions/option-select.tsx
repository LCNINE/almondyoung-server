import { cn } from "@/lib/utils"
import { HttpTypes } from "@medusajs/types"

interface OptionSelectProps {
  option: HttpTypes.StoreProductOption
  current?: string
  updateOption: (optionId: string, value: string) => void
  title: string
  disabled?: boolean
  disabledValues?: Set<string>
  "data-testid"?: string
}

export default function OptionSelect({
  option,
  current,
  updateOption,
  title,
  disabled,
  disabledValues,
  "data-testid": dataTestId,
}: OptionSelectProps) {
  const filteredOptions = (option.values ?? []).map((v) => v.value)

  return (
    <div className="flex flex-col gap-y-3">
      <span className="text-sm font-medium">{title}</span>
      <div className="flex flex-wrap gap-2" data-testid={dataTestId}>
        {filteredOptions.map((v) => {
          const isUnavailable = disabledValues?.has(v)
          return (
            <button
              onClick={() => updateOption(option.id, v)}
              key={v}
              className={cn(
                "rounded-full border px-4 py-2 text-sm transition-colors",
                {
                  "border-primary bg-primary text-primary-foreground":
                    v === current && !isUnavailable,
                  "border-gray-200 hover:border-gray-400":
                    v !== current && !isUnavailable,
                  "pointer-events-none opacity-50": disabled || isUnavailable,
                  "border-gray-100 text-gray-300 line-through":
                    isUnavailable,
                }
              )}
              disabled={disabled || isUnavailable}
              data-testid="option-button"
            >
              {v}
            </button>
          )
        })}
      </div>
    </div>
  )
}
