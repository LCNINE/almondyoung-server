"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import Image from "next/image"

export function KakaoLoginBtn({ redirectTo }: { redirectTo: string }) {
  const handleKakaoLogin = () => {
    const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL

    window.location.href = `${baseUrl}/users/auth/kakao/signin`
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
