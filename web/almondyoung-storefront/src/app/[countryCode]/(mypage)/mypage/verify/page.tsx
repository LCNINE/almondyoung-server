"use client"
import { ArrowLeft } from "lucide-react"
import React from "react"
import { PhoneVerifyDrawer } from "domains/verify/phone/phone-verify-drawer"
import { BusinessVerifyDrawer } from "domains/verify/business/business-verify-drawer"

export default function VerificationPage() {
  const [phoneDrawerOpen, setPhoneDrawerOpen] = React.useState(false)
  const [businessDrawerOpen, setBusinessDrawerOpen] = React.useState(false)

  const handleStartVerification = () => {
    setPhoneDrawerOpen(true)
  }

  const handlePhoneComplete = () => {
    // Step 1 완료 -> Step 2로 이동
    setPhoneDrawerOpen(false)
    setBusinessDrawerOpen(true)
  }

  const handleBusinessBack = () => {
    // Step 2에서 뒤로가기 -> Step 1로 복귀
    setBusinessDrawerOpen(false)
    setPhoneDrawerOpen(true)
  }

  const handleBusinessComplete = () => {
    // Step 2 완료 -> 모든 drawer 닫기
    setBusinessDrawerOpen(false)
    alert("인증이 완료되었습니다!")
    // 필요시 페이지 이동 등 추가 로직
  }

  return (
    <div className="flex min-h-screen flex-col bg-white font-['Pretendard']">
      {/* Header */}
      <header className="flex w-full items-center gap-2 border-b border-[#d9d9d9] bg-white px-[15px] py-3">
        <button aria-label="뒤로 가기" className="p-1">
          <ArrowLeft className="h-5 w-5 text-black" />
        </button>
        <h1 className="flex-1 text-center text-base font-bold text-black">
          나중결제 등록
        </h1>
        <div className="w-5" />
      </header>

      {/* Main Content */}
      <main className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <h2 className="text-2xl font-bold text-black">
            나중결제를 위한
            <br />
            본인 인증을 시작해주세요
          </h2>
          <p className="text-sm text-gray-600">
            휴대폰 인증과 사업자 정보 확인이 필요합니다
          </p>
          <button
            onClick={handleStartVerification}
            className="w-full rounded-[5px] bg-[#f29219] px-4 py-3 text-white"
          >
            인증 시작하기
          </button>
        </div>
      </main>

      {/* Step 1: 휴대폰 인증 */}
      <PhoneVerifyDrawer
        open={phoneDrawerOpen}
        onOpenChange={setPhoneDrawerOpen}
        onComplete={handlePhoneComplete}
      />

      {/* Step 2: 사업자 확인 */}
      <BusinessVerifyDrawer
        open={businessDrawerOpen}
        onOpenChange={setBusinessDrawerOpen}
        onBack={handleBusinessBack}
        onComplete={handleBusinessComplete}
      />
    </div>
  )
}
