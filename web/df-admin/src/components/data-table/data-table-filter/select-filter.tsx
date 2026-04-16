import { Check } from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useSelectedParams } from "@/hooks/use-selected-params"
import { FilterChip } from "./filter-chip"
import type { Filter } from "./types"

type SelectFilterProps = {
  filter: Extract<Filter, { type: "select" }>
  open: boolean
  onOpenChange: (open: boolean) => void
  prefix?: string
}

export function SelectFilter({
  filter,
  open,
  onOpenChange,
  prefix,
}: SelectFilterProps) {
  const { get, add, delete: del } = useSelectedParams({ prefix })
  const raw = get(filter.key)
  const values = raw ? (Array.isArray(raw) ? raw : [raw]) : []
  const hasValue = values.length > 0

  const handleSelect = (optValue: string) => {
    if (filter.multiple) {
      const next = values.includes(optValue)
        ? values.filter((v) => v !== optValue)
        : [...values, optValue]
      if (next.length === 0) del(filter.key)
      else add(filter.key, next)
    } else {
      add(filter.key, optValue)
      onOpenChange(false)
    }
  }

  const displayLabel = values
    .map((v) => filter.options.find((o) => o.value === v)?.label ?? v)
    .join(", ")

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
      <PopoverContent
        className="w-48 p-0"
        align="start"
        onFocusOutside={(e) => e.preventDefault()}
      >
        <Command>
          {filter.searchable && (
            <CommandInput placeholder={`${filter.label} 검색...`} />
          )}
          <CommandList>
            <CommandEmpty>결과 없음</CommandEmpty>
            <CommandGroup>
              {filter.options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.value}
                  onSelect={() => handleSelect(opt.value)}
                >
                  {opt.label}
                  {values.includes(opt.value) && (
                    <Check className="ml-auto h-4 w-4" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
