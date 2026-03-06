// src/components/common/form/form-input.tsx
"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils/ui"

interface FormInputProps extends React.ComponentProps<typeof Input> {
    error?: boolean
    helperText?: string
}

export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
    ({ className, error, helperText, ...props }, ref) => {
        return (
            <div className="space-y-1">
                <Input
                    ref={ref}
                    className={cn(
                        error && [
                            "shadow-[0px_1px_2px_rgba(239,68,68,0.12),0px_0px_0px_1px_rgba(239,68,68,0.4)]",
                            "focus:shadow-[0px_1px_2px_rgba(239,68,68,0.12),0px_0px_0px_2px_rgba(239,68,68,0.4)]"
                        ],
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

FormInput.displayName = "FormInput"