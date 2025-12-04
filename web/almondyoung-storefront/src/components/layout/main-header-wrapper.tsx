"use client"

import { usePathname } from "next/navigation"
import { DesktopHeader } from "./components/header/desktop-header"
import { MobileGlobalHeader } from "./components/header/m.global-header"

/**
 * 메인 레이아웃용 헤더 래퍼 컴포넌트
 * 
 * 기본값: 데스크탑 + 모바일 헤더 모두 표시
 * 예외 처리: 필요시 특정 경로에서 헤더 숨김 등
 */
export function MainHeaderWrapper() {
  const pathname = usePathname()

  // 기본값: 데스크탑 + 모바일 헤더 모두 표시
  const showDesktopHeader = true
  const showMobileHeader = true

  // 예외 처리: 필요시 여기에 추가
  // 예: if (pathname?.includes('/login')) return null

  return (
    <>
      {/* 데스크탑 글로벌 헤더 */}
      {showDesktopHeader && (
        <div className="hidden md:block">
          <DesktopHeader />
        </div>
      )}

      {/* 모바일 글로벌 헤더 */}
      {showMobileHeader && (
        <div className="block md:hidden">
          <MobileGlobalHeader />
        </div>
      )}
    </>
  )
}

