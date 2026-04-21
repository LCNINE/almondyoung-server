"use client"

import { cn } from "@/lib/utils"
import {
  endOfDay,
  endOfMonth,
  format,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
} from "date-fns"
import { CalendarRange, ChevronLeft, ChevronRight, X } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import { PointHistoryDateSheet } from "./date-sheet"

type FilterMode = "month" | "range"

interface FilterView {
  mode: FilterMode
  year: number
  month: number
  dateFrom: string
  dateTo: string
  label: string
  isAtCurrentMonth: boolean
}

function parseDateSafe(value: string | null): Date | null {
  if (!value) return null
  const d = parseISO(value)
  return isValid(d) ? d : null
}

function deriveView(params: URLSearchParams): FilterView {
  const now = new Date()
  const currentMonthStart = startOfMonth(now)

  const fromDate = parseDateSafe(params.get("from"))
  const toDate = parseDateSafe(params.get("to"))

  if (fromDate && toDate) {
    return {
      mode: "range",
      year: fromDate.getFullYear(),
      month: fromDate.getMonth() + 1,
      dateFrom: startOfDay(fromDate).toISOString(),
      dateTo: endOfDay(toDate).toISOString(),
      label: `${format(fromDate, "yyyy.MM.dd")} - ${format(toDate, "yyyy.MM.dd")}`,
      isAtCurrentMonth: false,
    }
  }

  const yearNum = Number(params.get("year"))
  const monthNum = Number(params.get("month"))
  const hasValidMonth =
    Number.isFinite(yearNum) &&
    Number.isFinite(monthNum) &&
    monthNum >= 1 &&
    monthNum <= 12
  const year = hasValidMonth ? yearNum : now.getFullYear()
  const month = hasValidMonth ? monthNum : now.getMonth() + 1
  const monthStart = startOfMonth(new Date(year, month - 1, 1))

  return {
    mode: "month",
    year,
    month,
    dateFrom: monthStart.toISOString(),
    dateTo: endOfMonth(monthStart).toISOString(),
    label: `${year}년 ${month}월`,
    isAtCurrentMonth: monthStart.getTime() >= currentMonthStart.getTime(),
  }
}

export function PointHistoryFilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [sheetOpen, setSheetOpen] = useState(false)

  const view = useMemo(
    () => deriveView(new URLSearchParams(searchParams.toString())),
    [searchParams]
  )

  const pushParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    params.delete("page")
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const goToMonth = (year: number, month: number) => {
    pushParams((params) => {
      params.delete("from")
      params.delete("to")
      params.set("year", String(year))
      params.set("month", String(month))
    })
  }

  const handlePrev = () => {
    const month = view.month === 1 ? 12 : view.month - 1
    const year = view.month === 1 ? view.year - 1 : view.year
    goToMonth(year, month)
  }

  const handleNext = () => {
    if (view.isAtCurrentMonth) return
    const month = view.month === 12 ? 1 : view.month + 1
    const year = view.month === 12 ? view.year + 1 : view.year
    goToMonth(year, month)
  }

  const handleClearRange = () => {
    pushParams((params) => {
      params.delete("from")
      params.delete("to")
      params.delete("year")
      params.delete("month")
    })
  }

  const handleApplyRange = (from: Date, to: Date) => {
    pushParams((params) => {
      params.delete("year")
      params.delete("month")
      params.set("from", format(from, "yyyy-MM-dd"))
      params.set("to", format(to, "yyyy-MM-dd"))
    })
    setSheetOpen(false)
  }

  const isRangeMode = view.mode === "range"

  return (
    <>
      <div className="border-gray-10 flex items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2">
        {isRangeMode ? (
          <div className="flex flex-1 items-center gap-2 px-2">
            <CalendarRange className="text-primary size-4 shrink-0" />
            <span className="text-gray-90 truncate text-sm font-semibold tabular-nums">
              {view.label}
            </span>
            <button
              type="button"
              onClick={handleClearRange}
              className="text-gray-40 hover:text-gray-70 ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors"
              aria-label="기간 필터 해제"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center gap-1">
            <button
              type="button"
              onClick={handlePrev}
              aria-label="이전 달"
              className="text-gray-70 hover:bg-gray-5 inline-flex size-9 items-center justify-center rounded-full transition-colors"
            >
              <ChevronLeft className="size-5" />
            </button>
            <span className="text-gray-90 min-w-[7rem] text-center text-base font-semibold tabular-nums">
              {view.label}
            </span>
            <button
              type="button"
              onClick={handleNext}
              disabled={view.isAtCurrentMonth}
              aria-label="다음 달"
              className={cn(
                "text-gray-70 hover:bg-gray-5 inline-flex size-9 items-center justify-center rounded-full transition-colors",
                view.isAtCurrentMonth &&
                  "text-gray-30 cursor-not-allowed hover:bg-transparent"
              )}
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="기간 직접 선택"
          className={cn(
            "text-gray-70 hover:bg-gray-5 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors",
            isRangeMode && "text-primary"
          )}
        >
          <CalendarRange className="size-5" />
        </button>
      </div>

      <PointHistoryDateSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        initialFrom={view.dateFrom}
        initialTo={view.dateTo}
        onApply={handleApplyRange}
      />
    </>
  )
}
