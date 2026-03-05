// src/components/common/form/form-radio-group.tsx
// 폼 라디오 그룹
"use client"

import * as React from "react"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils/ui"

interface RadioOption {
    value: string
    label: string
    disabled?: boolean
}

interface FormRadioGroupProps {
    options: RadioOption[]
    value?: string
    onValueChange?: (value: string) => void
    disabled?: boolean
    error?: boolean
    helperText?: string
    className?: string
    orientation?: "horizontal" | "vertical"
}

export const FormRadioGroup = React.forwardRef<
    React.ElementRef<typeof RadioGroup>,
    FormRadioGroupProps
>(({
    options,
    value,
    onValueChange,
    disabled,
    error,
    helperText,
    className,
    orientation = "horizontal",
    ...props
}, ref) => {
    return (
        <div className={cn("space-y-1", className)}>
            <RadioGroup
                ref={ref}
                value={value}
                onValueChange={onValueChange}
                disabled={disabled}
                className={cn(
                    orientation === "horizontal" ? "flex flex-wrap gap-4" : "space-y-2"
                )}
                {...props}
            >
                {options.map((option) => (
                    // ⭐️ 변경점: CSS 스펙에 맞게 gap을 6px로 조정
                    <div key={option.value} className="flex items-center gap-[6px]">
                        <RadioGroupItem
                            value={option.value}
                            id={option.value}
                            disabled={option.disabled || disabled}
                            className={cn(
                                "h-5 w-5 rounded-full border-0 text-white", // 기본 크기(20px), 기본 테두리 제거, 내부 점 흰색
                                "focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2", // 포커스링 스타일

                                // 선택되지 않은 상태 (Unchecked State)
                                "data-[state=unchecked]:bg-[#FAFAFA]",
                                "data-[state=unchecked]:shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.08)]",

                                // 선택된 상태 (Checked State)
                                "data-[state=checked]:bg-[#3B82F6]",
                                "data-[state=checked]:shadow-[0px_1px_2px_rgba(30,58,138,0.5),0px_0px_0px_1px_#3B82F6]",

                                // 에러 상태는 기존 스타일을 유지하거나 필요에 따라 커스텀할 수 있습니다.
                                error && "shadow-[0px_0px_0px_2px_#ef4444]! data-[state=checked]:bg-red-500"
                            )}
                        />
                        <Label
                            htmlFor={option.value}
                            className={cn(
                                "text-[15px] font-bold text-black cursor-pointer",
                                (disabled || option.disabled) && "opacity-50 cursor-not-allowed"
                            )}
                        >
                            {option.label}
                        </Label>
                    </div>
                ))}
            </RadioGroup>
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

FormRadioGroup.displayName = "FormRadioGroup"