'use client'

import { useState } from 'react'
import { addDays, addMonths, endOfDay, format, startOfDay } from 'date-fns'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSelectedParams } from '@/hooks/table/use-selected-params'
import { FilterChip } from './filter-chip'
import type { Filter } from './types'

type DateFilterValue = { $gte?: string; $lte?: string }

type DateFilterProps = {
  filter: Extract<Filter, { type: 'date' }>
  open: boolean
  onOpenChange: (open: boolean) => void
  prefix?: string
}

const PRESETS = [
  {
    label: '오늘',
    getValue: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }),
  },
  {
    label: '최근 7일',
    getValue: () => ({ from: startOfDay(addDays(new Date(), -6)), to: endOfDay(new Date()) }),
  },
  {
    label: '최근 30일',
    getValue: () => ({ from: startOfDay(addDays(new Date(), -29)), to: endOfDay(new Date()) }),
  },
  {
    label: '최근 90일',
    getValue: () => ({ from: startOfDay(addDays(new Date(), -89)), to: endOfDay(new Date()) }),
  },
  {
    label: '최근 12개월',
    getValue: () => ({
      from: startOfDay(addMonths(new Date(), -12)),
      to: endOfDay(new Date()),
    }),
  },
]

export function DateFilter({ filter, open, onOpenChange, prefix }: DateFilterProps) {
  const { get, add, delete: del } = useSelectedParams({ prefix })
  const [range, setRange] = useState<DateRange | undefined>()

  const raw = get(filter.key)
  const rawStr = Array.isArray(raw) ? raw[0] : raw
  let parsed: DateFilterValue | null = null
  try {
    if (rawStr) parsed = JSON.parse(rawStr)
  } catch {}
  const hasValue = !!parsed

  const displayLabel = (() => {
    if (!parsed) return ''
    const from = parsed.$gte ? format(new Date(parsed.$gte), 'yy.MM.dd') : null
    const to = parsed.$lte ? format(new Date(parsed.$lte), 'yy.MM.dd') : null
    if (from && to) return `${from} ~ ${to}`
    return from ?? to ?? ''
  })()

  const applyPreset = (preset: (typeof PRESETS)[0]) => {
    const { from, to } = preset.getValue()
    add(filter.key, JSON.stringify({ $gte: from.toISOString(), $lte: to.toISOString() }))
    onOpenChange(false)
  }

  const applyRange = () => {
    if (!range?.from) return
    const from = startOfDay(range.from)
    const to = range.to ? endOfDay(range.to) : endOfDay(range.from)
    add(filter.key, JSON.stringify({ $gte: from.toISOString(), $lte: to.toISOString() }))
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {hasValue ? (
        <PopoverTrigger asChild>
          <FilterChip
            label={filter.label}
            value={displayLabel}
            onRemove={() => del(filter.key)}
          />
        </PopoverTrigger>
      ) : (
        <PopoverAnchor />
      )}
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          <div className="flex flex-col gap-1 border-r p-3">
            {PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="ghost"
                size="sm"
                className="justify-start text-xs"
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-3 p-3">
            <Calendar mode="range" selected={range} onSelect={setRange} numberOfMonths={1} />
            <Button size="sm" onClick={applyRange} disabled={!range?.from}>
              적용
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
