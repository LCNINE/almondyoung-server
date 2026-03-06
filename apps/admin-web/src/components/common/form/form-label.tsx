// src/components/common/form/form-label.tsx
"use client"

import * as React from "react"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils/ui"

interface FormLabelProps extends React.ComponentProps<typeof Label> {
    required?: boolean
    children: React.ReactNode
    wrapperClassName?: string
}

export function FormLabel({
    required = false,
    children,
    className,
    wrapperClassName,
    ...props
}: FormLabelProps) {
    return (
        <div 
            className={cn("flex items-center gap-2", wrapperClassName)}
        >
            {required && (
                <div
                    className="w-[14px] h-[14px] bg-[#B81C1C] rounded-[3px] flex-shrink-0"
                    aria-label="필수 항목"
                />
            )}
            <Label
                className={cn(
                    "font-pretendard font-bold text-base leading-[18px] text-[#1F2937]",
                    className
                )}
                {...props}
            >
                {children}
            </Label>
        </div>
    )
}