// src/components/common/form/filter-layout.tsx
"use client"

import * as React from "react"
import { cn } from "@/lib/utils/ui"

export interface FilterLayoutProps {
    children: React.ReactNode
    columns?: 1 | 2 | 3 | 4
    gap?: "sm" | "md" | "lg"
    className?: string
    showBorder?: boolean
    padding?: "sm" | "md" | "lg"
}

export function FilterLayout({
    children,
    columns = 2,
    gap = "md",
    className,
    showBorder = true,
    padding = "md"
}: FilterLayoutProps) {
    const gapClasses = {
        sm: "gap-2",
        md: "gap-4",
        lg: "gap-6"
    }

    const paddingClasses = {
        sm: "p-3",
        md: "p-4",
        lg: "p-6"
    }

    const columnClasses = {
        1: "grid-cols-1",
        2: "grid-cols-1 md:grid-cols-2",
        3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
        4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    }

    return (
        <div
            className={cn(
                "grid",
                columnClasses[columns],
                gapClasses[gap],
                paddingClasses[padding],
                showBorder && "border border-[#D9D9D9] rounded-[10px] bg-[#F5F5F5]",
                className
            )}
        >
            {children}
        </div>
    )
}