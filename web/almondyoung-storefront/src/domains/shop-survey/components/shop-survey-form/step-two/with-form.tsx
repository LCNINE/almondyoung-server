"use client"

import { useFormContext } from "react-hook-form"
import { StepTwo } from "./index"
import { StepTwoValues } from "./types"

/**
 * StepTwo의 Form Context 통합 버전
 * react-hook-form의 Form Provider 내부에서 사용
 */
export function StepTwoForm() {
  const form = useFormContext<StepTwoValues>()

  // Form의 에러 메시지 추출
  const errors = {
    yearsOperating: form.formState.errors.yearsOperating?.message,
    shopType: form.formState.errors.shopType?.message,
    targetCustomers: form.formState.errors.targetCustomers?.message,
    openDays: form.formState.errors.openDays?.message,
  }

  return (
    <StepTwo
      values={{
        isOperating: form.watch("isOperating"),
        yearsOperating: form.watch("yearsOperating"),
        shopType: form.watch("shopType"),
        targetCustomers: form.watch("targetCustomers"),
        openDays: form.watch("openDays"),
      }}
      onChange={(field, value) => {
        form.setValue(field, value, {
          shouldValidate: true,
          shouldDirty: true,
        })
      }}
      errors={errors}
    />
  )
}
