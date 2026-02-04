"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { formatPhoneNumber } from "@/lib/utils/format-phone-number"
import { Control } from "react-hook-form"
import { INPUT_CLASSNAME, PHONE_MAX_LENGTH } from "./constants"
import type { ShippingAddressFormData } from "./schema"

interface FormTextFieldProps {
  control: Control<ShippingAddressFormData>
  name: keyof ShippingAddressFormData
  placeholder: string
  readOnly?: boolean
  type?: string
  inputMode?: "text" | "numeric" | "tel"
  maxLength?: number
  onChange?: (value: string) => string
  className?: string
}

export function FormTextField({
  control,
  name,
  placeholder,
  readOnly = false,
  type = "text",
  inputMode,
  maxLength,
  onChange,
  className,
}: FormTextFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormControl>
            <Input
              placeholder={placeholder}
              className={INPUT_CLASSNAME}
              type={type}
              inputMode={inputMode}
              maxLength={maxLength}
              readOnly={readOnly}
              {...field}
              value={field.value as string}
              onChange={(e) => {
                const value = onChange
                  ? onChange(e.target.value)
                  : e.target.value
                field.onChange(value)
              }}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

interface PostalCodeFieldProps {
  control: Control<ShippingAddressFormData>
  onOpenPostcode: () => void
}

export function PostalCodeField({
  control,
  onOpenPostcode,
}: PostalCodeFieldProps) {
  return (
    <div className="flex gap-2">
      <FormTextField
        control={control}
        name="postalCode"
        placeholder="우편번호"
        readOnly
        className="flex-1"
      />
      <Button
        type="button"
        variant="outline"
        className="h-12 shrink-0 px-4"
        onClick={onOpenPostcode}
      >
        주소 검색
      </Button>
    </div>
  )
}

interface PhoneFieldProps {
  control: Control<ShippingAddressFormData>
}

export function PhoneField({ control }: PhoneFieldProps) {
  return (
    <FormTextField
      control={control}
      name="phone"
      placeholder="휴대폰 번호"
      type="tel"
      inputMode="numeric"
      maxLength={PHONE_MAX_LENGTH}
      onChange={formatPhoneNumber}
    />
  )
}

interface SaveAsDefaultFieldProps {
  control: Control<ShippingAddressFormData>
  isEditMode: boolean
}

export function SaveAsDefaultField({
  control,
  isEditMode,
}: SaveAsDefaultFieldProps) {
  return (
    <FormField
      control={control}
      name="saveAsDefault"
      render={({ field }) => (
        <FormItem className="flex items-center gap-2 space-y-0">
          <FormControl>
            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
          <label
            className="cursor-pointer text-sm text-gray-700"
            onClick={() => field.onChange(!field.value)}
          >
            {isEditMode ? "기본 배송지로 설정" : "기본 배송지로 저장"}
          </label>
        </FormItem>
      )}
    />
  )
}
