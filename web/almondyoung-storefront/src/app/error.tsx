"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef } from "react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  console.error("error::::::::", error)
  const router = useRouter()
  const pathname = usePathname()
  const hasTriedRef = useRef(false)

  useEffect(() => {
    // 중복 실행 방지
    if (hasTriedRef.current) return
    hasTriedRef.current = true

    const tokenRefresh = async () => {
      if (
        error.digest === "TOKEN_EXPIRED" ||
        error.message === "TOKEN_EXPIRED"
      ) {
        const isMainPage = /^\/[a-z]{2}\/?$/.test(pathname)

        try {
          const response = await fetch(
            `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/restore-token`,
            {
              method: "POST",
              credentials: "include",
            }
          )

          if (response.ok) {
            // 토큰 복구 성공하면 새로고침
            console.log("토큰 복구 성공")
            await new Promise((resolve) => setTimeout(resolve, 100))
            window.location.reload()
            return
          }

          // 토큰 복구 실패
          const data = await response.json().catch(() => ({}))

          if (isMainPage && data.isMainPage) {
            // 메인페이지에서 리프레시 토큰도 만료되면 로그아웃 처리만하고 새로고침
            await new Promise((resolve) => setTimeout(resolve, 100))
            window.location.reload()
            return
          }

          // 다른 페이지는 로그인 페이지로 리다이렉트
          const currentUrl = encodeURIComponent(pathname)
          window.location.href = `/kr/login?redirect_to=${currentUrl}`
        } catch (error) {
          console.error("토큰 복구 중 에러:", error)

          if (isMainPage) {
            // 메인페이지에서 에러 발생 시 로그아웃 처리만하고 새로고침
            await new Promise((resolve) => setTimeout(resolve, 100))
            window.location.reload()
            return
          }

          // 다른 페이지는 로그인 페이지로 리다이렉트
          const currentUrl = encodeURIComponent(pathname)
          window.location.href = `/kr/login?redirect_to=${currentUrl}`
        }
      }
    }

    tokenRefresh()
  }, [error, reset, router, pathname])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mb-4">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-gray-300 border-r-transparent"></div>
        </div>
        <p className="font-medium text-gray-700">
          인증 상태를 복구 중입니다...
        </p>
        <p className="mt-2 text-sm text-gray-500">잠시만 기다려주세요</p>
      </div>
    </div>
  )
}
