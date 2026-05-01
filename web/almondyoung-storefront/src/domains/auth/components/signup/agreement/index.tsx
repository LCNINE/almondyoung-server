"use client"

import { agreements } from "@lib/data/agreements"
import { useAgreements } from "domains/auth/hooks"
import { SignupSchema } from "domains/auth/schemas/signup-schema"
import { UseFormReturn } from "react-hook-form"
import { AgreementItem } from "./agreement-item"
import { AllAgreementsCheckbox } from "./all-agreements-checkbox"

interface AgreementsSectionProps {
  form: UseFormReturn<SignupSchema>
}

export function AgreementsSection({ form }: AgreementsSectionProps) {
  const {
    handleAllAgreements,
    handleAgreementChange,
    isAllAgreed,
    isRequiredAgreed,
  } = useAgreements(form)

  return (
    <div>
      {/* 전체 동의 체크박스 */}
      <AllAgreementsCheckbox
        checked={isAllAgreed()}
        onChange={handleAllAgreements}
      />

      {/* 개별 약관 목록 */}
      <div className="border-border-muted mt-4 flex flex-col gap-1 border-[0.5px] px-2.5 py-2.5 md:mt-5 md:px-3.5 md:py-3">
        {agreements.map((agreement) => (
          <AgreementItem
            key={agreement.id}
            id={agreement.id}
            name={agreement.name}
            content={agreement.content}
            checked={!!form.watch(agreement.id as keyof SignupSchema)}
            onChange={(checked) => handleAgreementChange(agreement.id, checked)}
          />
        ))}
      </div>

      {!isRequiredAgreed() && (
        <p className="mt-2 text-xs text-red-500">필수 약관에 동의 해주세요</p>
      )}
    </div>
  )
}
