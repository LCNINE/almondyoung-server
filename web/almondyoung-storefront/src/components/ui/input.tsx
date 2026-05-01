import * as React from "react"

import { cn } from "@lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "inline-flex h-9 w-full items-center justify-start gap-2.5 border-b border-neutral-400 bg-zinc-100 px-4 py-3 text-xs leading-5 text-black placeholder:text-xs placeholder:leading-5 placeholder:text-neutral-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
