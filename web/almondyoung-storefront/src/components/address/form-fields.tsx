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
import { PHONE_MAX_LENGTH } from "./constants"
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
              className="h-12 rounded-md border border-gray-300 px-4 aria-[invalid=true]:border-red-500"
              type={type}
              inputMode={inputMode}
              maxLength={maxLength}
              readOnly={readOnly}
              {...field}
              value={(field.value as string) ?? ""}
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
  placeholder: string
  searchLabel: string
  onOpenPostcode: () => void
}

/** ko 전용: 우편번호 검색(Daum) 버튼이 붙은 read-only 입력 */
export function PostalCodeField({
  control,
  placeholder,
  searchLabel,
  onOpenPostcode,
}: PostalCodeFieldProps) {
  return (
    <div className="flex gap-2">
      <FormTextField
        control={control}
        name="postalCode"
        placeholder={placeholder}
        readOnly
        className="flex-1"
      />
      <Button
        type="button"
        variant="outline"
        className="h-12 shrink-0 px-4"
        onClick={onOpenPostcode}
      >
        {searchLabel}
      </Button>
    </div>
  )
}

interface PhoneFieldProps {
  control: Control<ShippingAddressFormData>
  placeholder: string
  /** ko: 자동 하이픈 포맷팅 + 길이 제한. en/ja: 자유 입력 */
  autoFormat: boolean
}

export function PhoneField({ control, placeholder, autoFormat }: PhoneFieldProps) {
  return (
    <FormTextField
      control={control}
      name="phone"
      placeholder={placeholder}
      type="tel"
      inputMode={autoFormat ? "numeric" : "tel"}
      maxLength={autoFormat ? PHONE_MAX_LENGTH : undefined}
      onChange={autoFormat ? formatPhoneNumber : undefined}
    />
  )
}

interface SaveAsDefaultFieldProps {
  control: Control<ShippingAddressFormData>
  label: string
}

export function SaveAsDefaultField({ control, label }: SaveAsDefaultFieldProps) {
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
            {label}
          </label>
        </FormItem>
      )}
    />
  )
}
