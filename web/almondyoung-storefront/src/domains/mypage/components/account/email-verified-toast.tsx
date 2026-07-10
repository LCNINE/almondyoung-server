"use client"

import { useTranslations } from "next-intl"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef } from "react"
import { toast } from "sonner"

/** 인증 메일 링크 → /callback/signup → ?emailVerified=true 로 돌아왔을 때 토스트 */
export function EmailVerifiedToast() {
  const t = useTranslations("mypage.account.accountInfo")
  const searchParams = useSearchParams()
  const router = useRouter()
  const hasShownToast = useRef(false)

  useEffect(() => {
    if (hasShownToast.current) return
    if (searchParams.get("emailVerified") !== "true") return
    hasShownToast.current = true

    toast.success(t("verifiedToast"))

    const url = new URL(window.location.href)
    url.searchParams.delete("emailVerified")
    router.replace(url.pathname + url.search, { scroll: false })
  }, [searchParams, router, t])

  return null
}
