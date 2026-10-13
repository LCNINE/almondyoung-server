"use client"

import * as React from "react"

import { usePermissionReadOnly } from "@/components/auth/permission-read-only-context"

import { cn } from "@/lib/utils/index"

function Textarea({ className, readOnly, ...props }: React.ComponentProps<"textarea">) {
  // 권한 때문에 읽기 전용인 편집 폼 안이면 값은 보이고 고칠 수 없다
  const permissionReadOnly = usePermissionReadOnly() !== null
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
      readOnly={readOnly || permissionReadOnly}
    />
  )
}

export { Textarea }
