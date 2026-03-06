// src/components/common/form/form-layout.tsx
// 폼 레이아웃
"use client"

import * as React from "react"
import { cn } from "@/lib/utils/ui"

export interface FormLayoutProps {
    children: React.ReactNode
    columns?: 1 | 2 | 3 | 4
    gap?: "sm" | "md" | "lg"
    className?: string
}

export function FormLayout({
    children,
    columns = 2,
    gap = "md",
    className
}: FormLayoutProps) {
    const gapClasses = {
        sm: "gap-2",
        md: "gap-4",
        lg: "gap-6"
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
                className
            )}
        >
            {children}
        </div>
    )
}
