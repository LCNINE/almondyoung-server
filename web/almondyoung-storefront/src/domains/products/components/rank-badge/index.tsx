import { cn } from "@/lib/utils"

type RankBadgeProps = {
  rank: number
  variant?: "top-left" | "bottom-left"
}

const TOP_RANK = 3

export default function RankBadge({
  rank,
  variant = "top-left",
}: RankBadgeProps) {
  return (
    <div
      className={cn(
        "absolute left-0 z-[1] grid size-7 place-items-center text-[14px] font-bold tabular-nums",
        rank <= TOP_RANK ? "bg-mint text-ink" : "bg-ink text-white",
        {
          "top-0": variant === "top-left",
          "bottom-0": variant === "bottom-left",
        }
      )}
    >
      {rank}
    </div>
  )
}
