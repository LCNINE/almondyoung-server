// src/components/common/form/form.tsx
// React Hook Form과 연동하는 Form 컴포넌트
"use client"

import * as React from "react"
import { useForm, UseFormReturn, FieldValues, Path, DefaultValues } from "react-hook-form"
import { FormProvider } from "react-hook-form"

interface FormProps<T extends FieldValues> {
    children: (methods: UseFormReturn<T>) => React.ReactNode
    onSubmit: (data: T) => void | Promise<void>
    defaultValues?: DefaultValues<T>
    className?: string
}

export function Form<T extends FieldValues>({
    children,
    onSubmit,
    defaultValues,
    className
}: FormProps<T>) {
    const methods = useForm<T>({
        defaultValues,
        mode: "onChange"
    })

    return (
        <FormProvider {...methods}>
            <form
                onSubmit={methods.handleSubmit(onSubmit)}
                className={className}
            >
                {children(methods)}
            </form>
        </FormProvider>
    )
}

// React Hook Form과 연동하는 FormField
interface FormFieldProps<T extends FieldValues> {
    name: Path<T>
    label: string
    required?: boolean
    children: (field: {
        value: any
        onChange: (value: any) => void
        onBlur: () => void
        error?: string
    }) => React.ReactNode
    className?: string
}

export function FormField<T extends FieldValues>({
    name,
    label,
    required = false,
    children,
    className
}: FormFieldProps<T>) {
    const { register, formState: { errors } } = useForm<T>()
    const error = errors[name]?.message as string

    return (
        <div className={className}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
                {required && <span className="text-red-500 mr-1">*</span>}
                {label}
            </label>
            {children({
                value: undefined, // register에서 관리
                onChange: () => { }, // register에서 관리
                onBlur: () => { }, // register에서 관리
                error
            })}
        </div>
    )
}
