'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSelectedParams } from '@/hooks/table/use-selected-params'
import { FilterChip } from './filter-chip'
import type { Filter } from './types'

type StringFilterProps = {
  filter: Extract<Filter, { type: 'string' }>
  open: boolean
  onOpenChange: (open: boolean) => void
  prefix?: string
}

export function StringFilter({ filter, open, onOpenChange, prefix }: StringFilterProps) {
  const { get, add, delete: del } = useSelectedParams({ prefix })
  const raw = get(filter.key)
  const currentValue = Array.isArray(raw) ? raw[0] : (raw ?? '')
  const hasValue = !!currentValue

  const [inputValue, setInputValue] = useState(currentValue)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setInputValue(currentValue)
  }, [currentValue])

  const handleChange = (val: string) => {
    setInputValue(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (val) add(filter.key, val)
      else del(filter.key)
    }, 500)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {hasValue ? (
        <PopoverTrigger asChild>
          <FilterChip
            label={filter.label}
            value={currentValue}
            onRemove={() => del(filter.key)}
          />
        </PopoverTrigger>
      ) : (
        <PopoverAnchor />
      )}
      <PopoverContent
        className="w-56 p-3"
        align="start"
        onFocusOutside={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium">{filter.label}</p>
          <Input
            autoFocus
            value={inputValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={`${filter.label} 입력...`}
            className="h-8 text-sm"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
