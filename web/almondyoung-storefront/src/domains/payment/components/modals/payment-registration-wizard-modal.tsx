"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@components/common/ui/dialog"

import type { UserVerificationStatusDto } from "@lib/types/dto/users"
import type { BusinessInfo, UserDetail } from "@lib/types/ui/user"
import { useEffect, useState } from "react"
import BirthdateStep from "../registration-steps/birthdate-step"
import BusinessStep from "../registration-steps/business-step"
import PaymentAccountStep from "../registration-steps/payment-account-step"
import { PhoneStep } from "../registration-steps/phone-step"
import { StepIndicator } from "../registration-steps/step-Indicator"
import type { BnplProfileDto } from "@lib/types/dto/wallet"

type Step = "birthDate" | "phone" | "business" | "paymentAccount"

// 결제 수단 등록 모달 컴포넌트
export default function PaymentRegistrationWizardModal({
  open,
  onOpenChange,
  user,
  verificationStatus,
  businessInfo,
  bnplProfiles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: UserDetail
  verificationStatus: UserVerificationStatusDto
  businessInfo: BusinessInfo | null
  bnplProfiles: BnplProfileDto[]
}) {
  const [currentStep, setCurrentStep] = useState<Step>("birthDate")

  useEffect(() => {
    if (!verificationStatus) return

    const { birthDate, phone, business } = verificationStatus

    // 완료된 스텝은 건너뛰고, pending/rejected면 해당 스텝에서 멈춤
    if (birthDate !== "verified") {
      setCurrentStep("birthDate")
    } else if (phone !== "verified") {
      setCurrentStep("phone")
    } else if (business.status !== "verified") {
      setCurrentStep("business")
    } else {
      setCurrentStep("paymentAccount")
    }
  }, [verificationStatus])

  const steps = [
    { id: "phone", label: "본인인증", status: verificationStatus?.phone },
    {
      id: "business",
      label: "사업자 확인",
      status: verificationStatus?.business,
    },
    {
      id: "paymentAccount",
      label: "계좌등록 및 동의",
      status: "verified",
    },
  ] as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle
            className={`${currentStep === "paymentAccount" && "text-center"} `}
          >
            {currentStep === "paymentAccount"
              ? "결제수단 관리"
              : steps.find((step) => step.id === currentStep)?.label}
          </DialogTitle>
        </DialogHeader>

        <StepIndicator steps={steps} currentStep={currentStep} />

        {currentStep === "birthDate" && (
          <BirthdateStep
            status={verificationStatus?.birthDate}
            onComplete={() => setCurrentStep("phone")}
          />
        )}

        {currentStep === "phone" && (
          <PhoneStep
            status={verificationStatus?.phone}
            onComplete={() => setCurrentStep("business")}
            user={user}
          />
        )}

        {currentStep === "business" && (
          <BusinessStep
            status={verificationStatus?.business.status}
            rejectionReason={verificationStatus?.business.rejectionReason}
            onComplete={() => setCurrentStep("paymentAccount")}
            businessInfo={businessInfo}
          />
        )}

        {currentStep === "paymentAccount" && (
          <PaymentAccountStep
            onComplete={() => onOpenChange(false)}
            user={user}
            bnplProfiles={bnplProfiles}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
