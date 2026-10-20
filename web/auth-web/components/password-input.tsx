"use client"

import { Eye, EyeOff } from "lucide-react"
import * as React from "react"

import { ClearInputButton } from "@/components/ui/clear-input-button"
import { floatingLabelClass } from "@/components/ui/floating-label-input"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

function PasswordInput({
  className,
  label,
  id,
  clearable = false,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type"> & {
  label?: React.ReactNode
  clearable?: boolean
}) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        className={cn(className, "peer pr-11", clearable && "pr-[5.5rem]")}
        {...props}
      />
      {clearable && id && (
        <ClearInputButton
          inputId={id}
          label={typeof label === "string" ? label : "비밀번호"}
          className="right-11 justify-end pr-1"
        />
      )}
      {label && (
        <Label htmlFor={id} className={floatingLabelClass}>
          {label}
        </Label>
      )}
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className={cn(
          "absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none",
          clearable && "justify-start pl-3"
        )}
        aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
        aria-pressed={visible}
        aria-controls={id}
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
