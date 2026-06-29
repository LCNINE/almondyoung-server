"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PERSONAL_CUSTOMS_CODE_URL } from "@/domains/checkout/utils/customs"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

interface CustomsCodeSectionProps {
  value: string
  onChange: (value: string) => void
  error?: string | null
}

/**
 * 개인통관고유부호 입력 섹션.
 * 카트에 해외직구 상품이 있을 때만 노출된다 (호출부에서 조건부 렌더).
 */
export function CustomsCodeSection({
  value,
  onChange,
  error,
}: CustomsCodeSectionProps) {
  const t = useTranslations("checkout.customsCode")

  return (
    <section aria-labelledby="customs-code-heading" className="mb-8">
      <h2
        id="customs-code-heading"
        className="mb-3 text-base font-bold text-gray-900 lg:text-xl"
      >
        {t("title")}
      </h2>
      <div className="rounded-md border border-gray-200 bg-white px-[14px] py-[18px] lg:rounded-[10px] lg:px-10 lg:py-8">
        <Label
          htmlFor="personal-customs-code"
          className="mb-2 block text-[13px] font-medium text-gray-900 lg:text-sm"
        >
          {t("label")} <span className="text-red-500">*</span>
        </Label>
        <Input
          id="personal-customs-code"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("placeholder")}
          maxLength={13}
          autoComplete="off"
          aria-invalid={!!error}
          className={cn(
            "h-auto w-full rounded border border-gray-300 px-3 py-2.5 text-[13px] text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white lg:rounded-[5px] lg:px-4 lg:py-3.5 lg:text-sm",
            error && "border-red-400 focus:border-red-400"
          )}
        />
        {error && (
          <p className="mt-1.5 text-[11px] text-red-500 lg:text-xs">{error}</p>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-gray-500 lg:text-xs">
          {t("notice")}
        </p>
        <a
          href={PERSONAL_CUSTOMS_CODE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary mt-2 inline-block text-[12px] font-medium underline underline-offset-2 lg:text-sm"
        >
          {t("lookupLink")}
        </a>
      </div>
    </section>
  )
}
