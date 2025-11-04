"use client"

import { Filter, ChevronDown } from "lucide-react"
import { useState } from "react"

export interface FilterOptions {
  year: string
  month: string
}

interface OrderFilterProps {
  onFilterChange?: (filters: FilterOptions) => void
}

export function OrderFilter({ onFilterChange }: OrderFilterProps) {
  const [year, setYear] = useState("전체년도")
  const [month, setMonth] = useState("월")

  const years = ["전체년도", "2025", "2024", "2023"]
  const months = [
    "월",
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
  ]

  const handleYearChange = (newYear: string) => {
    setYear(newYear)
    onFilterChange?.({ year: newYear, month })
  }

  const handleMonthChange = (newMonth: string) => {
    setMonth(newMonth)
    onFilterChange?.({ year, month: newMonth })
  }

  return (
    <section className="flex w-full items-center gap-4 bg-white py-1.5">
      {/* 🟡 필터 제목 */}
      <header className="flex items-center gap-1.5">
        <Filter className="h-4 w-4 text-gray-500" aria-hidden="true" />
        <h2 className="font-['Pretendard'] text-xs leading-4 font-normal text-gray-600">
          필터
        </h2>
      </header>

      {/* 🟢 필터 옵션 영역 */}
      <nav className="flex items-center gap-1.5">
        {/* 전체년도 */}
        <button
          type="button"
          className="flex h-6 w-20 items-center justify-between rounded-[5px] bg-white px-2.5 py-2 outline-[0.5px] outline-offset-[-0.5px] outline-zinc-300 transition hover:bg-gray-50"
        >
          <span className="font-['Pretendard'] text-xs font-medium text-gray-600">
            전체년도
          </span>
          <ChevronDown className="h-3 w-3 text-gray-500" aria-hidden="true" />
        </button>

        {/* 월 */}
        <button
          type="button"
          className="flex h-6 w-11 items-center justify-between rounded-[5px] bg-white px-2.5 py-2 outline-[0.5px] outline-offset-[-0.5px] outline-zinc-300 transition hover:bg-gray-50"
        >
          <span className="font-['Pretendard'] text-xs font-medium text-gray-600">
            월
          </span>
          <ChevronDown className="h-3 w-3 text-gray-500" aria-hidden="true" />
        </button>
      </nav>
    </section>
  )
}
