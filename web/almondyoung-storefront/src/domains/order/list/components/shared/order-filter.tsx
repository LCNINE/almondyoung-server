"use client"

import { Filter } from "lucide-react"
import { useState } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface FilterOptions {
  year: string
  month: string
}

interface OrderFilterProps {
  onFilterChange?: (filters: FilterOptions) => void
  defaultYear?: string
  defaultMonth?: string
}

const YEARS = ["전체년도", "2026", "2025", "2024", "2023"] as const
const MONTHS = [
  "전체",
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
] as const

export function OrderFilter({
  onFilterChange,
  defaultYear = "전체년도",
  defaultMonth = "전체",
}: OrderFilterProps) {
  const [year, setYear] = useState(defaultYear)
  const [month, setMonth] = useState(defaultMonth)

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
          필터
        </span>
      </header>

      <div className="flex items-center gap-1.5">
        <Select value={year} onValueChange={handleYearChange}>
          <SelectTrigger className="h-6 w-20 rounded-[5px] border-zinc-300 px-2.5 text-xs font-medium text-gray-600">
            <SelectValue placeholder="전체년도" />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map((y) => (
              <SelectItem key={y} value={y} className="text-xs">
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={month} onValueChange={handleMonthChange}>
          <SelectTrigger className="h-6 w-16 rounded-[5px] border-zinc-300 px-2.5 text-xs font-medium text-gray-600">
            <SelectValue placeholder="월" />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m) => (
              <SelectItem key={m} value={m} className="text-xs">
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  )
}
