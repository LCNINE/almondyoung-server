"use client"

import { USER_SERVICE_BASE_URL } from "@lib/api/api.config"
import { signout } from "@lib/data/customer"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef } from "react"

const MAX_ATTEMPTS = 2

export default function AuthRestore({
  hasRefreshToken,
}: {
  hasRefreshToken: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const attemptsRef = useRef(0)
  const hasRunRef = useRef(false)

  useEffect(() => {
    if (hasRunRef.current || !hasRefreshToken) return

    hasRunRef.current = true

    const restoreToken = async () => {
      // 최대 시도 횟수 초과 확인
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        console.log("토큰 복구 실패: 최대 시도 횟수 초과")
        handleAuthFail()
        return
      }

      try {
        console.log(`토큰 복구 시도 ${attemptsRef.current + 1}/${MAX_ATTEMPTS}`)

        const res = await fetch(`${USER_SERVICE_BASE_URL}/auth/restore-token`, {
          method: "POST",
          signal: AbortSignal.timeout(3000),
          credentials: "include",
        })

        if (res.ok) {
          window.location.reload()
        } else {
          throw new Error(`HTTP ${res.status}`)
        }
      } catch (error) {
        attemptsRef.current++

        // 재시도
        if (attemptsRef.current < MAX_ATTEMPTS) {
          setTimeout(restoreToken, 1000)
        } else {
          handleAuthFail()
        }
      }
    }

    restoreToken()
  }, [pathname, router])

  const handleAuthFail = async () => {
    // 메인 페이지인지 확인 (경로: /kr, /us 등)
    const isMainPage = /^\/[a-z]{2}$/i.test(pathname)

    if (isMainPage && hasRefreshToken) {
      // 메인 페이지: 로그아웃만 처리 (쿠키 삭제 후 새로고침)
      console.log("메인 페이지에서 토큰 복구 실패 - 로그아웃 처리")

      await signout()

      window.location.reload()
      return
    }

    // 다른 페이지: 로그인 페이지로 리다이렉트
    router.replace(`/login?redirect_to=${encodeURIComponent(pathname)}`)
  }

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
