"use client"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import {
  endOfMonth,
  format,
  startOfMonth,
  subMonths,
} from "date-fns"
import { ko } from "date-fns/locale"
import { useEffect, useMemo, useState } from "react"
import type { DateRange } from "react-day-picker"

type PresetKey = "thisMonth" | "lastMonth" | "last3Months" | "last6Months"

interface PointHistoryDateSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialFrom: string | null
  initialTo: string | null
  onApply: (from: Date, to: Date) => void
}

function getPresetRange(key: PresetKey): { from: Date; to: Date } {
  const now = new Date()
  switch (key) {
    case "thisMonth":
      return { from: startOfMonth(now), to: endOfMonth(now) }
    case "lastMonth": {
      const prev = subMonths(now, 1)
      return { from: startOfMonth(prev), to: endOfMonth(prev) }
    }
    case "last3Months":
      return { from: startOfMonth(subMonths(now, 2)), to: endOfMonth(now) }
    case "last6Months":
      return { from: startOfMonth(subMonths(now, 5)), to: endOfMonth(now) }
  }
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "thisMonth", label: "이번 달" },
  { key: "lastMonth", label: "지난 달" },
  { key: "last3Months", label: "최근 3개월" },
  { key: "last6Months", label: "최근 6개월" },
]

export function PointHistoryDateSheet({
  open,
  onOpenChange,
  initialFrom,
  initialTo,
  onApply,
}: PointHistoryDateSheetProps) {
  const initialRange = useMemo<DateRange | undefined>(() => {
    if (!initialFrom || !initialTo) return undefined
    const from = new Date(initialFrom)
    const to = new Date(initialTo)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
      return undefined
    return { from, to }
  }, [initialFrom, initialTo])

  const [range, setRange] = useState<DateRange | undefined>(initialRange)

  useEffect(() => {
    if (open) setRange(initialRange)
  }, [open, initialRange])

  const canApply = !!range?.from && !!range.to

  const fromLabel = range?.from ? format(range.from, "yyyy / MM / dd") : "시작일"
  const toLabel = range?.to ? format(range.to, "yyyy / MM / dd") : "종료일"

  const handleApply = () => {
    if (!range?.from || !range.to) return
    onApply(range.from, range.to)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          "flex max-h-[92vh] flex-col gap-0 rounded-t-2xl p-0",
          "sm:inset-x-auto sm:right-auto sm:bottom-8 sm:left-1/2",
          "sm:w-[min(92vw,420px)] sm:max-w-none sm:-translate-x-1/2",
          "sm:rounded-2xl"
        )}
      >
        <SheetHeader className="border-gray-10 border-b px-5 pt-5 pb-4">
          <SheetTitle className="text-gray-90 text-center text-base font-bold">
            기간 선택
          </SheetTitle>
          <SheetDescription className="sr-only">
            포인트 내역을 조회할 기간을 선택하세요.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="flex flex-wrap justify-center gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => setRange(getPresetRange(preset.key))}
                className="border-gray-20 text-gray-70 hover:border-primary hover:text-primary rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="border-gray-10 bg-gray-50 mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl border p-3">
            <div className="text-center">
              <p className="text-gray-40 text-[11px]">시작일</p>
              <p
                className={cn(
                  "mt-0.5 text-sm font-semibold tabular-nums",
                  range?.from ? "text-primary" : "text-gray-40"
                )}
              >
                {fromLabel}
              </p>
            </div>
            <span className="text-gray-40 text-sm">~</span>
            <div className="text-center">
              <p className="text-gray-40 text-[11px]">종료일</p>
              <p
                className={cn(
                  "mt-0.5 text-sm font-semibold tabular-nums",
                  range?.to ? "text-gray-90" : "text-gray-40"
                )}
              >
                {toLabel}
              </p>
            </div>
          </div>

          <div className="mt-2 flex w-full justify-center">
            <Calendar
              mode="range"
              locale={ko}
              selected={range}
              onSelect={setRange}
              numberOfMonths={1}
              disabled={{ after: new Date() }}
              showOutsideDays
              className="[--cell-size:2.25rem] w-full p-0"
              classNames={{
                root: "w-full",
                caption_label: "text-sm font-semibold",
              }}
            />
          </div>
        </div>

        <div className="border-gray-10 grid grid-cols-2 gap-2 border-t px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setRange(undefined)}
          >
            초기화
          </Button>
          <Button
            type="button"
            disabled={!canApply}
            onClick={handleApply}
          >
            조회하기
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
