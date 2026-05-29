"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTranslations } from "next-intl"

export type SortOptions =
  | "created_at"
  | "price_asc"
  | "price_desc"
  | "sales_desc"

type SortProductsProps = {
  sortBy: SortOptions
  setQueryParams: (name: string, value: SortOptions) => void
}

const sortOptions: { value: SortOptions; labelKey: string }[] = [
  { value: "sales_desc", labelKey: "salesDesc" },
  { value: "price_asc", labelKey: "priceAsc" },
  { value: "price_desc", labelKey: "priceDesc" },
  { value: "created_at", labelKey: "createdAt" },
]

const SortProducts = ({ sortBy, setQueryParams }: SortProductsProps) => {
  const t = useTranslations("category.sort")

  const handleChange = (value: string) => {
    setQueryParams("sortBy", value as SortOptions)
  }

  const selectedKey = sortOptions.find((opt) => opt.value === sortBy)?.labelKey

  return (
    <Select value={sortBy} onValueChange={handleChange}>
      <SelectTrigger className="h-8 w-auto cursor-pointer gap-1 border-none bg-transparent px-2 text-sm font-medium shadow-none">
        <SelectValue>{selectedKey ? t(selectedKey) : null}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {sortOptions.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {t(item.labelKey)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default SortProducts
