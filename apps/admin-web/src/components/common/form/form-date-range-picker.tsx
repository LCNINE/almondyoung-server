// src/components/common/form/form-date-range-picker.tsx
"use client"

import * as React from "react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils/ui"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import { CalendarIcon, X } from "lucide-react"
import { DateRange } from "react-day-picker"

interface FormDateRangePickerProps {
    value?: DateRange
    onChange?: (range: DateRange | undefined) => void
    placeholder?: string
    error?: boolean
    helperText?: string
    disabled?: boolean
    className?: string
    showClearButton?: boolean
}

export const FormDateRangePicker = React.forwardRef<
    HTMLDivElement,
    FormDateRangePickerProps
>(({
    value,
    onChange,
    placeholder = "날짜 범위를 선택하세요",
    error,
    helperText,
    disabled,
    className,
    showClearButton = true,
    ...props
}, ref) => {
    const [openFrom, setOpenFrom] = React.useState(false)
    const [openTo, setOpenTo] = React.useState(false)

    const handleClear = (type: 'from' | 'to') => (e: React.MouseEvent) => {
        e.stopPropagation()
        if (type === 'from') {
            onChange?.(value?.to ? { from: undefined, to: value.to } : undefined)
        } else {
            onChange?.(value?.from ? { from: value.from, to: undefined } : undefined)
        }
    }

    return (
        <div ref={ref} className={cn("space-y-1", className)}>
            <div className="flex items-center gap-[9px]">
                {/* From Date Picker */}
                <Popover open={openFrom} onOpenChange={setOpenFrom}>
                    <PopoverTrigger asChild>
                        <div
                            className={cn(
                                "flex flex-row items-center justify-center",
                                "w-[180px] h-8",
                                "bg-[#FAFAFA] rounded-md",
                                "shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.08)]",
                                "cursor-pointer",
                                "hover:shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.12)]",
                                disabled && "opacity-50 cursor-not-allowed",
                                error && "shadow-[0px_1px_2px_rgba(239,68,68,0.12),0px_0px_0px_1px_rgba(239,68,68,0.4)]"
                            )}
                        >
                            <div className="flex items-center justify-center w-8 h-8 flex-shrink-0">
                                <CalendarIcon className="w-[15px] h-[15px] text-[#71717A]" />
                            </div>

                            <div className="w-px h-8 bg-[#E4E4E7] flex-shrink-0" />

                            <div className="flex-1 flex items-center px-2 h-8">
                                <span className={cn(
                                    "text-[13px] leading-5 font-normal",
                                    value?.from ? "text-gray-900" : "text-[#71717A]"
                                )}>
                                    {value?.from ? format(value.from, "yyyy-MM-dd", { locale: ko }) : placeholder}
                                </span>
                            </div>

                            {showClearButton && value?.from && (
                                <>
                                    <div className="w-px h-8 bg-[#E4E4E7] flex-shrink-0" />
                                    <button
                                        onClick={handleClear('from')}
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
                            mode="range"
                            selected={value}
                            onSelect={(range) => {
                                onChange?.(range)
                                if (range?.from && range?.to) {
                                    setOpenFrom(false)
                                }
                            }}
                            disabled={disabled}
                            initialFocus
                            locale={ko}
                            numberOfMonths={2}
                        />
                    </PopoverContent>
                </Popover>

                {/* Separator ~ */}
                <span className="text-[13px] leading-5 font-normal text-black px-3">~</span>

                {/* To Date Picker */}
                <Popover open={openTo} onOpenChange={setOpenTo}>
                    <PopoverTrigger asChild>
                        <div
                            className={cn(
                                "flex flex-row items-center justify-center",
                                "w-[180px] h-8",
                                "bg-[#FAFAFA] rounded-md",
                                "shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.08)]",
                                "cursor-pointer",
                                "hover:shadow-[0px_1px_2px_rgba(0,0,0,0.12),0px_0px_0px_1px_rgba(0,0,0,0.12)]",
                                disabled && "opacity-50 cursor-not-allowed",
                                error && "shadow-[0px_1px_2px_rgba(239,68,68,0.12),0px_0px_0px_1px_rgba(239,68,68,0.4)]"
                            )}
                        >
                            <div className="flex items-center justify-center w-8 h-8 flex-shrink-0">
                                <CalendarIcon className="w-[15px] h-[15px] text-[#71717A]" />
                            </div>

                            <div className="w-px h-8 bg-[#E4E4E7] flex-shrink-0" />

                            <div className="flex-1 flex items-center px-2 h-8">
                                <span className={cn(
                                    "text-[13px] leading-5 font-normal",
                                    value?.to ? "text-gray-900" : "text-[#71717A]"
                                )}>
                                    {value?.to ? format(value.to, "yyyy-MM-dd", { locale: ko }) : placeholder}
                                </span>
                            </div>

                            {showClearButton && value?.to && (
                                <>
                                    <div className="w-px h-8 bg-[#E4E4E7] flex-shrink-0" />
                                    <button
                                        onClick={handleClear('to')}
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
                            mode="range"
                            selected={value}
                            onSelect={(range) => {
                                onChange?.(range)
                                if (range?.from && range?.to) {
                                    setOpenTo(false)
                                }
                            }}
                            disabled={disabled}
                            initialFocus
                            locale={ko}
                            numberOfMonths={2}
                        />
                    </PopoverContent>
                </Popover>
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
})

FormDateRangePicker.displayName = "FormDateRangePicker"