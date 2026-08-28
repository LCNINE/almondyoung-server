import { cn } from "@/lib/utils"

export function TimeSaleBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded bg-primary px-1.5 py-0.5 text-[11px] leading-none font-bold text-white",
        className
      )}
    >
      TIME SALE
    </span>
  )
}
