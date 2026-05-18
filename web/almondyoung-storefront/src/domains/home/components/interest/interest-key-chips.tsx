"use client"

import { Button } from "@/components/ui/button"
import {
  INTEREST_CANDIDATE_CATEGORIES,
  MAX_INTEREST_CATEGORIES,
} from "@/lib/constants/categories"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

interface InterestKeyChipsProps {
  selectedKeys: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  className?: string
}

export function InterestKeyChips({
  selectedKeys,
  onChange,
  disabled = false,
  className,
}: InterestKeyChipsProps) {
  const tBanner = useTranslations("home.interestBanner")
  const tCat = useTranslations("categories")
  const isAtMax = selectedKeys.length >= MAX_INTEREST_CATEGORIES

  const handleToggle = (key: string) => {
    if (disabled) return

    if (selectedKeys.includes(key)) {
      onChange(selectedKeys.filter((k) => k !== key))
      return
    }

    if (isAtMax) {
      toast.message(tBanner("maxSelectable", { max: MAX_INTEREST_CATEGORIES }))
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
            {tCat(cat.key as "lash-perm")}
          </Button>
        )
      })}
    </div>
  )
}
