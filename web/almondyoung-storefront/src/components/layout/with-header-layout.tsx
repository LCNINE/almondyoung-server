import { UserDetail } from "@lib/types/ui/user"
import React from "react"
import { MainHeader } from "@/components/layout/header/main-header"
import MobileSubBackHeader from "./header/m-sub-back-header"

export type GlobalHeaderConfig = {
  /** 데스크탑 글로벌 헤더 표시 여부 (기본: true) */
  showDesktopHeader?: boolean
  /** 모바일 글로벌 헤더 표시 여부 (기본: false) */
  showMobileHeader?: boolean
  user?: UserDetail | null
  /** 모바일 서브 헤더 표시 여부 (기본: false) */
  showMobileSubBackHeader?: boolean
  /** 모바일 서브 헤더 제목 */
  mobileSubBackHeaderTitle?: string
}

interface WithHeaderLayoutProps {
  children: React.ReactNode
  config?: GlobalHeaderConfig
}

export function WithHeaderLayout({ children, config }: WithHeaderLayoutProps) {
  const {
    showDesktopHeader = true,
    showMobileHeader = false,
    showMobileSubBackHeader = false,
    mobileSubBackHeaderTitle = "",
  } = config || {}

  return (
    <>
      {/* 데스크탑 글로벌 헤더 */}
      {showDesktopHeader && (
        <div className="hidden md:block">
          <MainHeader />
        </div>
      )}

      {showMobileSubBackHeader && (
        <>
          <div className="block md:hidden">
            <MobileSubBackHeader title={mobileSubBackHeaderTitle} />
          </div>
          {/* 모바일에서 fixed 헤더 높이만큼 여백 */}
          <div className="h-12 md:hidden" />
        </>
      )}

      {/* 페이지 콘텐츠 */}
      {children}
    </>
  )
}
