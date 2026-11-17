"use client"

import { useState, useEffect } from "react"
import { ArrowUp } from "lucide-react"

interface ScrollTopButtonProps {
  threshold?: number
  className?: string
}

export function ScrollTopButton({
  threshold = 300,
  className = "",
}: ScrollTopButtonProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const toggleVisibility = () => {
      if (window.scrollY > threshold) {
        setIsVisible(true)
      } else {
        setIsVisible(false)
      }
    }

    window.addEventListener("scroll", toggleVisibility)
    return () => window.removeEventListener("scroll", toggleVisibility)
  }, [threshold])

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    })
  }

  if (!isVisible) return null

  return (
    <button
      onClick={scrollToTop}
      aria-label="맨 위로 가기"
      className={`text-ink flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-[0_4px_14px_rgba(20,22,23,0.2)] transition-opacity hover:opacity-80 md:h-[52px] md:w-[52px] ${className}`}
    >
      <ArrowUp className="h-5 w-5 md:h-6 md:w-6" />
    </button>
  )
}
