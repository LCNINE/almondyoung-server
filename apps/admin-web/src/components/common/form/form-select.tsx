// src/components/common/form/form-select.tsx
"use client"

import * as React from "react"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import { cn } from "@/lib/utils/ui"

interface SelectOption {
    value: string
    label: string
    disabled?: boolean
}

interface FormSelectProps {
    options: SelectOption[]
    placeholder?: string
    error?: boolean
    helperText?: string
    className?: string
    value?: string
    onValueChange?: (value: string) => void
    disabled?: boolean
}

export const FormSelect = React.forwardRef<
    React.ElementRef<typeof SelectTrigger>,
    FormSelectProps
>(({
    options,
    placeholder = "선택하세요",
    error,
    helperText,
    className,
    value,
    onValueChange,
    disabled,
    ...props
}, ref) => {
    return (
        <div className="space-y-1">
            <Select value={value} onValueChange={onValueChange} disabled={disabled}>
                <SelectTrigger
                    ref={ref}
                    className={cn(
                        // 기본 스타일
                        "h-8 bg-white rounded-md border-0",
                        "shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.08)]",
                        "px-2",
                        // 텍스트 스타일
                        "text-[13px] leading-5 font-normal",
                        "[&>span]:text-[#71717A]",
                        // 포커스 스타일
                        "focus:ring-0 focus:ring-offset-0",
                        "focus:shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_2px_rgba(0,0,0,0.12)]",
                        // hover 스타일
                        "hover:shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.12)]",
                        // disabled 스타일
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                        // 에러 스타일
                        error && "shadow-[0px_1px_2px_rgba(239,68,68,0.12),0px_0px_0px_1px_rgba(239,68,68,0.4)]",
                        error && "focus:shadow-[0px_1px_2px_rgba(239,68,68,0.12),0px_0px_0px_2px_rgba(239,68,68,0.4)]",
                        className
                    )}
                    aria-invalid={error}
                    {...props}
                >
                    <SelectValue
                        placeholder={placeholder}
                        className="text-[#71717A]"
                    />
                </SelectTrigger>
                <SelectContent
                    className={cn(
                        "rounded-md",
                        "shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.08)]",
                        "border-0"
                    )}
                >
                    {options.map((option) => (
                        <SelectItem
                            key={option.value}
                            value={option.value}
                            disabled={option.disabled}
                            className={cn(
                                "text-[13px] leading-5",
                                "focus:bg-gray-50"
                            )}
                        >
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
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
})

FormSelect.displayName = "FormSelect"