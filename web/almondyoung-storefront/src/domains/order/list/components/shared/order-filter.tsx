"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Filter } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"

export interface FilterOptions {
  year: string
  month: string
}

interface OrderFilterProps {
  onFilterChange?: (filters: FilterOptions) => void
  defaultYear?: string
  defaultMonth?: string
}

const YEARS = ["2026", "2025", "2024", "2023"] as const
const MONTHS_NUM = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export function OrderFilter({
  onFilterChange,
  defaultYear,
  defaultMonth,
}: OrderFilterProps) {
  const t = useTranslations("mypage.order.filter")
  const allYears = t("allYears")
  const allMonths = t("allMonths")

  const [year, setYear] = useState(defaultYear ?? allYears)
  const [month, setMonth] = useState(defaultMonth ?? allMonths)

  const handleYearChange = (value: string) => {
    setYear(value)
    onFilterChange?.({ year: value, month })
  }

  const handleMonthChange = (value: string) => {
    setMonth(value)
    onFilterChange?.({ year, month: value })
  }

  return (
    <section className="flex w-full items-center gap-4 bg-white py-1.5">
      <header className="flex items-center gap-1.5">
        <Filter className="h-4 w-4 text-gray-500" aria-hidden="true" />
        <span className="text-xs leading-4 font-normal text-gray-600">
          {t("label")}
        </span>
      </header>

      <div className="flex items-center gap-1.5">
        <Select value={year} onValueChange={handleYearChange}>
          <SelectTrigger className="h-6 w-20 rounded-[5px] border-zinc-300 px-2.5 text-xs font-medium text-gray-600">
            <SelectValue placeholder={allYears} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={allYears} className="text-xs">
              {allYears}
            </SelectItem>
            {YEARS.map((y) => (
              <SelectItem key={y} value={y} className="text-xs">
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={month} onValueChange={handleMonthChange}>
          <SelectTrigger className="h-6 w-16 rounded-[5px] border-zinc-300 px-2.5 text-xs font-medium text-gray-600">
            <SelectValue placeholder={allMonths} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={allMonths} className="text-xs">
              {allMonths}
            </SelectItem>
            {MONTHS_NUM.map((m) => {
              const label = t("monthFormat", { month: m })
              return (
                <SelectItem key={m} value={label} className="text-xs">
                  {label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>
    </section>
  )
}
