"use client"

import { agreements } from "@lib/data/agreements"
import { SignupSchema } from "@components/auth/schemas/signup-schema"
import { UseFormReturn } from "react-hook-form"

export function useAgreements(form: UseFormReturn<SignupSchema>) {
  // 전체 동의 처리
  const handleAllAgreements = (checked: boolean) => {
    // 모든 약관 체크
    agreements.forEach((agreement) => {
      form.setValue(agreement.id as keyof SignupSchema, checked)
    })

    form.trigger()
  }

  // 개별 약관 동의 처리
  const handleAgreementChange = (agreementId: string, checked: boolean) => {
    form.setValue(agreementId as keyof SignupSchema, checked)

    form.trigger()
  }

  // 전체 동의
  const isAllAgreed = () => {
    return agreements.every((agreement) => {
      const isMainChecked = !!form.watch(agreement.id as keyof SignupSchema)

      return isMainChecked
    })
  }

  // 필수 약관 동의 체크
  const isRequiredAgreed = () => {
    return agreements.every((agreement) => {
      const isMainChecked =
        form.watch("isOver14") &&
        form.watch("termsOfService") &&
        form.watch("electronicTransaction") &&
        form.watch("privacyPolicy") &&
        form.watch("thirdPartySharing")

      return isMainChecked
    })
  }

  return {
    handleAllAgreements,
    handleAgreementChange,
    isAllAgreed,
    isRequiredAgreed,
  }
}
