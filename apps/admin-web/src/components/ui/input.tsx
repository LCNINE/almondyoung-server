"use client"

import * as React from "react"

import { usePermissionReadOnly } from "@/components/auth/permission-read-only-context"

import { cn } from "@/lib/utils/index"

function Input({ className, type, readOnly, ...props }: React.ComponentProps<"input">) {
  // 권한 때문에 읽기 전용인 편집 폼 안이면 값은 보이고 고칠 수 없다(포커스·복사·낭독은 된다)
  const permissionReadOnly = usePermissionReadOnly() !== null
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
      readOnly={readOnly || permissionReadOnly}
    />
  )
}

export { Input }
