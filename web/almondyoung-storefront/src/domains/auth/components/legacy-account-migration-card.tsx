"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import { useParams, useSearchParams } from "next/navigation"

const CAFE24_MIGRATOR_BASE = "https://almondyoung.com/migrator/confirm.html"

interface LegacyAccountMigrationCardProps {
  variant?: "signup" | "login"
}

export function LegacyAccountMigrationCard({
  variant = "login",
}: LegacyAccountMigrationCardProps) {
  const { countryCode } = useParams() as { countryCode: string }
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect_to") || "/"

  const handleContinueWithCafe24 = () => {
    if (typeof window === "undefined") return

    const confirmUrl =
      `${window.location.origin}/${countryCode}/signup/cafe24/confirm` +
      `?redirect_to=${encodeURIComponent(redirectTo)}`

    window.location.href = `${CAFE24_MIGRATOR_BASE}?redirect_to=${encodeURIComponent(confirmUrl)}`
  }

  const buttonText =
    variant === "signup"
      ? "기존 아몬드영 계정으로 계속하기"
      : "기존 아몬드영 계정으로 가입하기"

  const description =
    variant === "signup"
      ? "정보를 불러와 빠르게 가입하고 휴대폰 인증을 건너뛸 수 있습니다."
      : "기존 계정 정보로 빠르게 가입하고 바로 이용하세요."

  return (
    <div className="rounded-lg border border-zinc-200 p-4">
      <p className="text-sm font-semibold text-zinc-800">
        기존 아몬드영 계정이 있으신가요?
      </p>
      <p className="mt-1 text-xs text-zinc-500">{description}</p>
      <CustomButton
        type="button"
        variant="outline"
        color="secondary"
        className="mt-3 w-full cursor-pointer"
        onClick={handleContinueWithCafe24}
      >
        {buttonText}
      </CustomButton>
    </div>
  )
}
