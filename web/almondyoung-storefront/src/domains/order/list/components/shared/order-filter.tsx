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
import { useMemo, useState } from "react"

/**
 * year: "" = 전체, "2025" = 특정 연도 (숫자 문자열)
 * month: "" = 전체, "1"~"12" = 특정 월 (숫자 문자열)
 */
export interface FilterOptions {
  year: string
  month: string
}

interface OrderFilterProps {
  onFilterChange?: (filters: FilterOptions) => void
  defaultYear?: string
  defaultMonth?: string
}

const MONTHS_NUM = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

const FIRST_ORDER_YEAR = 2023

export function OrderFilter({
  onFilterChange,
  defaultYear,
  defaultMonth,
}: OrderFilterProps) {
  const t = useTranslations("mypage.order.filter")

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear()
    const result: string[] = []
    for (let y = currentYear; y >= FIRST_ORDER_YEAR; y--) {
      result.push(String(y))
    }
    return result
  }, [])

  const [year, setYear] = useState(defaultYear ?? "")
  const [month, setMonth] = useState(defaultMonth ?? "")

  const handleYearChange = (value: string) => {
    const next = value === t("allYears") ? "" : value
    setYear(next)
    onFilterChange?.({ year: next, month })
  }

  const handleMonthChange = (value: string) => {
    const next = value === t("allMonths") ? "" : value
    setMonth(next)
    onFilterChange?.({ year, month: next })
  }

  const yearDisplayValue = year || t("allYears")
  const monthDisplayValue = month ? t("monthFormat", { month: parseInt(month) }) : t("allMonths")

  return (
    <section className="flex w-full items-center gap-4 bg-white py-1.5">
      <header className="flex items-center gap-1.5">
        <Filter className="h-4 w-4 text-gray-500" aria-hidden="true" />
        <span className="text-xs leading-4 font-normal text-gray-600">
          {t("label")}
        </span>
      </header>

      <div className="flex items-center gap-1.5">
        <Select value={yearDisplayValue} onValueChange={handleYearChange}>
          <SelectTrigger className="h-6 w-20 rounded-[5px] border-zinc-300 px-2.5 text-xs font-medium text-gray-600">
            <SelectValue placeholder={t("allYears")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={t("allYears")} className="text-xs">
              {t("allYears")}
            </SelectItem>
            {years.map((y) => (
              <SelectItem key={y} value={y} className="text-xs">
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={monthDisplayValue} onValueChange={handleMonthChange}>
          <SelectTrigger className="h-6 w-16 rounded-[5px] border-zinc-300 px-2.5 text-xs font-medium text-gray-600">
            <SelectValue placeholder={t("allMonths")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={t("allMonths")} className="text-xs">
              {t("allMonths")}
            </SelectItem>
            {MONTHS_NUM.map((m) => {
              const label = t("monthFormat", { month: m })
              return (
                <SelectItem key={m} value={String(m)} className="text-xs">
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
