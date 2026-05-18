"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

  const handleCategoryChange = (value: string) => {
    onCategoryChange(value as QuestionCategory)
    onSubCategoryChange("")
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="flex-1">
        <Select
          value={category || undefined}
          onValueChange={handleCategoryChange}
          disabled={disabled}
        >
          <SelectTrigger className="h-11 w-full">
            <SelectValue placeholder={tForm("categoryPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {INQUIRY_CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {tCategories(cat.value as "delivery")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1">
        <Select
          value={subCategory || undefined}
          onValueChange={onSubCategoryChange}
          disabled={disabled || !category}
        >
          <SelectTrigger className="h-11 w-full">
            <SelectValue
              placeholder={
                category
                  ? tForm("subCategoryPlaceholder")
                  : tForm("subCategorySelectFirst")
              }
            />
          </SelectTrigger>
          <SelectContent>
            {subCategories.map((sub) => {
              const path = `${category}.${sub.value}` as `delivery.status`
              return (
                <SelectItem key={sub.value} value={sub.value}>
                  {tSub(path)}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
