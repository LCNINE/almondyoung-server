"use client"

import { useState, useEffect } from "react"
import { ArrowUp } from "lucide-react"

interface ScrollTopButtonProps {
  threshold?: number
  className?: string
}

export function ScrollTopButton({ 
  threshold = 300, 
  className = "" 
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
      behavior: "smooth"
    })
  }

  if (!isVisible) return null

  return (
    <button
      onClick={scrollToTop}
      aria-label="맨 위로 가기"
      className={`
        border-border-primary flex h-12 w-12 items-center justify-center 
        rounded-full border bg-white text-black shadow-md transition-opacity
        hover:opacity-80
        ${className}
      `}
    >
      <ArrowUp size={24} />
    </button>
  )
}
