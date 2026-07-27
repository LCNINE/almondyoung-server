"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PAGE_SIZE_OPTIONS } from "@/domains/category/utils/sort-mapping"
import { useTranslations } from "next-intl"

type PageSizeSelectProps = {
  pageSize: number
  setQueryParams: (name: string, value: string) => void
}

const PageSizeSelect = ({ pageSize, setQueryParams }: PageSizeSelectProps) => {
  const t = useTranslations("category.pageSize")

  return (
    <Select
      value={String(pageSize)}
      onValueChange={(value) => setQueryParams("limit", value)}
    >
      <SelectTrigger
        aria-label={t("label")}
        className="h-8 w-auto cursor-pointer gap-1 border-none bg-transparent px-2 text-sm font-medium shadow-none"
      >
        <SelectValue>{t("option", { count: pageSize })}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {PAGE_SIZE_OPTIONS.map((size) => (
          <SelectItem key={size} value={String(size)}>
            {t("option", { count: size })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default PageSizeSelect
