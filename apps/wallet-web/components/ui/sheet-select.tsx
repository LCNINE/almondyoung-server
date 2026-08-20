'use client';

import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMediaQuery } from '@/checkout-ui/hooks/use-media-query';
import { Check, ChevronDown } from 'lucide-react';

export interface SheetSelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: SheetSelectOption[];
  onChange: (value: string) => void;
  title: string;
  placeholder?: string;
  triggerClassName?: string;
}

export function SheetSelect({ value, options, onChange, title, placeholder, triggerClassName }: Props) {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  if (isDesktop) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={triggerClassName}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          'flex h-11 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 text-left text-[15px]'
        }
      >
        <span className={selected ? 'text-gray-900' : 'text-gray-400'}>{selected?.label ?? placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader className="text-center">
            <DrawerTitle className="text-base font-bold">{title}</DrawerTitle>
          </DrawerHeader>
          <div className="px-2 pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-4 text-left"
                >
                  <span className={isSelected ? 'font-semibold text-[#ff6600]' : 'text-gray-800'}>{option.label}</span>
                  {isSelected && <Check className="h-5 w-5 text-[#ff6600]" />}
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
