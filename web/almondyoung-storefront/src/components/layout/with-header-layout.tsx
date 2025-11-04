import React from "react"
import { DesktopHeader } from "./components/header/desktop-header"
import { MobileGlobalHeader } from "./components/header/m.global-header"
import { UserBasicInfo } from "@lib/types/ui/user"
import MobileSubBackHeader from "./components/header/mobile-sub-back-header"

/**
 * 글로벌 헤더 설정 타입
 */
export type GlobalHeaderConfig = {
  /** 데스크탑 글로벌 헤더 표시 여부 (기본: true) */
  showDesktopHeader?: boolean
  /** 모바일 글로벌 헤더 표시 여부 (기본: false) */
  showMobileHeader?: boolean
  /** 사용자 정보 */
  user?: UserBasicInfo | null
  /** 모바일 서브 헤더 표시 여부 (기본: false) */
  showMobileSubBackHeader?: boolean
  /** 모바일 서브 헤더 제목 */
  mobileSubBackHeaderTitle?: string
}

interface WithHeaderLayoutProps {
  children: React.ReactNode
  config?: GlobalHeaderConfig
}

/**
 * 페이지별 글로벌 헤더(데스크탑/모바일)만 관리하는 레이아웃 컴포넌트
 *
 * 📌 책임:
 * - 데스크탑 글로벌 헤더 on/off
 * - 모바일 글로벌 헤더 on/off
 *
 * 📌 책임 아님:
 * - 서브 헤더(MobileBackHeader)는 각 페이지에서 직접 import 사용
 *
 * @example
 * // 홈페이지: 글로벌 헤더 (PC + 모바일)
 * <PageLayout config={{
 *   showDesktopHeader: true,
 *   showMobileHeader: true
 * }}>
 *   <HomePage />
 * </PageLayout>
 *
 * @example
 * // 카테고리: PC 글로벌 헤더만, 모바일은 페이지에서 직접 처리
 * <PageLayout config={{
 *   showDesktopHeader: true,
 *   showMobileHeader: false
 * }}>
 *   <MobileBackHeader title="카테고리" />
 *   <CategoryPage />
 * </PageLayout>
 *
 * @example
 * // 로그인: 글로벌 헤더 없음
 * <PageLayout config={{
 *   showDesktopHeader: false,
 *   showMobileHeader: false
 * }}>
 *   <MobileBackHeader title="로그인" />
 *   <LoginPage />
 * </PageLayout>
 */
export function WithHeaderLayout({ children, config }: WithHeaderLayoutProps) {
  const {
    showDesktopHeader = true,
    showMobileHeader = false,
    showMobileSubBackHeader = false,
    mobileSubBackHeaderTitle = "",
    user = null,
  } = config || {}

  return (
    <>
      {/* 데스크탑 글로벌 헤더 */}
      {showDesktopHeader && (
        <div className="hidden md:block">
          <DesktopHeader user={user} />
        </div>
      )}

      {/* 모바일 글로벌 헤더 (메뉴 + 검색 + 카테고리 리스트) */}
      {showMobileHeader && (
        <div className="block md:hidden">
          <MobileGlobalHeader user={user} />
        </div>
      )}

      {showMobileSubBackHeader && (
        <div className="block md:hidden">
          <MobileSubBackHeader title={mobileSubBackHeaderTitle} />
        </div>
      )}

      {/* 페이지 콘텐츠 */}
      {children}
    </>
  )
}
