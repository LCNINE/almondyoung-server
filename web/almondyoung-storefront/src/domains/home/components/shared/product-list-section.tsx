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
  className,
}: ProductSectionProps) {
  return (
    <section
      className={cn(
        "w-full border-t border-gray-200 py-8 lg:py-12",
        background === "muted" && "bg-muted",
        className
      )}
    >
      <ProductListSection.Inner>{children}</ProductListSection.Inner>
    </section>
  )
}

ProductListSection.Inner = function Inner({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "container mx-auto max-w-[1360px] px-4 md:px-[40px]",
        className
      )}
    >
      {children}
    </div>
  )
}
