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
  const router = useRouter()
  const pathname = usePathname()
  const hasTriedRef = useRef(false)

  useEffect(() => {
    // 중복 실행 방지
    if (hasTriedRef.current) return
    hasTriedRef.current = true

    const tokenRefresh = async () => {
      if (error.digest === "Unauthorized" || error.message === "Unauthorized") {
        const isMainPage = /^\/[a-z]{2}\/?$/.test(pathname)

        try {
          const response = await fetch("/api/auth/restore-token", {
            method: "POST",
            credentials: "include",
          })

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
            router.refresh()
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
            router.refresh()
            return
          }

          // 다른 페이지는 로그인 페이지로 리다이렉트
          const currentUrl = encodeURIComponent(pathname)
          router.push(`/kr/login?redirect_to=${currentUrl}`)
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

  if (error.digest === "Unauthorized" || error.message === "Unauthorized") {
    return <div className="flex min-h-screen items-center justify-center"></div>
  } else {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="flex w-full max-w-md flex-col items-center rounded-lg bg-white py-10 shadow-md">
          <svg
            className="mb-6 h-16 w-16 text-red-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="2"
              fill="#f8717130"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M15 9l-6 6m0-6l6 6"
            />
          </svg>
          <h1 className="mb-2 text-2xl font-semibold text-red-600">
            문제가 발생했어요
          </h1>
          <p className="mb-6 text-center text-gray-700">
            죄송합니다. 예기치 않은 오류가 발생했습니다.
            <br />
            잠시 후 다시 시도해주시거나, 지속적으로 문제가 발생한다면
            <br />
            고객센터로 문의해주세요.
          </p>
          <button
            onClick={() => (window.location.href = "/")}
            className="rounded bg-red-500 px-6 py-2 text-white transition hover:bg-red-600"
          >
            홈으로 이동
          </button>
        </div>
      </div>
    )
  }
}
