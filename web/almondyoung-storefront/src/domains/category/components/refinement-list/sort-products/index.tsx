"use client"

import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

export type SortOptions =
  | "created_at"
  | "price_asc"
  | "price_desc"
  | "sales_desc"
  | "review_count_desc"

type SortProductsProps = {
  sortBy: SortOptions
  setQueryParams: (name: string, value: SortOptions) => void
}

const sortOptions: { value: SortOptions; labelKey: string }[] = [
  { value: "review_count_desc", labelKey: "reviewCountDesc" },
  { value: "price_asc", labelKey: "priceAsc" },
  { value: "price_desc", labelKey: "priceDesc" },
  { value: "sales_desc", labelKey: "salesDesc" },
  { value: "created_at", labelKey: "createdAt" },
]

const SortProducts = ({ sortBy, setQueryParams }: SortProductsProps) => {
  const t = useTranslations("category.sort")

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="flex flex-wrap items-center gap-y-1"
    >
      {sortOptions.map((item, index) => (
        <div key={item.value} className="flex items-center">
          {index > 0 && (
            <span aria-hidden className="bg-border mx-2 h-3 w-px sm:mx-3" />
          )}
          <button
            type="button"
            aria-current={sortBy === item.value ? "true" : undefined}
            onClick={() => setQueryParams("sortBy", item.value)}
            className={cn(
              "cursor-pointer text-sm whitespace-nowrap transition-colors",
              sortBy === item.value
                ? "text-foreground font-bold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(item.labelKey)}
          </button>
        </div>
      ))}
    </div>
  )
}

export default SortProducts
