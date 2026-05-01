"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type SortOptions =
  | "created_at"
  | "price_asc"
  | "price_desc"
  | "sales_desc"

type SortProductsProps = {
  sortBy: SortOptions
  setQueryParams: (name: string, value: SortOptions) => void
}

const sortOptions = [
  { value: "created_at", label: "최신순" },
  { value: "sales_desc", label: "인기순" },
  { value: "price_asc", label: "낮은가격순" },
  { value: "price_desc", label: "높은가격순" },
]

const SortProducts = ({ sortBy, setQueryParams }: SortProductsProps) => {
  const handleChange = (value: string) => {
    setQueryParams("sortBy", value as SortOptions)
  }

  const selectedLabel = sortOptions.find((opt) => opt.value === sortBy)?.label

  return (
    <Select value={sortBy} onValueChange={handleChange}>
      <SelectTrigger className="h-8 w-auto cursor-pointer gap-1 border-none bg-transparent px-2 text-sm font-medium shadow-none">
        <SelectValue>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {sortOptions.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default SortProducts
