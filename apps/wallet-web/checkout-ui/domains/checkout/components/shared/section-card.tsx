"use client"

import { cn } from "@/checkout-ui/lib/utils"

interface SectionCardProps {
  title: string
  subtitle?: string | null
  action?: {
    label: string
    onClick: () => void
  }
  headerRight?: React.ReactNode
  className?: string
  children?: React.ReactNode
}

export function SectionCard({
  title,
  subtitle,
  action,
  headerRight,
  className,
  children,
}: SectionCardProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-gray-200 bg-white lg:rounded-[10px]",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-3 bg-gray-50 px-4 py-3 lg:px-6 lg:py-4",
          children && "border-b border-gray-200"
        )}
      >
        <h3 className="flex min-w-0 items-center gap-2 text-[15px] font-bold text-gray-900 lg:text-lg">
          <span className="shrink-0">{title}</span>
          {subtitle && (
            <>
              <span aria-hidden className="text-gray-300">
                |
              </span>
              <span className="truncate font-bold">{subtitle}</span>
            </>
          )}
        </h3>
        {headerRight}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="shrink-0 rounded border border-[#ff6600] px-3 py-1.5 text-[14px] font-medium text-[#ff6600] transition-colors hover:bg-gray-50"
          >
            {action.label}
          </button>
        )}
      </div>
      {children && <div className="px-4 py-4 lg:px-6 lg:py-5">{children}</div>}
    </div>
  )
}
