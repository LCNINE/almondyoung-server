"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import Image from "next/image"
import { getBackendBaseUrl } from "@/lib/config/backend"

export function KakaoLoginBtn({ redirectTo }: { redirectTo: string }) {
  const handleKakaoLogin = () => {
    const baseUrl = getBackendBaseUrl("users")

    if (!baseUrl) {
      console.error("User service base URL is not configured")
      return
    }

    window.location.href = `${baseUrl}/auth/kakao/signin`
  }

  return (
    <CustomButton
      type="button"
      variant="ghost"
      fullWidth
      size="lg"
      onClick={handleKakaoLogin}
      className="relative w-full overflow-hidden"
    >
      <Image
        src="/images/kakao_login-large.png"
        alt="카카오 로그인"
        fill
        className="object-cover"
        priority
      />
    </CustomButton>
  )
}
