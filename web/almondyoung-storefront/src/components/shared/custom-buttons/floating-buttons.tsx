"use client"

import { ScrollTopButton } from "./scroll-top-button"
import { ChatbotButton } from "./chatbot-button"

interface FloatingButtonsProps {
  showScrollTop?: boolean
  showChatbot?: boolean
  scrollThreshold?: number
  onChatbotClick?: () => void
  className?: string
}

export function FloatingButtons({
  showScrollTop = true,
  showChatbot = true,
  scrollThreshold = 300,
  onChatbotClick,
  className = "",
}: FloatingButtonsProps) {
  return (
    <div
      className={`fixed right-6 bottom-20 z-50 flex flex-col items-center gap-3 ${className}`}
    >
      {/* {showChatbot && (
        <ChatbotButton onClick={onChatbotClick} />
      )} */}
      {showScrollTop && <ScrollTopButton threshold={scrollThreshold} />}
    </div>
  )
}
