"use client"

import {
  INTEREST_CANDIDATE_CATEGORIES,
  MAX_INTEREST_CATEGORIES,
  type InterestKey,
} from "@/lib/constants/categories"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

const CATEGORY_ICON: Record<InterestKey, string> = {
  "lash-perm": "/images/categories/lash.png",
  "lash-extension": "/images/categories/lash.png",
  "semi-permanent": "/images/categories/semi-permanent.png",
  nail: "/images/categories/nail.png",
  tattoo: "/images/categories/tattoo.png",
  skincare: "/images/categories/skincare.png",
  hair: "/images/categories/hair.png",
  waxing: "/images/categories/waxing.png",
}

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
              "relative inline-flex items-center justify-center gap-1.5 rounded-[3px] whitespace-nowrap border-[0.5px] bg-white px-2.5 py-1.5 text-[13px] text-foreground transition-all disabled:cursor-not-allowed",
              isSelected
                ? "border-foreground font-semibold"
                : "border-border font-medium hover:border-foreground/30",
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
              <span className="absolute -top-1.5 -right-1.5 flex size-[15px] items-center justify-center rounded-full bg-primary">
                <Check className="size-[10px] text-white" strokeWidth={3.5} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
