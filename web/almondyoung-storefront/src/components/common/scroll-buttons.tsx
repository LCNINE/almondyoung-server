"use client"

import React, { useRef, useEffect, useState } from "react"

interface ScrollButtonsProps {
  children: React.ReactNode
  scrollAmount?: number
  className?: string
  containerClassName?: string
  showButtons?: boolean
  buttonSize?: "sm" | "md" | "lg"
  buttonPosition?: "inside" | "outside"
}

export const ScrollButtons: React.FC<ScrollButtonsProps> = ({
  children,
  scrollAmount = 200,
  className = "",
  containerClassName = "",
  showButtons = true,
  buttonSize = "md",
  buttonPosition = "inside"
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  // 스크롤 상태 업데이트 함수
  const updateScrollButtons = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current
      setCanScrollLeft(scrollLeft > 0)
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1)
    }
  }

  // 스크롤 함수
  const scroll = (direction: "left" | "right") => {
    if (scrollContainerRef.current) {
      const newScrollLeft = direction === "left"
        ? scrollContainerRef.current.scrollLeft - scrollAmount
        : scrollContainerRef.current.scrollLeft + scrollAmount

      scrollContainerRef.current.scrollTo({
        left: newScrollLeft,
        behavior: "smooth",
      })
    }
  }

  // 스크롤 이벤트 리스너
  useEffect(() => {
    const container = scrollContainerRef.current
    if (container) {
      container.addEventListener("scroll", updateScrollButtons)
      // 초기 상태 업데이트
      updateScrollButtons()

      return () => {
        container.removeEventListener("scroll", updateScrollButtons)
      }
    }
  }, [])

  // 컨텐츠가 변경될 때 스크롤 상태 업데이트
  useEffect(() => {
    const timer = setTimeout(() => {
      updateScrollButtons()
    }, 100)

    return () => clearTimeout(timer)
  }, [children])

  // 버튼 크기 클래스
  const getButtonSizeClass = () => {
    switch (buttonSize) {
      case "sm":
        return "h-6 w-6"
      case "lg":
        return "h-10 w-10"
      default:
        return "h-8 w-8"
    }
  }

  // 아이콘 크기 클래스
  const getIconSizeClass = () => {
    switch (buttonSize) {
      case "sm":
        return "h-3 w-3"
      case "lg":
        return "h-5 w-5"
      default:
        return "h-4 w-4"
    }
  }

  // 버튼 위치 클래스
  const getButtonPositionClass = () => {
    if (buttonPosition === "outside") {
      return "left-0 right-0"
    }
    return "left-0 right-0"
  }

  if (!showButtons) {
    return (
      <div className={`scrollbar-hide overflow-x-auto ${containerClassName}`}>
        {children}
      </div>
    )
  }

  return (
    <div className={`relative ${className}`}>
      {/* 왼쪽 스크롤 버튼 */}
      {canScrollLeft && (
        <button
          onClick={() => scroll("left")}
          className={`absolute top-1/2 z-10 flex ${getButtonSizeClass()} -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-md transition-all duration-200 hover:bg-gray-50 ${
            buttonPosition === "outside" ? "-left-4" : "left-0"
          }`}
        >
          <svg
            className={`${getIconSizeClass()} text-gray-600`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      )}

      {/* 스크롤 컨테이너 */}
      <div
        ref={scrollContainerRef}
        className={`scrollbar-hide overflow-x-auto ${
          buttonPosition === "inside" && canScrollLeft ? "pl-10" : ""
        } ${
          buttonPosition === "inside" && canScrollRight ? "pr-10" : ""
        } ${containerClassName}`}
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        {children}
      </div>

      {/* 오른쪽 스크롤 버튼 */}
      {canScrollRight && (
        <button
          onClick={() => scroll("right")}
          className={`absolute top-1/2 z-10 flex ${getButtonSizeClass()} -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-md transition-all duration-200 hover:bg-gray-50 ${
            buttonPosition === "outside" ? "-right-4" : "right-0"
          }`}
        >
          <svg
            className={`${getIconSizeClass()} text-gray-600`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      )}
    </div>
  )
}

export default ScrollButtons
