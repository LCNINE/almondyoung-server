"use client"

import { X } from "lucide-react"

import { cn } from "@/lib/utils"

export function ClearInputButton({
  inputId,
  label,
  className,
}: {
  inputId: string
  label: string
  className?: string
}) {
  function clearInput() {
    const input = document.getElementById(inputId)

    if (
      !(input instanceof HTMLInputElement) ||
      input.disabled ||
      input.readOnly
    ) {
      return
    }

    // Use the native setter so React also observes the change on controlled fields.
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set

    setValue?.call(input, "")
    input.setCustomValidity("")
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.focus()
  }

  return (
    <button
      type="button"
      aria-label={`${label} 지우기`}
      aria-controls={inputId}
      onPointerDown={(event) => event.preventDefault()}
      onClick={clearInput}
      className={cn(
        "absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors peer-placeholder-shown:hidden peer-read-only:hidden peer-disabled:hidden hover:text-foreground focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className
      )}
    >
      <X className="size-4" aria-hidden />
    </button>
  )
}
