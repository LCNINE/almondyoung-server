"use client"

import { UserVerificationStatusDto } from "@lib/types/dto/users"
import { BnplProfileDto } from "@lib/types/dto/wallet"
import { BusinessInfo, UserDetail } from "@lib/types/ui/user"
import BnplVerificationWizard from "domains/payment/components/bnpl-verification-wizard/bnpl-verification-wizard"
import { useBnplModalStore } from "domains/payment/components/store/bnpl-modal-store"
import { useEffect } from "react"

interface VerificationModalBtnProps {
  currentUser: UserDetail
  verificationStatus: UserVerificationStatusDto
  businessInfo: BusinessInfo | null
  bnplProfiles: BnplProfileDto[]
}

export default function VerificationModal({
  currentUser,
  verificationStatus,
  businessInfo,
  bnplProfiles,
}: VerificationModalBtnProps) {
  const { isOpen, openModal } = useBnplModalStore()

  useEffect(() => {
    if (!isOpen) {
      openModal()
    }
  }, [])

  return (
    <div className="min-h-screen">
      <BnplVerificationWizard
        user={currentUser}
        verificationStatus={verificationStatus}
        businessInfo={businessInfo}
        bnplProfiles={bnplProfiles ?? []}
      />
    </div>
  )
}
