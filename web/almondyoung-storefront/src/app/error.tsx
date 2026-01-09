"use client"

import { Button } from "@/components/ui/button"
import { Home, RefreshCw } from "lucide-react"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef } from "react"
import LostAlmondImage from "../assets/images/404-notfound.png"

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
      console.log("error:", error.stack)
      if (error.digest === "UNAUTHORIZED" || error.message === "UNAUTHORIZED") {
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

  if (error.digest === "UNAUTHORIZED" || error.message === "UNAUTHORIZED") {
    return <div className="flex min-h-screen items-center justify-center"></div>
  } else {
    return (
      <div className="bg-background flex min-h-screen flex-col">
        {/* Header */}
        <header className="border-border bg-foreground border-b">
          <div className="container mx-auto flex h-14 items-center px-4">
            <span className="text-background text-lg font-bold tracking-tight">
              ALMOND YOUNG
            </span>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex flex-1 items-center justify-center px-4 py-12">
          <div className="w-full max-w-lg text-center">
            {/* Illustration */}
            <div className="mb-6">
              <Image
                src={LostAlmondImage}
                alt="에러가 발생한 아몬드 캐릭터"
                className="mx-auto h-48 w-48 object-contain"
                width={192}
                height={192}
              />
            </div>

            {/* Error Title */}
            <div className="mb-4" style={{ animationDelay: "0.1s" }}>
              <span className="text-gold text-5xl font-bold">앗!</span>
            </div>

            {/* Message */}
            <h1
              className="text-foreground mb-3 text-xl font-semibold"
              style={{ animationDelay: "0.2s" }}
            >
              뭔가 잘못됐어요!
            </h1>

            <p
              className="text-muted-foreground mb-2 text-sm leading-relaxed"
              style={{ animationDelay: "0.3s" }}
            >
              예상치 못한 오류가 발생했어요. 걱정 마세요!
            </p>
            <p
              className="text-muted-foreground mb-8 text-sm"
              style={{ animationDelay: "0.4s" }}
            >
              새로고침하거나 홈으로 돌아가 보세요!
            </p>

            {/* Action Buttons */}
            <div
              className="mx-auto mt-8 grid max-w-[320px] grid-cols-2 gap-3"
              style={{ animationDelay: "0.5s" }}
            >
              {/* 홈으로 돌아가기: 시안의 메인 다크 브라운 배경색 적용 */}
              <Button
                variant="default"
                size="lg"
                className="flex h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-none bg-[#4A4744] text-white transition-all hover:bg-[#3d3a37] active:scale-95"
                onClick={() => (window.location.href = "/")}
              >
                <Home className="h-5 w-5 text-white" />
                <span className="text-xs font-bold">홈으로</span>
              </Button>

              {/* 새로고침: 시안의 포인트 컬러(골드/옐로우) 적용 */}
              <Button
                variant="default"
                size="lg"
                className="group flex h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-none bg-[#E9B93F] text-white transition-all hover:bg-[#d4a835] active:scale-95"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="h-5 w-5 text-white transition-transform duration-500 group-hover:rotate-180" />
                <span className="text-xs font-bold">새로고침</span>
              </Button>
            </div>

            {/* Help Section */}
            <div
              className="bg-surface mt-10 rounded-lg p-4"
              style={{ animationDelay: "0.7s" }}
            >
              <p className="text-muted-foreground text-xs">
                문제가 계속된다면{" "}
                <span className="text-foreground font-medium">고객센터</span>로
                문의해 주세요.
              </p>
            </div>
          </div>
        </main>
      </div>
    )
  }
}
