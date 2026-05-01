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
const HIDE_KAKAO_PATHS = ["/cart", "/checkout"]

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

  return (
    <div
      className={`fixed right-6 bottom-20 z-50 flex flex-col items-center gap-3 ${className}`}
    >
      {/* {showChatbot && <ChatbotButton onClick={onChatbotClick} />} */}
      {shouldShowKakao && <KakaoCsButton />}
      {showScrollTop && <ScrollTopButton threshold={scrollThreshold} />}
    </div>
  )
}
