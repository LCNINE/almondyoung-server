"use client"

import ErrorPageContent from "@/components/error-page"
import {
  extractCountryCodeFromPath,
  normalizeRedirectPath,
  toLocalizedPath,
} from "@/lib/utils/locale-path"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef } from "react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const hasTriedRef = useRef(false)

  useEffect(() => {
    // 중복 실행 방지
    if (hasTriedRef.current) return
    hasTriedRef.current = true

    const tokenRefresh = async () => {
      console.log("error,stack === ")
      console.log("error:", error.stack)
      console.log("error,stack end ====")
      if (error.digest === "UNAUTHORIZED" || error.message === "UNAUTHORIZED") {
        const isMainPage = /^\/[a-z]{2}\/?$/.test(pathname)
        const countryCode = extractCountryCodeFromPath(pathname, "kr")
        const loginPath = toLocalizedPath(countryCode, "/login")
        const redirectPath = encodeURIComponent(normalizeRedirectPath(pathname))

        try {
          const response = await fetch("/api/auth/restore-token", {
            method: "POST",
            credentials: "include",
          })

          if (response.ok) {
            // 토큰 복구 성공하면 새로고침
            await new Promise((resolve) => setTimeout(resolve, 100))
            window.location.reload()

            return
          }

          // 토큰 복구 실패
          const data = await response.json().catch(() => ({}))

          if (isMainPage && data.isMainPage) {
            // 메인페이지에서 리프레시 토큰도 만료되면 로그아웃 처리만하고 새로고침
            await new Promise((resolve) => setTimeout(resolve, 100))
            router.refresh()
            return
          }

          // 다른 페이지는 로그인 페이지로 리다이렉트
          window.location.href = `${loginPath}?redirect_to=${redirectPath}`
        } catch (error) {
          console.error("토큰 복구 중 에러:", error)

          if (isMainPage) {
            // 메인페이지에서 에러 발생 시 로그아웃 처리만하고 새로고침
            await new Promise((resolve) => setTimeout(resolve, 100))
            router.refresh()
            return
          }

          // 다른 페이지는 로그인 페이지로 리다이렉트
          router.push(`${loginPath}?redirect_to=${redirectPath}`)
        }
      } else {
        // TOKEN_EXPIRED가 아닌 다른 에러인 경우
        console.error("Unexpected error in Error boundary:", {
          message: error.message,
          digest: error.digest,
          name: error.name,
        })
      }
    }

    tokenRefresh()
  }, [error, reset, router, pathname])

  // 401/UNAUTHORIZED 에러는 토큰 복구 처리 중이므로 빈 화면 표시
  if (error.digest === "UNAUTHORIZED" || error.message === "UNAUTHORIZED") {
    return <div className="flex min-h-screen items-center justify-center"></div>
  }

  // 일반 에러
  return (
    <ErrorPageContent
      onRetry={() => window.location.reload()}
      onGoHome={() => (window.location.href = "/")}
    />
  )
}
