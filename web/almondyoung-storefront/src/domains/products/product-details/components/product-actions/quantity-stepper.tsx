"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Minus, Plus } from "lucide-react"
import { useRef } from "react"
import { useTranslations } from "next-intl"

// desktop(md) / mobile(sm) 크기 차이만 여기서 흡수
const SIZE_STYLES = {
  md: {
    button: "h-8 w-8",
    icon: "h-3.5 w-3.5",
    input: "h-8 w-12",
    directButton: "h-8 px-3 text-xs",
  },
  sm: {
    button: "h-7 w-7",
    icon: "h-3 w-3",
    input: "h-7 w-10",
    directButton: "h-7 px-2 text-[11px]",
  },
} as const

type QuantityStepperProps = {
  quantity: number
  size?: "sm" | "md"
  onDecrement: () => void
  onIncrement: () => void
  onQuantityChange: (next: number) => void
  /** blur 시 값이 비었거나 1 미만일 때 (최소 수량 복구용) */
  onInvalidBlur: () => void
  /** input을 빈 문자열로 비웠을 때. 생략하면 빈 입력을 무시 */
  onEmptyInput?: () => void
  incrementDisabled?: boolean
  directInputDisabled?: boolean
}

export default function QuantityStepper({
  quantity,
  size = "md",
  onDecrement,
  onIncrement,
  onQuantityChange,
  onInvalidBlur,
  onEmptyInput,
  incrementDisabled,
  directInputDisabled,
}: QuantityStepperProps) {
  const t = useTranslations("productDetail.options")
  const inputRef = useRef<HTMLInputElement>(null)
  const s = SIZE_STYLES[size]

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center">
        <Button
          variant="outline"
          size="icon"
          onClick={onDecrement}
          className={cn("rounded-r-none", s.button)}
        >
          <Minus className={s.icon} />
        </Button>

        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={quantity}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === "") {
              onEmptyInput?.()
              return
            }
            const val = parseInt(raw, 10)
            if (!isNaN(val)) onQuantityChange(val)
          }}
          onBlur={(e) => {
            const val = parseInt(e.target.value, 10)
            if (isNaN(val) || val < 1) onInvalidBlur()
          }}
          onFocus={(e) => e.target.select()}
          className={cn("border-y text-center text-sm outline-none", s.input)}
        />

        <Button
          variant="outline"
          size="icon"
          onClick={onIncrement}
          disabled={incrementDisabled}
          className={cn("rounded-l-none", s.button)}
        >
          <Plus className={s.icon} />
        </Button>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.focus()}
        disabled={directInputDisabled}
        className={cn("text-gray-600", s.directButton)}
      >
        {t("directInput")}
      </Button>
    </div>
  )
}
