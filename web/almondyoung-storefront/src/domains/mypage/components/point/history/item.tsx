import type { PointsEventRow } from "@/lib/types/ui/wallet"
import { cn } from "@/lib/utils"
import {
  formatPointAmount,
  formatPointDate,
  getPointEventMeta,
} from "./event-meta"

interface PointHistoryItemProps {
  event: PointsEventRow
}

export function PointHistoryItem({ event }: PointHistoryItemProps) {
  const meta = getPointEventMeta(event.eventType)
  const Icon = meta.icon
  const isPositive = event.amount > 0
  const isNegative = event.amount < 0

  const statusToneClass = {
    success: "bg-green-40/10 text-green-40",
    danger: "bg-red-30/10 text-red-30",
    info: "bg-orange-600/10 text-orange-600",
    neutral: "border border-gray-20 bg-white text-gray-60",
  }[meta.status.tone]

  const statusDotClass = {
    success: "bg-green-40",
    danger: "bg-red-30",
    info: "bg-orange-600",
    neutral: "bg-gray-40",
  }[meta.status.tone]

  const iconWrapClass = {
    earn: "bg-yellow-10 text-primary",
    redeem: "bg-gray-10 text-gray-90",
    cancel: "bg-gray-10 text-gray-60",
  }[meta.iconTone]

  return (
    <li className="border-gray-10 flex items-center gap-3 rounded-xl border bg-white p-4 transition-colors hover:bg-gray-50">
      <div
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full",
          iconWrapClass
        )}
      >
        <Icon className="size-5" strokeWidth={2} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-gray-90 truncate text-base font-semibold">
          {meta.title}
        </p>
      </div>

      <div className="flex flex-col items-end gap-1 text-right">
        <span
          className={cn(
            "text-base font-bold tabular-nums",
            isPositive && "text-primary",
            isNegative && "text-gray-90",
            !isPositive && !isNegative && "text-gray-60"
          )}
        >
          {formatPointAmount(event.amount)}
        </span>
        <span className="text-gray-40 text-xs tabular-nums">
          {formatPointDate(event.createdAt)}
        </span>
      </div>

      <span
        className={cn(
          "ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
          statusToneClass
        )}
      >
        <span className={cn("size-1.5 rounded-full", statusDotClass)} />
        {meta.status.label}
      </span>
    </li>
  )
}
