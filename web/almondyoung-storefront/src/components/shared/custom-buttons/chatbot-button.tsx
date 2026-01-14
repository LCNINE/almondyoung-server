"use client"

import { MessageCircle } from "lucide-react"

interface ChatbotButtonProps {
  className?: string
  onClick?: () => void
}

export function ChatbotButton({ 
  className = "",
  onClick
}: ChatbotButtonProps) {
  const handleClick = () => {
    if (onClick) {
      onClick()
    } else {
      // 기본 채팅봇 동작 (예: 채팅창 열기)
      console.log("채팅봇 열기")
      // 실제 구현에서는 채팅봇 모달이나 사이드바를 여는 로직을 추가
    }
  }

  return (
    <button
      onClick={handleClick}
      aria-label="상담톡"
      className={`
        bg-fab-talk shadow-fab flex h-14 w-14 items-center justify-center 
        rounded-full text-black
        hover:opacity-80 transition-opacity
        ${className}
      `}
    >
      <MessageCircle size={28} />
    </button>
  )
}
