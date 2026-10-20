"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils/ui"
import { useReadOnlyControl } from "@/components/auth/permission-read-only-context"
import { blockWhileReadOnly } from "@/lib/auth/read-only-control"

function Switch({
  className,
  disabled,
  onClick,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  // 권한 때문에 읽기 전용인 편집 폼 안이면 값만 보인다(포커스는 남기고 값 변경만 막는다)
  const { blocked, ...control } = useReadOnlyControl(disabled)
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
        className
      )}
      {...props}
      {...control}
      onClick={blockWhileReadOnly(blocked, onClick)}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
