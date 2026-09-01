"use client"

import { Info } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface ProductSortTabOption<T extends string = string> {
  value: T
  label: string
  /** 있으면 라벨 옆에 ⓘ 가 붙고 눌렀을 때 이 설명이 뜬다 */
  hint?: React.ReactNode
  /** ⓘ 버튼의 스크린리더 이름. hint 를 줄 때 같이 준다 */
  hintLabel?: string
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
          {option.hint && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={option.hintLabel}
                  className="text-muted-foreground hover:text-foreground ml-1 cursor-pointer"
                >
                  <Info className="size-3.5" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={10}
                collisionPadding={16}
                className="text-foreground w-[calc(100vw-2rem)] max-w-[360px] rounded-xl p-3.5 text-[13px] leading-relaxed break-keep shadow-lg sm:p-4"
              >
                {option.hint}
              </PopoverContent>
            </Popover>
          )}
        </div>
      ))}
    </div>
  )
}
