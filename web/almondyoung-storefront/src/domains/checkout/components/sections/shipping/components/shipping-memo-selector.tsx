"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import { SHIPPING_MEMO_OPTIONS } from "../constants"
import type { ShippingMemo } from "../types"

interface ShippingMemoSelectorProps {
  shippingMemo: ShippingMemo
  onShippingMemoChange: (memo: ShippingMemo) => void
}

/**
 * 배송 메모 선택 컴포넌트
 */
export function ShippingMemoSelector({
  shippingMemo,
  onShippingMemoChange,
}: ShippingMemoSelectorProps) {
  const t = useTranslations("checkout.shipping.memo")
  const { type, custom, hasEntrance, entrancePassword } = shippingMemo

  const updateMemo = (updates: Partial<ShippingMemo>) => {
    onShippingMemoChange({ ...shippingMemo, ...updates })
  }

  const handleTypeChange = (value: string) => {
    updateMemo({
      type: value,
      custom: value === "other" ? custom : "",
      // "문 앞에 놔주세요" 선택 시 기본값으로 공동현관 비밀번호 있음 선택
      hasEntrance: value === "door" ? true : false,
      entrancePassword: value === "door" ? entrancePassword : "",
    })
  }

  return (
    <fieldset className="mt-4 space-y-3">
      <legend className="sr-only">{t("legend")}</legend>

      {/* 메모 타입 선택 */}
      <Select value={type} onValueChange={handleTypeChange}>
        <SelectTrigger
          className={cn(
            "h-auto w-full rounded border border-gray-300 bg-white px-3 py-2.5 text-[13px] text-gray-700 lg:rounded-[5px] lg:px-4 lg:py-3.5 lg:text-sm",
            !type && "text-gray-400"
          )}
          aria-label={t("selectAria")}
        >
          <SelectValue placeholder={t("placeholder")} />
        </SelectTrigger>
        <SelectContent>
          {SHIPPING_MEMO_OPTIONS.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="cursor-pointer py-2.5 text-[13px] lg:text-sm"
            >
              {t(`options.${option.labelKey}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 문 앞 선택 시: 공동현관 옵션 */}
      {type === "door" && (
        <EntranceSection
          hasEntrance={hasEntrance}
          entrancePassword={entrancePassword}
          onHasEntranceChange={(checked) =>
            updateMemo({
              hasEntrance: checked,
              entrancePassword: checked ? entrancePassword : "",
            })
          }
          onPasswordChange={(value) => updateMemo({ entrancePassword: value })}
        />
      )}

      {/* 기타 선택 시: 직접 입력 */}
      {type === "other" && (
        <CustomMemoInput
          value={custom}
          onChange={(value) => updateMemo({ custom: value })}
        />
      )}
    </fieldset>
  )
}

/**
 * 공동현관 출입번호 섹션
 */
function EntranceSection({
  hasEntrance,
  entrancePassword,
  onHasEntranceChange,
  onPasswordChange,
}: {
  hasEntrance: boolean
  entrancePassword: string
  onHasEntranceChange: (checked: boolean) => void
  onPasswordChange: (value: string) => void
}) {
  const t = useTranslations("checkout.shipping.memo.entrance")
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h4 className="mb-3 text-[13px] font-semibold text-gray-900 lg:text-sm">
        {t("heading")}
      </h4>

      <RadioGroup
        value={hasEntrance ? "yes" : "no"}
        onValueChange={(value) => onHasEntranceChange(value === "yes")}
        className="space-y-3"
      >
        {/* 비밀번호 있음 옵션 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="yes" id="entrance-yes" />
            <Label
              htmlFor="entrance-yes"
              className="cursor-pointer text-[13px] font-normal text-gray-700 lg:text-sm"
            >
              {t("hasEntrance")}
            </Label>
          </div>

          {hasEntrance && (
            <Input
              id="entrance-password"
              type="text"
              value={entrancePassword}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              maxLength={20}
              className="bg-background ml-6 h-auto w-[calc(100%-24px)] rounded border border-gray-300 px-3 py-2.5 text-[13px] placeholder:text-gray-400 focus:border-gray-400 focus:bg-white lg:rounded-[5px] lg:px-4 lg:py-3.5 lg:text-sm"
            />
          )}
        </div>

        {/* 비밀번호 없음 옵션 */}
        <div className="flex items-center gap-2">
          <RadioGroupItem value="no" id="entrance-no" />
          <Label
            htmlFor="entrance-no"
            className="cursor-pointer text-[13px] font-normal text-gray-700 lg:text-sm"
          >
            {t("noEntrance")}
          </Label>
        </div>
      </RadioGroup>

      <p className="mt-3 text-[11px] leading-relaxed text-gray-500 lg:text-xs">
        {t("notice")}
      </p>
    </div>
  )
}

/**
 * 직접 입력 메모 필드
 */
function CustomMemoInput({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const t = useTranslations("checkout.shipping.memo")
  return (
    <div className="relative">
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("customPlaceholder")}
        maxLength={50}
        className="h-auto w-full rounded border border-gray-300 px-3 py-2.5 pr-14 text-[13px] text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white lg:rounded-[5px] lg:px-4 lg:py-3.5 lg:text-sm"
        aria-label={t("customAria")}
      />
      <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-gray-400 lg:text-xs">
        {value.length}/50
      </span>
    </div>
  )
}
