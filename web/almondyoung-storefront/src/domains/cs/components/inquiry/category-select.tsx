"use client"

import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { INQUIRY_CATEGORIES } from "../../constants/inquiry-categories"
import type { QuestionCategory } from "@/lib/types/dto/ugc"

interface CategorySelectProps {
  category: QuestionCategory | ""
  subCategory: string
  onCategoryChange: (value: QuestionCategory) => void
  onSubCategoryChange: (value: string) => void
  disabled?: boolean
}

function Choice({
  selected,
  disabled,
  compact = false,
  onClick,
  children,
}: {
  selected: boolean
  disabled: boolean
  compact?: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-foreground active:bg-muted w-full cursor-pointer rounded-lg border bg-white px-2 transition-[border-color,box-shadow,background-color,transform] duration-150 ease-[cubic-bezier(.4,0,.2,1)] select-none active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100",
        compact ? "h-10 text-[13px]" : "h-11 text-sm",
        selected
          ? "border-foreground ring-foreground font-bold ring-1 ring-inset"
          : "border-border font-medium hover:border-[#b0b3ba]"
      )}
    >
      {children}
    </button>
  )
}

export function CategorySelect({
  category,
  subCategory,
  onCategoryChange,
  onSubCategoryChange,
  disabled = false,
}: CategorySelectProps) {
  const tForm = useTranslations("cs.inquiry.form")
  const tCategories = useTranslations("cs.inquiry.categories")
  const tSub = useTranslations("cs.inquiry.subCategories")

  const selectedCategory = INQUIRY_CATEGORIES.find((c) => c.value === category)
  const subCategories = selectedCategory?.subCategories ?? []

  const handleCategoryChange = (value: QuestionCategory) => {
    onCategoryChange(value)
    onSubCategoryChange("")
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-label={tForm("categoryLabel")}
        className="grid grid-cols-3 gap-2"
      >
        {INQUIRY_CATEGORIES.map((cat) => (
          <Choice
            key={cat.value}
            selected={category === cat.value}
            disabled={disabled}
            onClick={() => handleCategoryChange(cat.value)}
          >
            {tCategories(cat.value as "delivery")}
          </Choice>
        ))}
      </div>

      {subCategories.length > 0 && (
        // 대분류를 바꿀 때마다 새로 나타나는 느낌을 주려고 key 로 다시 그린다
        <div
          key={category}
          className="bg-muted animate-in fade-in slide-in-from-top-1 rounded-lg p-3 duration-250 ease-[cubic-bezier(0,0,.2,1)] motion-reduce:animate-none"
        >
          <p className="text-muted-foreground mb-2 text-[13px]">
            {tForm("subCategoryPlaceholder")}
          </p>
          <div
            role="radiogroup"
            aria-label={tForm("subCategoryPlaceholder")}
            className="grid grid-cols-2 gap-2"
          >
            {subCategories.map((sub) => {
              const path = `${category}.${sub.value}` as `delivery.status`

              return (
                <Choice
                  key={sub.value}
                  selected={subCategory === sub.value}
                  disabled={disabled}
                  compact
                  onClick={() => onSubCategoryChange(sub.value)}
                >
                  {tSub(path)}
                </Choice>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
