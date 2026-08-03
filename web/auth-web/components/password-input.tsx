"use client"

import { Eye, EyeOff } from "lucide-react"
import * as React from "react"

import { floatingLabelClass } from "@/components/ui/floating-label-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

function PasswordInput({
  className,
  label,
  id,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type"> & {
  label?: React.ReactNode
}) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        className={cn("pr-9", className)}
        {...props}
      />
      {label && (
        <Label htmlFor={id} className={floatingLabelClass}>
          {label}
        </Label>
      )}
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
        aria-pressed={visible}
        tabIndex={-1}
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </div>
  )
}

export { PasswordInput }
