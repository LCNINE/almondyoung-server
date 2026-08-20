"use client"

import { Input } from "@/checkout-ui/components/ui/input"
import { Label } from "@/checkout-ui/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/checkout-ui/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/checkout-ui/components/ui/select"
import { cn } from "@/checkout-ui/lib/utils"
import { useTranslations } from "next-intl"
import { useEffect, useRef } from "react"
import { SHIPPING_MEMO_OPTIONS } from "../constants"
import type { ShippingMemo } from "../types"
import type { ShippingMemoError } from "../utils"

interface ShippingMemoSelectorProps {
  shippingMemo: ShippingMemo
  onShippingMemoChange: (memo: ShippingMemo) => void
  error?: ShippingMemoError | null
  errorAttempt?: number
}

/**
 * 배송 메모 선택 컴포넌트
 */
export function ShippingMemoSelector({
  shippingMemo,
  onShippingMemoChange,
  error,
  errorAttempt = 0,
}: ShippingMemoSelectorProps) {
  const t = useTranslations("checkout.shipping.memo")
  const tError = useTranslations("checkout.process.toasts")
  const { type, custom, hasEntrance, entrancePassword } = shippingMemo
  const customInputRef = useRef<HTMLInputElement>(null)
  const entranceInputRef = useRef<HTMLInputElement>(null)
  const selectTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!error) return
    const target =
      error === "enterCustomMemo"
        ? customInputRef.current
        : error === "enterEntrancePw"
          ? entranceInputRef.current
          : selectTriggerRef.current
    target?.focus()
  }, [error, errorAttempt])

  const focusCustomInput = useRef(false)

  const updateMemo = (updates: Partial<ShippingMemo>) => {
    onShippingMemoChange({ ...shippingMemo, ...updates })
  }

  const handleTypeChange = (value: string) => {
    focusCustomInput.current = value === "other"
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
          ref={selectTriggerRef}
          aria-invalid={error === "selectMemo"}
          className={cn(
            "h-auto w-full rounded border border-gray-300 bg-white px-3 py-2.5 text-[14px] text-gray-700 lg:rounded-[5px] lg:px-4 lg:py-3.5 lg:text-sm",
            !type && "text-gray-400",
            error === "selectMemo" && "border-red-500"
          )}
          aria-label={t("selectAria")}
        >
          <SelectValue placeholder={t("placeholder")} />
        </SelectTrigger>
        <SelectContent
          onCloseAutoFocus={(event) => {
            if (!focusCustomInput.current) return
            focusCustomInput.current = false
            event.preventDefault()
          }}
        >
          {SHIPPING_MEMO_OPTIONS.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="cursor-pointer py-2.5 text-[14px] lg:text-sm"
            >
              {t(`options.${option.labelKey}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error === "selectMemo" && <FieldError message={tError(error)} />}

      {/* 문 앞 선택 시: 공동현관 옵션 */}
      {type === "door" && (
        <EntranceSection
          hasEntrance={hasEntrance}
          entrancePassword={entrancePassword}
          inputRef={entranceInputRef}
          error={error === "enterEntrancePw" ? tError("enterEntrancePw") : null}
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
          inputRef={customInputRef}
          error={error === "enterCustomMemo" ? tError("enterCustomMemo") : null}
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
  inputRef,
  error,
}: {
  hasEntrance: boolean
  entrancePassword: string
  onHasEntranceChange: (checked: boolean) => void
  onPasswordChange: (value: string) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
  error?: string | null
}) {
  const t = useTranslations("checkout.shipping.memo.entrance")
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h4 className="mb-3 text-[14px] font-bold text-gray-900 lg:text-sm">
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
              className="cursor-pointer text-[14px] font-normal text-gray-700 lg:text-sm"
            >
              {t("hasEntrance")}
            </Label>
          </div>

          {hasEntrance && (
            <div className="ml-6 w-[calc(100%-24px)]">
              <Input
                id="entrance-password"
                ref={inputRef}
                type="text"
                value={entrancePassword}
                onChange={(e) => onPasswordChange(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                maxLength={20}
                aria-invalid={!!error}
                className={cn(
                  "bg-background h-auto w-full rounded border border-gray-300 px-3 py-2.5 text-[14px] placeholder:text-gray-400 focus:border-gray-400 focus:bg-white lg:rounded-[5px] lg:px-4 lg:py-3.5 lg:text-sm",
                  error && "border-red-500"
                )}
              />
              {error && <FieldError message={error} />}
            </div>
          )}
        </div>

        {/* 비밀번호 없음 옵션 */}
        <div className="flex items-center gap-2">
          <RadioGroupItem value="no" id="entrance-no" />
          <Label
            htmlFor="entrance-no"
            className="cursor-pointer text-[14px] font-normal text-gray-700 lg:text-sm"
          >
            {t("noEntrance")}
          </Label>
        </div>
      </RadioGroup>

      <p className="mt-3 text-[12px] leading-relaxed text-gray-500 lg:text-xs">
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
  inputRef,
  error,
}: {
  value: string
  onChange: (value: string) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
  error?: string | null
}) {
  const t = useTranslations("checkout.shipping.memo")
  return (
    <div>
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("customPlaceholder")}
          maxLength={50}
          autoFocus
          aria-invalid={!!error}
          className={cn(
            "h-auto w-full rounded border border-gray-300 px-3 py-2.5 pr-14 text-[14px] text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white lg:rounded-[5px] lg:px-4 lg:py-3.5 lg:text-sm",
            error && "border-red-500"
          )}
          aria-label={t("customAria")}
        />
        <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-gray-400 lg:text-xs">
          {value.length}/50
        </span>
      </div>
      {error && <FieldError message={error} />}
    </div>
  )
}

function FieldError({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-1.5 text-[13px] text-red-600">
      {message}
    </p>
  )
}
