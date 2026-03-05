// src/components/common/form/form-checkbox.tsx
// 폼 체크박스
"use client"

import * as React from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils/ui"

interface FormCheckboxProps {
    id?: string
    label: string
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
    disabled?: boolean
    error?: boolean
    helperText?: string
    className?: string
}

export const FormCheckbox = React.forwardRef<
    React.ElementRef<typeof Checkbox>,
    FormCheckboxProps
>(({
    id,
    label,
    checked,
    onCheckedChange,
    disabled,
    error,
    helperText,
    className,
    ...props
}, ref) => {
    const generatedId = React.useId()
    const checkboxId = id ?? generatedId

    return (
        <div className={cn("space-y-1", className)}>
            <div className="flex items-center space-x-2">
                <Checkbox
                    ref={ref}
                    id={checkboxId}
                    checked={checked}
                    onCheckedChange={onCheckedChange}
                    disabled={disabled}
                    className={cn(
                        error && "border-red-500 data-[state=checked]:bg-red-500 data-[state=checked]:border-red-500"
                    )}
                    {...props}
                />
                <Label
                    htmlFor={checkboxId}
                    className={cn(
                        "text-sm font-normal cursor-pointer",
                        disabled && "opacity-50 cursor-not-allowed"
                    )}
                >
                    {label}
                </Label>
            </div>
            {helperText && (
                <p className={cn(
                    "text-xs ml-6",
                    error ? "text-red-500" : "text-gray-500"
                )}>
                    {helperText}
                </p>
            )}
        </div>
    )
})

FormCheckbox.displayName = "FormCheckbox"
