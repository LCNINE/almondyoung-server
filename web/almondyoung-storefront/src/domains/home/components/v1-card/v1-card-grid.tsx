import { cn } from "@/lib/utils"

const COLUMNS = {
  4: "md:grid-cols-4 md:gap-5",
  5: "md:grid-cols-4 md:gap-x-5 md:gap-y-9 lg:grid-cols-5",
  6: "md:grid-cols-4 md:gap-x-4 md:gap-y-7 lg:grid-cols-6",
} as const

interface V1CardGridProps {
  children: React.ReactNode
  columns: keyof typeof COLUMNS
  /** 모바일 가로 스크롤 줄 수 */
  mobileRows?: 1 | 2
  className?: string
}

/** PC 는 고정 칸 그리드, 모바일은 42% 폭 가로 스냅 스크롤 */
export function V1CardGrid({
  children,
  columns,
  mobileRows = 1,
  className,
}: V1CardGridProps) {
  return (
    <ul
      className={cn(
        "-mx-4 grid snap-x snap-mandatory scroll-px-4 auto-cols-[42%] grid-flow-col gap-x-3 gap-y-5 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>li]:min-w-0 [&>li]:snap-start",
        mobileRows === 2 && "grid-rows-[repeat(2,auto)]",
        "md:mx-0 md:snap-none md:auto-cols-auto md:grid-flow-row md:grid-rows-none md:overflow-visible md:px-0",
        COLUMNS[columns],
        className
      )}
    >
      {children}
    </ul>
  )
}
