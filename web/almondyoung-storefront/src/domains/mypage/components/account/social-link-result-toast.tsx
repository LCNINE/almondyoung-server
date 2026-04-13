"use client"

import { useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

const PROVIDER_LABEL: Record<string, string> = {
  kakao: "카카오",
  naver: "네이버",
}

export function SocialLinkResultToast() {
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

    const providerLabel = provider ? PROVIDER_LABEL[provider] || provider : ""

    if (linkResult === "success") {
      toast.success(`${providerLabel} 계정이 연동되었습니다.`)

      router.refresh()
    } else if (linkResult === "error") {
      const errorMessage = error
        ? decodeURIComponent(error)
        : "소셜 계정 연동 중 오류가 발생했습니다."
      toast.error(errorMessage)
    }

    const url = new URL(window.location.href)
    url.searchParams.delete("link_result")
    url.searchParams.delete("provider")
    url.searchParams.delete("error")
    router.replace(url.pathname + url.search, { scroll: false })
  }, [searchParams, router])

  return null
}
