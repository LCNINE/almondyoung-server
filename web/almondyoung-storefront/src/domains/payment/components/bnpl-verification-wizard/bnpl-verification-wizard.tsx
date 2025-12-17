"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@components/common/ui/dialog"
import type { UserVerificationStatusDto } from "@lib/types/dto/users"
import type { BnplProfileDto } from "@lib/types/dto/wallet"
import type { BusinessInfo, UserDetail } from "@lib/types/ui/user"
import { useEffect, useState } from "react"
import { StepIndicator } from "../step-Indicator"
import { useBnplModalStore } from "../store/bnpl-modal-store"
import { PhoneVerificationStep } from "./step1"
import BusinessVerificationStep from "./step2"
import BankAccountStep from "./step3"

type Step = "phone" | "business" | "bankAccount"

// 나중결제 등록전 인증 모달 컴포넌트
export default function BnplVerificationWizard({
  user,
  verificationStatus,
  businessInfo,
  bnplProfiles,
}: {
  user: UserDetail
  verificationStatus: UserVerificationStatusDto
  businessInfo: BusinessInfo | null
  bnplProfiles: BnplProfileDto[]
}) {
  const { isOpen, openModal, closeModal, toggleModal } = useBnplModalStore()

  const [currentStep, setCurrentStep] = useState<Step>("phone")

  useEffect(() => {
    if (!verificationStatus) return

    const { phone, business } = verificationStatus

    // 완료된 스텝은 건너뛰고, pending/rejected면 해당 스텝에서 멈춤
    if (phone !== "verified") {
      setCurrentStep("phone")
    } else if (business.status !== "verified") {
      setCurrentStep("business")
    } else {
      setCurrentStep("bankAccount")
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
    <Dialog open={isOpen} onOpenChange={toggleModal}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle
            className={`${currentStep === "bankAccount" && "text-center"} `}
          >
            {currentStep === "bankAccount"
              ? "결제수단 관리"
              : steps.find((step) => step.id === currentStep)?.label}
          </DialogTitle>
        </DialogHeader>

        <StepIndicator steps={steps} currentStep={currentStep} />

        {currentStep === "phone" && (
          <PhoneVerificationStep
            status={verificationStatus?.phone}
            onComplete={() => setCurrentStep("business")}
            user={user}
          />
        )}

        {currentStep === "business" && (
          <BusinessVerificationStep
            status={verificationStatus?.business.status}
            rejectionReason={verificationStatus?.business.rejectionReason}
            onComplete={() => setCurrentStep("bankAccount")}
            businessInfo={businessInfo}
          />
        )}

        {currentStep === "bankAccount" && (
          <BankAccountStep
            onComplete={() => closeModal()}
            user={user}
            bnplProfiles={bnplProfiles}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
