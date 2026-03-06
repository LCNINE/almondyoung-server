// src/components/common/form/form-textarea.tsx
// 폼 텍스트 에어리어
"use client"

import * as React from "react"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils/ui"

interface FormTextareaProps extends React.ComponentProps<typeof Textarea> {
    error?: boolean
    helperText?: string
}

export const FormTextarea = React.forwardRef<HTMLTextAreaElement, FormTextareaProps>(
    ({ className, error, helperText, ...props }, ref) => {
        return (
            <div className="space-y-1">
                <Textarea
                    ref={ref}
                    className={cn(
                        error && "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/50",
                        className
                    )}
                    aria-invalid={error}
                    {...props}
                />
                {helperText && (
                    <p className={cn(
                        "text-xs",
                        error ? "text-red-500" : "text-gray-500"
                    )}>
                        {helperText}
                    </p>
                )}
            </div>
        )
    }
)

FormTextarea.displayName = "FormTextarea"
