"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
            <SelectValue placeholder="문의 유형 선택" />
          </SelectTrigger>
          <SelectContent>
            {INQUIRY_CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {cat.label}
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
              placeholder={category ? "세부 유형 선택" : "문의 유형을 먼저 선택"}
            />
          </SelectTrigger>
          <SelectContent>
            {subCategories.map((sub) => (
              <SelectItem key={sub.value} value={sub.value}>
                {sub.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
