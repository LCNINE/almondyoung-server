"use client"

import { cn } from "@lib/utils"
import { CustomButton } from "@components/common/custom-buttons/custom-button"
import { ArrowLeft } from "lucide-react"
import { useRouter, usePathname, useParams } from "next/navigation"
import { useState, useEffect } from "react"

interface MobileBackHeaderProps {
  title?: string
  className?: string
  back?: boolean
  fallbackHref?: string
}

// URL 기반 페이지 제목 매핑
const getPageTitleFromPath = (pathname: string): string => {
  console.log("🔍 [getPageTitleFromPath] 전체 경로:", pathname)

  const pathSegments = pathname.split("/").filter(Boolean)
  console.log("🔍 [getPageTitleFromPath] 경로 세그먼트:", pathSegments)

  const authIndex = pathSegments.findIndex((segment) => segment === "auth")
  const mypageIndex = pathSegments.findIndex((segment) => segment === "mypage")

  // auth 경로 처리
  if (authIndex !== -1) {
    const authSubpage = pathSegments[authIndex + 1]
    console.log("🔍 [getPageTitleFromPath] auth 서브페이지:", authSubpage)

    const authTitleMap: Record<string, string> = {
      login: "로그인",
      signup: "회원가입",
      "find-password": "비밀번호 찾기",
      "find-email": "이메일 찾기",
    }

    const result = authTitleMap[authSubpage] || "로그인"
    console.log("✅ [getPageTitleFromPath] auth 최종 결과:", result)
    return result
  }

  // mypage 경로 처리
  if (mypageIndex !== -1) {
    const mypageSubpage = pathSegments[mypageIndex + 1]
    console.log("🔍 [getPageTitleFromPath] mypage 서브페이지:", mypageSubpage)

    const mypageTitleMap: Record<string, string> = {
      wish: "찜한 상품",
      orders: "주문/배송 내역",
      order: "주문/배송 내역",
      frequent: "자주 산 상품",
      recent: "최근 본 상품",
      settings: "맞춤설정",
      setting: "맞춤설정",
      returns: "취소/반품/교환 목록",
      reviews: "리뷰관리",
      membership: "아몬드영 멤버십",
      payment: "결제수단·적립금",
      subscribe: "구독 관리",
      exchange: "교환/반품",
      rebuy: "재주문",
      download: "다운로드",
    }

    const result = mypageTitleMap[mypageSubpage] || "마이페이지"
    console.log("✅ [getPageTitleFromPath] mypage 최종 결과:", result)
    return result
  }

  console.log("❌ [getPageTitleFromPath] 경로를 찾을 수 없음")
  return "마이페이지"
}

export function MobileBackHeader({
  title,
  className,
  back = true,
  fallbackHref,
}: MobileBackHeaderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams() as { countryCode?: string }
  const countryCode = params?.countryCode || "kr"

  // fallbackHref 기본값: /<countryCode>/mypage
  const defaultFallback = `/${countryCode}/mypage`
  const finalFallback = fallbackHref || defaultFallback

  // 초기값을 URL에서 바로 계산 (title prop이 없을 때만)
  const [dynamicTitle, setDynamicTitle] = useState(() => {
    if (title) return title
    const initialTitle = getPageTitleFromPath(pathname)
    console.log("🚀 [MobileBackHeader] 초기 제목 계산:", {
      pathname,
      initialTitle,
    })
    return initialTitle
  })

  // URL 변경 시 제목 업데이트 (title prop이 없을 때만)
  useEffect(() => {
    if (title) {
      setDynamicTitle(title)
      return
    }
    const newTitle = getPageTitleFromPath(pathname)
    console.log("🔄 [MobileBackHeader] URL 변경 감지:", { pathname, newTitle })
    setDynamicTitle(newTitle)
  }, [pathname, title])

  const handleBack = () => {
    // 히스토리가 있으면 뒤로가기, 없으면 fallback으로 이동
    if (
      (document.referrer &&
        new URL(document.referrer).origin === window.location.origin) ||
      window.history.length > 1
    ) {
      router.back()
    } else {
      router.push(finalFallback)
    }
  }

  return (
    <header
      className={cn(
        "border-border-muted bg-background fixed top-0 right-0 left-0 z-50 flex h-[43px] w-full items-center justify-between border-b-[0.5px] px-[15px] md:hidden",
        className
      )}
    >
      {back ? (
        <CustomButton
          variant="ghost"
          onClick={handleBack}
          className="cursor-pointer hover:bg-transparent! hover:text-black"
          size={"icon"}
          aria-label="뒤로가기"
        >
          <ArrowLeft className="h-6 w-6" />
        </CustomButton>
      ) : (
        <div className="w-6" />
      )}
      <h1 className="text-base font-bold">{dynamicTitle}</h1>
      <div className="w-6" /> {/* 단순 공간 유지용 */}
    </header>
  )
}
