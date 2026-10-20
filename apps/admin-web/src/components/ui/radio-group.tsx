"use client"

import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { CircleIcon } from "lucide-react"

import { cn } from "@/lib/utils/ui"
import { useReadOnlyControl } from "@/components/auth/permission-read-only-context"
import { blockWhileReadOnly } from "@/lib/auth/read-only-control"

function RadioGroup({
  className,
  disabled,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  // 권한 때문에 읽기 전용인 편집 폼 안이면 값만 보인다(포커스는 남기고 값 변경은 항목에서 막는다)
  const control = useReadOnlyControl(disabled)
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
      disabled={control.disabled}
      aria-disabled={control['aria-disabled']}
      aria-describedby={control['aria-describedby']}
    />
  )
}

function RadioGroupItem({
  className,
  disabled,
  onClick,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  const { blocked, ...control } = useReadOnlyControl(disabled)
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 aspect-square size-4 shrink-0 rounded-full border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
        className
      )}
      {...props}
      {...control}
      onClick={blockWhileReadOnly(blocked, onClick)}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="fill-primary absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
