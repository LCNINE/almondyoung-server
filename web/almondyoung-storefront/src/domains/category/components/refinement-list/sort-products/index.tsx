"use client"

import {
  ProductSortTabs,
  type ProductSortTabOption,
} from "@/components/products/product-sort-tabs"
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

  const options: ProductSortTabOption<SortOptions>[] = sortOptions.map(
    (item) => ({ value: item.value, label: t(item.labelKey) })
  )

  return (
    <ProductSortTabs
      options={options}
      value={sortBy}
      onChange={(value) => setQueryParams("sortBy", value)}
      label={t("label")}
    />
  )
}

export default SortProducts
