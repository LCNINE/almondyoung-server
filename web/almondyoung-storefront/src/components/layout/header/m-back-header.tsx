"use client"

import { cn } from "@lib/utils"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
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
  const pathSegments = pathname.split("/").filter(Boolean)
  const authIndex = pathSegments.findIndex((segment) => segment === "auth")
  const mypageIndex = pathSegments.findIndex((segment) => segment === "mypage")

  // auth 경로 처리
  if (authIndex !== -1) {
    const authSubpage = pathSegments[authIndex + 1]
    const authTitleMap: Record<string, string> = {
      login: "로그인",
      signup: "회원가입",
      "find-password": "비밀번호 찾기",
      "find-email": "이메일 찾기",
    }
    return authTitleMap[authSubpage] || "로그인"
  }

  // mypage 경로 처리
  if (mypageIndex !== -1) {
    const mypageSubpage = pathSegments[mypageIndex + 1]
    const mypageTitleMap: Record<string, string> = {
      wish: "찜한 상품",
      orders: "주문/배송 내역",
      order: "주문/배송 내역",
      frequent: "자주 산 상품",
      recent: "최근 본 상품",
      shopSettings: "맞춤설정",
      shopSetting: "맞춤설정",
      returns: "취소/반품/교환 목록",
      reviews: "리뷰관리",
      membership: "아몬드영 멤버십",
      payment: "결제수단·적립금",
      subscribe: "구독 관리",
      exchange: "교환/반품",
      rebuy: "재주문",
      download: "다운로드",
    }
    return mypageTitleMap[mypageSubpage] || "마이페이지"
  }

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

  const defaultFallback = `/${countryCode}/mypage`
  const finalFallback = fallbackHref || defaultFallback

  const [dynamicTitle, setDynamicTitle] = useState(() => {
    if (title) return title
    return getPageTitleFromPath(pathname)
  })

  useEffect(() => {
    if (title) {
      setDynamicTitle(title)
      return
    }
    setDynamicTitle(getPageTitleFromPath(pathname))
  }, [pathname, title])

  const handleBack = () => {
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
      <div className="w-6" />
    </header>
  )
}
