"use client"

import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export interface ProductSortTabOption<T extends string = string> {
  value: T
  label: string
  /** 라벨 뒤에 붙는 도움말 아이콘 등 */
  adornment?: ReactNode
}

interface ProductSortTabsProps<T extends string = string> {
  options: ProductSortTabOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  className?: string
}

export function ProductSortTabs<T extends string = string>({
  options,
  value,
  onChange,
  label,
  className,
}: ProductSortTabsProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "scrollbar-hide -mx-3 flex items-center overflow-x-auto px-3 sm:mx-0 sm:px-0",
        className
      )}
    >
      {options.map((option, index) => (
        <div key={option.value} className="flex shrink-0 items-center">
          {index > 0 && (
            <span aria-hidden className="bg-border mx-2 h-3 w-px sm:mx-3" />
          )}
          <button
            type="button"
            aria-current={value === option.value ? "true" : undefined}
            onClick={() => onChange(option.value)}
            className={cn(
              "cursor-pointer text-sm whitespace-nowrap transition-colors",
              value === option.value
                ? "text-foreground font-bold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
          {option.adornment}
        </div>
      ))}
    </div>
  )
}
