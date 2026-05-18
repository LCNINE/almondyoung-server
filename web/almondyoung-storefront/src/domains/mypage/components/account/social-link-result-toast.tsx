"use client"

import { useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

type ProviderKey = "providerKakao" | "providerNaver"
const PROVIDER_KEY: Record<string, ProviderKey> = {
  kakao: "providerKakao",
  naver: "providerNaver",
}

export function SocialLinkResultToast() {
  const t = useTranslations("mypage.socialLink")
  const searchParams = useSearchParams()
  const router = useRouter()
  const hasShownToast = useRef(false)

  useEffect(() => {
    if (hasShownToast.current) return

    const linkResult = searchParams.get("link_result")
    const provider = searchParams.get("provider")
    const error = searchParams.get("error")

    if (!linkResult) return

    hasShownToast.current = true

    const providerLabel = provider
      ? (PROVIDER_KEY[provider] ? t(PROVIDER_KEY[provider]) : provider)
      : ""

    const handleResult = async () => {
      if (linkResult === "success") {
        toast.success(t("linkSuccess", { provider: providerLabel }))
        router.refresh()
      } else if (linkResult === "error") {
        const errorMessage = error
          ? decodeURIComponent(error)
          : t("socialLinkError")
        toast.error(errorMessage)
      }

      const url = new URL(window.location.href)
      url.searchParams.delete("link_result")
      url.searchParams.delete("provider")
      url.searchParams.delete("error")
      router.replace(url.pathname + url.search, { scroll: false })
    }

    handleResult()
  }, [searchParams, router, t])

  return null
}
