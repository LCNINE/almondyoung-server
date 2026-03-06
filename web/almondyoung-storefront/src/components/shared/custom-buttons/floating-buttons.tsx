"use client"

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

export function FloatingButtons({
  showScrollTop = true,
  showChatbot = true,
  showKakaoTalk = true,
  scrollThreshold = 300,
  onChatbotClick,
  className = "",
}: FloatingButtonsProps) {
  return (
    <div
      className={`fixed right-6 bottom-20 z-50 flex flex-col items-center gap-3 ${className}`}
    >
      {/* {showChatbot && <ChatbotButton onClick={onChatbotClick} />} */}
      {showKakaoTalk && <KakaoCsButton />}
      {showScrollTop && <ScrollTopButton threshold={scrollThreshold} />}
    </div>
  )
}
