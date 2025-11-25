"use client"

import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
import { useState, useEffect } from "react"
import { Check, Phone, User } from "lucide-react"
import { PhoneVerifyDrawer } from "domains/verify/phone/phone-verify-drawer"
import { BusinessVerifyDrawer } from "domains/verify/business/business-verify-drawer"

export default function IdentityVerifyPage() {
  const [isVerified, setIsVerified] = useState(false)
  const [phoneDrawerOpen, setPhoneDrawerOpen] = useState(false)
  const [businessDrawerOpen, setBusinessDrawerOpen] = useState(false)
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [businessVerified, setBusinessVerified] = useState(false)

  // TODO: 실제 인증 상태를 API에서 가져오기
  useEffect(() => {
    // 임시로 로컬 스토리지에서 확인
    const phoneStatus = localStorage.getItem("phone_verified") === "true"
    const businessStatus = localStorage.getItem("business_verified") === "true"
    setPhoneVerified(phoneStatus)
    setBusinessVerified(businessStatus)
    setIsVerified(phoneStatus && businessStatus)
  }, [])

  const handleStartVerification = () => {
    setPhoneDrawerOpen(true)
  }

  const handlePhoneComplete = () => {
    setPhoneDrawerOpen(false)
    setPhoneVerified(true)
    localStorage.setItem("phone_verified", "true")
    setBusinessDrawerOpen(true)
  }

  const handleBusinessBack = () => {
    setBusinessDrawerOpen(false)
    setPhoneDrawerOpen(true)
  }

  const handleBusinessComplete = () => {
    setBusinessDrawerOpen(false)
    setBusinessVerified(true)
    localStorage.setItem("business_verified", "true")
    setIsVerified(true)
  }

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "본인인증",
      }}
    >
      <MypageLayout>
        <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
          {!isVerified ? (
            // 본인인증이 안되었을 때
            <div className="flex flex-col items-center justify-center px-6 py-12">
              <div className="w-full max-w-md space-y-6 text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
                  <User className="h-10 w-10 text-gray-400" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-black">
                    본인 인증이 필요합니다
                  </h2>
                  <p className="text-sm text-gray-600">
                    안전한 서비스 이용을 위해
                    <br />
                    본인 인증을 진행해주세요
                  </p>
                </div>

                {/* 인증 상태 표시 */}
                <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full ${
                          phoneVerified ? "bg-amber-500" : "bg-gray-200"
                        }`}
                      >
                        {phoneVerified ? (
                          <Check className="h-5 w-5 text-white" />
                        ) : (
                          <Phone className="h-5 w-5 text-gray-500" />
                        )}
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-medium text-black">
                          휴대폰 인증
                        </p>
                        <p className="text-xs text-gray-500">
                          {phoneVerified ? "인증 완료" : "인증 필요"}
                        </p>
                      </div>
                    </div>
                    {phoneVerified && (
                      <Check className="h-5 w-5 text-amber-500" />
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full ${
                          businessVerified ? "bg-amber-500" : "bg-gray-200"
                        }`}
                      >
                        {businessVerified ? (
                          <Check className="h-5 w-5 text-white" />
                        ) : (
                          <User className="h-5 w-5 text-gray-500" />
                        )}
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-medium text-black">
                          사업자 확인
                        </p>
                        <p className="text-xs text-gray-500">
                          {businessVerified ? "확인 완료" : "확인 필요"}
                        </p>
                      </div>
                    </div>
                    {businessVerified && (
                      <Check className="h-5 w-5 text-amber-500" />
                    )}
                  </div>
                </div>

                <button
                  onClick={handleStartVerification}
                  className="w-full rounded-[5px] bg-amber-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-600"
                >
                  {phoneVerified ? "사업자 확인하기" : "본인 인증 시작하기"}
                </button>
              </div>
            </div>
          ) : (
            // 본인인증이 완료되었을 때
            <div className="flex flex-col items-center justify-center px-6 py-12">
              <div className="w-full max-w-md space-y-6 text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
                  <Check className="h-10 w-10 text-amber-500" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-black">
                    본인 인증이 완료되었습니다
                  </h2>
                  <p className="text-sm text-gray-600">
                    안전하게 인증이 완료되었습니다
                  </p>
                </div>

                {/* 인증 완료 정보 */}
                <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500">
                        <Check className="h-5 w-5 text-white" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-medium text-black">
                          휴대폰 인증
                        </p>
                        <p className="text-xs text-gray-500">인증 완료</p>
                      </div>
                    </div>
                    <Check className="h-5 w-5 text-amber-500" />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500">
                        <Check className="h-5 w-5 text-white" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-medium text-black">
                          사업자 확인
                        </p>
                        <p className="text-xs text-gray-500">확인 완료</p>
                      </div>
                    </div>
                    <Check className="h-5 w-5 text-amber-500" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 인증 Drawer들 */}
          <PhoneVerifyDrawer
            open={phoneDrawerOpen}
            onOpenChange={setPhoneDrawerOpen}
            onComplete={handlePhoneComplete}
          />
          <BusinessVerifyDrawer
            open={businessDrawerOpen}
            onOpenChange={setBusinessDrawerOpen}
            onBack={handleBusinessBack}
            onComplete={handleBusinessComplete}
          />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
