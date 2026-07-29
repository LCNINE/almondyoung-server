// src/components/common/form/form-multi-select.tsx
'use client';

import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils/ui';

interface MultiSelectOption {
  value: string;
  label: string;
}

interface FormMultiSelectProps {
  options: MultiSelectOption[];
  /** 선택된 값들. 빈 배열 = 전체 */
  value: string[];
  onValueChange: (value: string[]) => void;
  /** 아무것도 선택 안 했을 때 표시할 문구 (예: '전체 공급처') */
  allLabel: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}

export function FormMultiSelect({
  options,
  value,
  onValueChange,
  allLabel,
  searchPlaceholder = '검색',
  emptyText = '결과가 없습니다',
  className,
  disabled,
}: FormMultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const toggle = (v: string) =>
    onValueChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  // ponytail: 칩을 늘어놓으면 필터 줄 높이가 흔들린다. '첫 항목 외 N' 한 줄로 고정.
  const label = React.useMemo(() => {
    if (value.length === 0) return allLabel;
    const first = options.find((o) => o.value === value[0])?.label ?? value[0];
    return value.length === 1 ? first : `${first} 외 ${value.length - 1}`;
  }, [value, options, allLabel]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'flex h-8 w-full items-center justify-between gap-2 rounded-md border-0 bg-white px-2',
            'shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.08)]',
            'text-[13px] leading-5 font-normal',
            'hover:shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.12)]',
            'focus:outline-none focus:shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_2px_rgba(0,0,0,0.12)]',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
        >
          <span className={cn('truncate', value.length === 0 && 'text-[#71717A]')}>{label}</span>
          <span className="flex shrink-0 items-center gap-1">
            {value.length > 1 && (
              <span className="rounded bg-gray-100 px-1 text-[11px] leading-4 text-gray-600">
                {value.length}
              </span>
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] border-0 p-0 shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.08)]"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="text-[13px]" />
          <CommandList className="max-h-64">
            <CommandEmpty className="py-4 text-center text-[13px] text-gray-500">
              {emptyText}
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={allLabel}
                onSelect={() => onValueChange([])}
                className="text-[13px]"
              >
                <Check
                  className={cn('mr-2 h-4 w-4', value.length === 0 ? 'opacity-100' : 'opacity-0')}
                />
                {allLabel}
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => toggle(option.value)}
                  className="text-[13px]"
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value.includes(option.value) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
