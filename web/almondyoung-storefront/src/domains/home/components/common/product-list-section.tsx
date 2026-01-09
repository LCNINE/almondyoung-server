import { cn } from "@lib/utils"
import React from "react"

interface ProductSectionProps {
  children: React.ReactNode
  background?: "white" | "muted"
  className?: string
}

export function ProductListSection({
  children,
  background = "white",
  className = "",
}: ProductSectionProps) {
  return (
    <section
      className={cn(
        "w-full border-t border-gray-200 py-8 lg:py-12",
        background === "muted" && "bg-muted",
        className
      )}
    >
      <div className="container mx-auto max-w-[1360px] px-4 md:px-[40px]">
        {children}
      </div>
    </section>
  )
}
