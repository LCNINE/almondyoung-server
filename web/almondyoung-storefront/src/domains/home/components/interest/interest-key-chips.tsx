"use client"

import {
  INTEREST_CANDIDATE_CATEGORIES,
  MAX_INTEREST_CATEGORIES,
  type InterestKey,
} from "@/lib/constants/categories"
import { CATEGORY_ICON_URLS } from "@/components/layout/header/header-links"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

const CATEGORY_ICON: Record<InterestKey, string> = CATEGORY_ICON_URLS

interface InterestKeyChipsProps {
  selectedKeys: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  className?: string
  /** pill: 시트 안 작은 칩 / card: 홈 섹션의 아이콘 카드 */
  variant?: "pill" | "card"
}

export function InterestKeyChips({
  selectedKeys,
  onChange,
  disabled = false,
  className,
  variant = "pill",
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

  if (variant === "card") {
    return (
      <div className={cn("flex flex-wrap gap-2", className)}>
        {INTEREST_CANDIDATE_CATEGORIES.map((cat) => {
          const isSelected = selectedKeys.includes(cat.key)
          const isDimmed = !isSelected && isAtMax

          return (
            <button
              key={cat.key}
              type="button"
              onClick={() => handleToggle(cat.key)}
              aria-pressed={isSelected}
              disabled={disabled}
              className={cn(
                "flex h-10 items-center gap-2 rounded-full border px-4 text-sm whitespace-nowrap transition-colors disabled:cursor-not-allowed md:h-11 md:pl-1.5",
                isSelected
                  ? "border-ink bg-ink font-bold text-white"
                  : "border-border bg-white font-medium text-gray-700 hover:border-gray-400",
                isDimmed && "opacity-50"
              )}
            >
              {/* 모바일은 아이콘 8개가 한꺼번에 보이면 어지러워 글자만 둔다 */}
              <span
                className={cn(
                  "hidden size-8 shrink-0 place-items-center rounded-full md:grid",
                  isSelected ? "bg-white" : "bg-muted"
                )}
              >
                <Image
                  src={CATEGORY_ICON[cat.key]}
                  alt=""
                  width={26}
                  height={26}
                  className="size-[26px] object-contain"
                />
              </span>
              {tCat(cat.key as "lash-perm")}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(106px,1fr))] gap-2 md:flex md:flex-wrap",
        className
      )}
    >
      {INTEREST_CANDIDATE_CATEGORIES.map((cat) => {
        const isSelected = selectedKeys.includes(cat.key)
        const isDimmed = !isSelected && isAtMax

        return (
          <button
            key={cat.key}
            type="button"
            onClick={() => handleToggle(cat.key)}
            aria-pressed={isSelected}
            disabled={disabled}
            className={cn(
              "text-foreground relative inline-flex items-center justify-center gap-1.5 rounded-[3px] border-[0.5px] bg-white px-2.5 py-1.5 text-[13px] whitespace-nowrap transition-all disabled:cursor-not-allowed",
              isSelected
                ? "border-foreground font-semibold"
                : "border-border hover:border-foreground/30 font-medium",
              isDimmed && "opacity-50"
            )}
          >
            <Image
              src={CATEGORY_ICON[cat.key]}
              alt=""
              width={22}
              height={22}
              className="size-[22px] shrink-0 object-contain"
            />
            {tCat(cat.key as "lash-perm")}
            {isSelected && (
              <span className="bg-primary absolute -top-1.5 -right-1.5 flex size-[15px] items-center justify-center rounded-full">
                <Check className="size-[10px] text-white" strokeWidth={3.5} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
