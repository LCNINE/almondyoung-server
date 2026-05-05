"use client"

import { Button } from "@/components/ui/button"
import {
  INTEREST_CANDIDATE_CATEGORIES,
  MAX_INTEREST_CATEGORIES,
} from "@/lib/constants/categories"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import { toast } from "sonner"

interface InterestKeyChipsProps {
  selectedKeys: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  className?: string
}

/*───────────────────────────
 * 관심 카테고리 선택 칩 (배너 + 편집 Sheet 공용)
 * - 최대 3개 선택. 이미 3개 선택된 상태에서 4번째 누르면 비활성 + 토스트.
 *──────────────────────────*/
export function InterestKeyChips({
  selectedKeys,
  onChange,
  disabled = false,
  className,
}: InterestKeyChipsProps) {
  const isAtMax = selectedKeys.length >= MAX_INTEREST_CATEGORIES

  const handleToggle = (key: string) => {
    if (disabled) return

    if (selectedKeys.includes(key)) {
      onChange(selectedKeys.filter((k) => k !== key))
      return
    }

    if (isAtMax) {
      toast.message(`최대 ${MAX_INTEREST_CATEGORIES}개까지 선택할 수 있어요`)
      return
    }

    onChange([...selectedKeys, key])
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {INTEREST_CANDIDATE_CATEGORIES.map((cat) => {
        const isSelected = selectedKeys.includes(cat.key)
        const isDimmed = !isSelected && isAtMax

        return (
          <Button
            key={cat.key}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleToggle(cat.key)}
            aria-pressed={isSelected}
            disabled={disabled}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm transition-all",
              isSelected
                ? "border-yellow-30 bg-yellow-30/10 text-yellow-30 hover:bg-yellow-30/15"
                : isDimmed
                  ? "opacity-50"
                  : "hover:border-yellow-30/50"
            )}
          >
            {isSelected && <Check className="mr-1 h-3.5 w-3.5" />}
            {cat.name}
          </Button>
        )
      })}
    </div>
  )
}
