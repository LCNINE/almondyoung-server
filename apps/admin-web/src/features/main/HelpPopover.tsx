'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { X } from 'lucide-react';

export function HelpPopover({ label, items }: { label: string; items: string[] }) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        aria-label={`${label} 설명`}
        className="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#AEB4C6] text-[10px] font-bold leading-none text-white data-[state=open]:bg-[#3971FF]"
      >
        ?
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          alignOffset={-14}
          sideOffset={10}
          className="relative z-50 w-[510px] max-w-[calc(100vw-32px)] rounded-[2px] border border-[#D6DAE1] bg-white p-4 pr-8 text-[15px] leading-5 text-[#1B1B1B] outline-none"
        >
          <span
            aria-hidden
            className="absolute -top-[5px] left-[16px] h-2 w-2 rotate-45 border-l border-t border-[#D6DAE1] bg-white"
          />
          <PopoverPrimitive.Close aria-label="닫기" className="cursor-pointer absolute right-2 top-2 text-[#1B1E26]">
            <X className="h-4 w-4" />
          </PopoverPrimitive.Close>
          <ul className="space-y-2.5">
            {items.map((item) => (
              <li
                key={item}
                className="relative pl-3 before:absolute before:left-0 before:top-2.5 before:h-px before:w-1 before:bg-[#616161]"
              >
                {item}
              </li>
            ))}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
