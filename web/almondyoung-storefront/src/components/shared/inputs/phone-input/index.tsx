import { cn } from "@lib/utils"
import PhoneInput, { type Country } from "react-phone-number-input"
import "react-phone-number-input/style.css"
import "./phone-input.css"

interface CustomPhoneInputProps {
  value: string
  onChange: (value: string) => void
  countryCode: string
  className?: string
  placeholder?: string
}

export default function CustomPhoneInput({
  value,
  onChange,
  countryCode,
  className,
  placeholder,
}: CustomPhoneInputProps) {
  return (
    <PhoneInput
      className={cn(className)}
      required
      defaultCountry="KR"
      country={countryCode as Country}
      placeholder={placeholder || "휴대폰번호 (숫자만 입력하세요)"}
      value={value || ""}
      onChange={(value) => onChange(value?.toString() || "")}
      onCountryChange={(country) => {
        if (country) {
          onChange(country)
        }
      }}
    />
  )
}
