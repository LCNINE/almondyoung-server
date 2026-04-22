import { cn } from "@/lib/utils"

type RankBadgeProps = {
  rank: number
  variant?: "top-left" | "bottom-left"
}

export default function RankBadge({
  rank,
  variant = "top-left",
}: RankBadgeProps) {
  return (
    <div
      className={cn(
        "absolute left-0 bg-black px-2.5 py-1 text-[12px] font-bold text-white",
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
