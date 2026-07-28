"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export const floatingInputClass =
  "peer h-14 rounded-lg border border-input bg-muted px-3 pt-6 pb-2 text-base " +
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 " +
  "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 " +
  // 크롬 자동완성이 강제하는 파란 배경을 inset shadow 로 덮는다.
  "autofill:shadow-[inset_0_0_0_1000px_var(--muted)] autofill:[-webkit-text-fill-color:var(--foreground)]"

export const floatingLabelClass =
  "pointer-events-none absolute left-3 top-2 text-xs text-muted-foreground transition-all " +
  "peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base " +
  "peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-xs " +
  "peer-disabled:opacity-50"

export function FloatingField({
  htmlFor,
  label,
  className,
  children,
}: {
  htmlFor: string
  label: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("relative", className)}>
      {children}
      <Label htmlFor={htmlFor} className={floatingLabelClass}>
        {label}
      </Label>
    </div>
  )
}

export function FloatingLabelInput({
  label,
  id,
  className,
  ...props
}: React.ComponentProps<typeof Input> & {
  label: React.ReactNode
  id: string
}) {
  return (
    <FloatingField htmlFor={id} label={label}>
      <Input
        id={id}
        placeholder=" "
        className={cn(floatingInputClass, className)}
        {...props}
      />
    </FloatingField>
  )
}
