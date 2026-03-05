// src/components/common/form/form-section.tsx
// 폼 섹션
"use client"

import * as React from "react"
import { cn } from "@/lib/utils/ui"

export interface FormSectionProps {
    title?: string
    description?: string
    children: React.ReactNode
    className?: string
    titleClassName?: string
    descriptionClassName?: string
}

export function FormSection({
    title,
    description,
    children,
    className,
    titleClassName,
    descriptionClassName
}: FormSectionProps) {
    return (
        <div className={cn("space-y-4", className)}>
            {(title || description) && (
                <div className="space-y-1">
                    {title && (
                        <h3 className={cn(
                            "text-lg font-semibold text-gray-900",
                            titleClassName
                        )}>
                            {title}
                        </h3>
                    )}
                    {description && (
                        <p className={cn(
                            "text-sm text-gray-600",
                            descriptionClassName
                        )}>
                            {description}
                        </p>
                    )}
                </div>
            )}
            <div className="space-y-4">
                {children}
            </div>
        </div>
    )
}
