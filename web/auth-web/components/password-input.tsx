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
  appearance = "floating",
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type"> & {
  label?: React.ReactNode
  clearable?: boolean
  appearance?: "floating" | "line"
}) {
  const [visible, setVisible] = React.useState(false)
  const isLine = appearance === "line"

  return (
    <div className="group relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        className={cn(
          className,
          "peer pr-11",
          clearable && "pr-[5.5rem]",
          isLine &&
            "h-16 rounded-none border-0 border-b border-slate-300 bg-transparent pt-7 pb-2 pl-0 caret-[#06c755] shadow-none group-focus-within:border-[#06c755] focus-visible:border-[#06c755] focus-visible:ring-0 aria-invalid:border-destructive aria-invalid:ring-0"
        )}
        {...props}
      />
      {clearable && id && (
        <ClearInputButton
          inputId={id}
          label={typeof label === "string" ? label : "비밀번호"}
          circled={isLine}
          className={cn(
            "right-11",
            isLine &&
              "top-5 justify-end pr-1 text-slate-300 hover:text-slate-500"
          )}
        />
      )}
      {label && (
        <Label
          htmlFor={id}
          className={
            isLine
              ? "pointer-events-none absolute top-1 left-0 text-xs text-muted-foreground peer-disabled:opacity-50"
              : floatingLabelClass
          }
        >
          {label}
          {isLine && props.required && (
            <span className="ml-1 text-destructive" aria-hidden>
              *
            </span>
          )}
        </Label>
      )}
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className={cn(
          "absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none",
          isLine &&
            "top-5 justify-start pl-3 text-slate-300 hover:text-slate-500"
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
