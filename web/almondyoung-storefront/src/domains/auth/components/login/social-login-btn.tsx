"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import Image from "next/image"

interface SocialLoginBtnProps {
  label: "kakao" | "naver"
  handleLogin: () => void
  src: string
}

export function SocialLoginBtn({
  label,
  handleLogin,
  src,
}: SocialLoginBtnProps) {
  return (
    <CustomButton
      type="button"
      variant="ghost"
      fullWidth
      size="lg"
      onClick={handleLogin}
      className="relative w-full cursor-pointer overflow-hidden transition-opacity duration-200 hover:opacity-90"
    >
      <Image
        src={src}
        alt={label}
        fill
        className="object-cover"
        priority
        sizes="(max-width: 1024px) 55vw, 50vw"
      />
    </CustomButton>
  )
}
