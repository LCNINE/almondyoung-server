// src/components/common/form/form-date-picker.tsx
"use client"

import * as React from "react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils/ui"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import { CalendarIcon, X } from "lucide-react"

interface FormDatePickerProps {
    value?: Date
    onChange?: (date: Date | undefined) => void
    placeholder?: string
    error?: boolean
    helperText?: string
    disabled?: boolean
    className?: string
    showClearButton?: boolean
}

export const FormDatePicker = React.forwardRef<
    HTMLDivElement,
    FormDatePickerProps
>(({
    value,
    onChange,
    placeholder = "DD/MM/YYYY",
    error,
    helperText,
    disabled,
    className,
    showClearButton = true,
    ...props
}, ref) => {
    const [open, setOpen] = React.useState(false)

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation()
        onChange?.(undefined)
    }

    return (
        <div className={cn("space-y-1", className)}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <div
                        ref={ref}
                        className={cn(
                            // 기본 스타일
                            "flex flex-row items-center justify-center",
                            "w-[180px] h-8",
                            "bg-[#FAFAFA] rounded-md",
                            "shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.08)]",
                            "cursor-pointer",
                            // hover 스타일
                            "hover:shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.12)]",
                            // disabled 스타일
                            disabled && "opacity-50 cursor-not-allowed",
                            // 에러 스타일
                            error && "shadow-[0px_1px_2px_rgba(239,68,68,0.12),0px_0px_0px_1px_rgba(239,68,68,0.4)]"
                        )}
                    >
                        {/* Calendar Icon Button */}
                        <div className="flex items-center justify-center w-8 h-8 flex-shrink-0">
                            <CalendarIcon className="w-[15px] h-[15px] text-[#71717A]" />
                        </div>

                        {/* Vertical Divider */}
                        <div className="w-px h-8 bg-[#E4E4E7] flex-shrink-0" />

                        {/* Date Text */}
                        <div className="flex-1 flex items-center px-2 h-8">
                            <span className={cn(
                                "text-[13px] leading-5 font-normal",
                                value ? "text-gray-900" : "text-[#71717A]"
                            )}>
                                {value ? format(value, "yyyy-MM-dd", { locale: ko }) : placeholder}
                            </span>
                        </div>

                        {/* Clear Button */}
                        {showClearButton && value && (
                            <>
                                <div className="w-px h-8 bg-[#E4E4E7] flex-shrink-0" />
                                <button
                                    onClick={handleClear}
                                    className="flex items-center justify-center w-8 h-8 flex-shrink-0 hover:bg-gray-100 rounded-r-md"
                                    type="button"
                                >
                                    <X className="w-[15px] h-[15px] text-[#71717A]" strokeWidth={1.5} />
                                </button>
                            </>
                        )}
                    </div>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                        mode="single"
                        selected={value}
                        onSelect={(date) => {
                            onChange?.(date)
                            setOpen(false)
                        }}
                        disabled={disabled}
                        initialFocus
                        locale={ko}
                    />
                </PopoverContent>
            </Popover>
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

FormDatePicker.displayName = "FormDatePicker"