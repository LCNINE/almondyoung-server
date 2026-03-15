import * as React from "react"

import { cn } from "@/lib/utils/cn"

const Container = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "shadow-[0px_0px_0px_2px_rgba(0,0,0,0.12)] w-full rounded-lg",
        className
      )}
      {...props}
    />
  )
})
Container.displayName = "Container"

export { Container }