"use client"

import { useEffect, useState } from "react"

import { MainHeader } from "@/components/layout/header/main-header"

import ErrorCard from "./error-card"
import PanoramaScene from "./panorama-scene"

interface ErrorPageContentProps {
  onRetry: () => void
  onGoHome: () => void
}

export default function ErrorPageContent({
  onRetry,
  onGoHome,
}: ErrorPageContentProps) {
  const [reducedMotion, setReducedMotion] = useState(false)

  // 사용자의 모션 설정 감지
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReducedMotion(mediaQuery.matches)

    const handleChange = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches)
    }

    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [])

  return (
    <div className="flex min-h-screen flex-col">
      {/* 실제 헤더 */}
      <MainHeader />

      {/* 파노라마 풍경 (헤더와 푸터 사이 전체) */}
      <div className="relative flex-1 overflow-hidden">
        <PanoramaScene reducedMotion={reducedMotion} />

        {/* 에러 메시지 카드 */}
        <ErrorCard onRetry={onRetry} onGoHome={onGoHome} />
      </div>

      {/* 푸터 공간 */}
      <footer className="h-20 shrink-0 border-t border-gray-200 bg-white">
        <div className="container mx-auto flex h-full items-center justify-center px-4">
          <p className="text-xs text-gray-500">
            문제가 계속된다면 고객센터로 문의해 주세요.
          </p>
        </div>
      </footer>
    </div>
  )
}
