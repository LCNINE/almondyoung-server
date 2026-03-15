'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils/ui'

type FilterChipProps = React.HTMLAttributes<HTMLSpanElement> & {
  label: string
  value: string
  onRemove?: () => void
}

export const FilterChip = React.forwardRef<HTMLSpanElement, FilterChipProps>(
  ({ label, value, onRemove, className, ...props }, ref) => {
    return (
      <span
        ref={ref}
        role="button"
        className={cn(
          'inline-flex cursor-pointer items-center gap-1 rounded-md border bg-secondary px-2 py-0.5 text-xs font-normal text-secondary-foreground hover:bg-secondary/80',
          className,
        )}
        {...props}
      >
        <span className="font-medium">{label}:</span> {value}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="ml-1 rounded-sm opacity-70 hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </span>
    )
  },
)
FilterChip.displayName = 'FilterChip'
