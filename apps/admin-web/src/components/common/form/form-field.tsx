// src/components/common/form/form-field.tsx 수정
"use client"

import * as React from "react"
import { FormLabel } from "./form-label"
import { cn } from "@/lib/utils/ui"

export interface FormFieldProps {
    label: string
    required?: boolean
    errorMessage?: string
    helperText?: string
    children: React.ReactNode
    className?: string
    labelClassName?: string
    htmlFor?: string
    direction?: "horizontal" | "vertical"
}

export function FormField({
    label,
    required = false,
    errorMessage,
    helperText,
    children,
    className,
    labelClassName,
    htmlFor,
    direction = "vertical",
    ...props
}: FormFieldProps) {
    const generatedId = React.useId()
    const fieldId = htmlFor || generatedId
    const hasError = !!errorMessage

    // children이 단일 React element인지 확인
    const isSingleChild = React.isValidElement(children) && 
        !Array.isArray(children)

    const cloneSingleChild = (child: React.ReactElement) => {
        if (!React.isValidElement(child)) return child
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return React.cloneElement(child as React.ReactElement<any>, {
            id: fieldId,
            'aria-invalid': hasError,
            'data-error': hasError,
            'data-helper-text': errorMessage || helperText
        })
    }

    if (direction === "horizontal") {
        return (
            <div className={cn("flex gap-4 items-center", className)} {...props}>
                <FormLabel
                    htmlFor={fieldId}
                    required={required}
                    wrapperClassName={cn("flex-shrink-0", labelClassName)}
                >
                    {label}
                </FormLabel>

                <div className="flex-1">
                    {isSingleChild ? cloneSingleChild(children as React.ReactElement) : children}
                </div>
            </div>
        )
    }

    return (
        <div className={cn("space-y-2", className)} {...props}>
            <FormLabel
                htmlFor={fieldId}
                required={required}
                wrapperClassName={labelClassName}
            >
                {label}
            </FormLabel>

            {isSingleChild ? cloneSingleChild(children as React.ReactElement) : children}
        </div>
    )
}