"use client"

import { Spinner } from "@components/common/spinner"
import { clientApi } from "@lib/client-api"
import { useRouter } from "next/navigation"
import { startTransition, useEffect } from "react"

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function Error({ error, reset }: ErrorProps) {
  const router = useRouter()

  useEffect(() => {
    const tokenRefresh = async () => {
      // 401 에러가 아니면 무시
      if (error.digest !== "UNAUTHORIZED") {
        return
      }

      try {
        // 리프레시 토큰으로 accessToken 재발급요청
        const data: { accessToken: string } = await clientApi(
          "/auth/restore-token",
          {
            method: "POST",
            body: JSON.stringify({}),
          }
        )
        if (data.accessToken) {
          // 재발급 성공 시 재요청
          startTransition(() => {
            router.refresh()
            reset()
          })
        } else {
          //   재발급 실패 시 로그인 페이지로 이동
          router.push("/auth/login")
        }
      } catch (err) {
        console.error("Token refresh failed:", err)

        router.push("/auth/login")
      }
    }

    tokenRefresh()
  }, [error, reset, router])

  return (
    <div className="flex min-h-[calc(100vh-100px)] items-center justify-center">
      <Spinner size="lg" color="gray" />
    </div>
  )
}
