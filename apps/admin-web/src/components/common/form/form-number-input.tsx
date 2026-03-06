// src/components/common/form/form-number-input.tsx
// 폼 숫자 인풋
"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils/ui"

interface FormNumberInputProps extends Omit<React.ComponentProps<typeof Input>, 'type'> {
    error?: boolean
    helperText?: string
    min?: number
    max?: number
    step?: number
    suffix?: string
    prefix?: string
}

export const FormNumberInput = React.forwardRef<HTMLInputElement, FormNumberInputProps>(
    ({ className, error, helperText, min, max, step, suffix, prefix, ...props }, ref) => {
        const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const value = e.target.value
            // 숫자만 허용
            const numericValue = value.replace(/[^\d]/g, '')
            e.target.value = numericValue
            props.onChange?.(e)
        }

        return (
            <div className="space-y-1">
                <div className="relative">
                    {prefix && (
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                            {prefix}
                        </span>
                    )}
                    <Input
                        ref={ref}
                        type="text"
                        inputMode="numeric"
                        className={cn(
                            error && "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/50",
                            prefix && "pl-8",
                            suffix && "pr-8",
                            className
                        )}
                        aria-invalid={error}
                        min={min}
                        max={max}
                        step={step}
                        onChange={handleChange}
                        {...props}
                    />
                    {suffix && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                            {suffix}
                        </span>
                    )}
                </div>
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

FormNumberInput.displayName = "FormNumberInput"
