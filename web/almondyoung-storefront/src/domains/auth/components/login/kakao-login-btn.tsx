"use client"

import { CustomButton } from "@components/common/custom-buttons"
import { USER_API_CONFIG } from "@lib/api/users/config"
import Image from "next/image"

export function KakaoLoginBtn() {
  const handleKakaoLogin = () => {
    const baseUrl = USER_API_CONFIG.BASE_URL

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
