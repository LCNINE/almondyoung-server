"use client"

import { PageTitle } from "@components/common/page-title"
import { BusinessInfo, UserVerificationStatusDto } from "@lib/types/dto/users"
import type { UserDetail } from "@lib/types/ui/user"
import { useState } from "react"
import PaymentRegistrationModal from "./components/modals/payment-registration-wizard-modal"
import AccountSection from "./components/sections/account-section"
import DeferredPaymentSection from "./components/sections/deferred-payment-section"
import PaymentMenuList from "./components/sections/payment-menu-list"
import PendingPointsSection from "./components/sections/pending-points-section"
import PointSection from "./components/sections/point-section"

export function PaymentManagement({
  currentUser,
  verificationStatus,
  businessInfo,
}: {
  currentUser: UserDetail
  verificationStatus: UserVerificationStatusDto
  businessInfo: BusinessInfo | null
}) {
  const [isPaymentRegisterModalOpen, setIsPaymentRegisterModalOpen] =
    useState(false)

  return (
    <div className="p x-3 rounded-xl bg-white pt-4 pb-9 md:px-6">
      <PageTitle>결제수단 관리</PageTitle>

      <div className="bg-gray-10 mt-5 mb-4 p-4">
        {/* 나중결제 내역 */}
        <DeferredPaymentSection
          onPaymentRegisterClick={() => setIsPaymentRegisterModalOpen(true)}
        />

        {/* 적립금 섹션 */}
        <PointSection />

        {/* 계좌 섹션 */}
        <AccountSection />

        {/* 적립 예정인 적립금 섹션 */}
        <PendingPointsSection />
      </div>

      {/* 하단 메뉴 리스트 */}
      <PaymentMenuList />

      {/* 등록 모달 */}
      <PaymentRegistrationModal
        open={isPaymentRegisterModalOpen}
        onOpenChange={setIsPaymentRegisterModalOpen}
        user={currentUser}
        verificationStatus={verificationStatus}
        businessInfo={businessInfo}
      />
    </div>
  )
}
