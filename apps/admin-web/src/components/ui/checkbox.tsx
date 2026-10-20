"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils/index"
import { useReadOnlyControl } from "@/components/auth/permission-read-only-context"
import { blockWhileReadOnly } from "@/lib/auth/read-only-control"

function Checkbox({
  className,
  disabled,
  onClick,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  // 권한 때문에 읽기 전용인 편집 폼 안이면 값만 보인다(포커스는 남기고 값 변경만 막는다)
  const { blocked, ...control } = useReadOnlyControl(disabled)
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-input shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:bg-input/30 dark:aria-invalid:ring-destructive/40 dark:data-[state=checked]:bg-primary",
        className
      )}
      {...props}
      {...control}
      onClick={blockWhileReadOnly(blocked, onClick)}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
