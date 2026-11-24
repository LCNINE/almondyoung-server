"use client"

import { usePathname } from "next/navigation"
import { KakaoCsButton } from "./kakao-cs-button"
import { ScrollTopButton } from "./scroll-top-button"

interface FloatingButtonsProps {
  showScrollTop?: boolean
  showChatbot?: boolean
  showKakaoTalk?: boolean
  scrollThreshold?: number
  onChatbotClick?: () => void
  className?: string
}

// 카카오 버튼을 숨길 경로
const HIDE_KAKAO_PATHS = ["/cart", "/checkout", "/membership/subscribe/success"]

export function FloatingButtons({
  showScrollTop = true,
  showChatbot = true,
  showKakaoTalk = true,
  scrollThreshold = 300,
  onChatbotClick,
  className = "",
}: FloatingButtonsProps) {
  const pathname = usePathname()
  const shouldShowKakao =
    showKakaoTalk && !HIDE_KAKAO_PATHS.some((path) => pathname?.includes(path))
  // 결제 화면은 lg 미만에서 하단 결제 바가 고정돼 있어 그 위로 올린다
  const position = pathname?.includes("/checkout")
    ? "bottom-40 lg:bottom-6"
    : "bottom-20 md:bottom-6"

  return (
    <div
      className={`fixed right-4 z-50 flex flex-col items-center gap-2.5 md:right-6 ${position} ${className}`}
    >
      {/* {showChatbot && <ChatbotButton onClick={onChatbotClick} />} */}
      {shouldShowKakao && <KakaoCsButton />}
      {showScrollTop && <ScrollTopButton threshold={scrollThreshold} />}
    </div>
  )
}
