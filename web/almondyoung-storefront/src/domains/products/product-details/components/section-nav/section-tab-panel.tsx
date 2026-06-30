import { cn } from "@/lib/utils"
import type { SectionTab } from "./index"

interface SectionTabPanelProps {
  value: SectionTab
  className?: string
  children: React.ReactNode
}

export function SectionTabPanel({
  value,
  className,
  children,
}: SectionTabPanelProps) {
  return (
    <section
      id={value}
      data-section-id={value}
      className={cn(
        "scroll-mt-[var(--pdp-section-offset)] pt-8 first:pt-0",
        className
      )}
    >
      {children}
    </section>
  )
}
