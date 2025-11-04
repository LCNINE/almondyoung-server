"use client"

import React, { useState, useEffect } from "react"
import { BadgePercent } from "lucide-react"


interface AnimatedMembershipTextProps {
  className?: string
  delay?: number
  duration?: number
  repeat?: boolean // 반복 여부
  repeatInterval?: number // 반복 간격 (ms)
}

export const AnimatedMembershipText: React.FC<AnimatedMembershipTextProps> = ({
  className = "",
  delay = 0,
  duration = 2000,
  repeat = true,
  repeatInterval = 8000
}) => {
  const [showText, setShowText] = useState(true) // 텍스트를 먼저 표시
  const [displayPrice, setDisplayPrice] = useState("0,000")
  const [isAnimating, setIsAnimating] = useState(false)
  const [targetPrice, setTargetPrice] = useState(0)

  const startAnimation = () => {
    // 먼저 텍스트를 숨기고 애니메이션 시작
    setShowText(false)
    
    // 1,000원부터 14,040원까지 랜덤한 목표 가격 설정
    const randomPrice = Math.floor(Math.random() * 13040) + 1000
    setTargetPrice(randomPrice)
    setIsAnimating(true)
    
    // 숫자 카운트 애니메이션 (높은 숫자부터 낮은 숫자로)
    const startTime = Date.now()
    const animateCount = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      
      // 높은 숫자부터 100원까지 카운트다운 (부드러운 애니메이션을 위해 easeOut 사용)
      const easeOut = 1 - Math.pow(1 - progress, 3)
      const currentCount = Math.floor((1 - easeOut) * (randomPrice - 100) + 100)
      
      // 4자리 숫자에 콤마 추가
      const formattedPrice = currentCount.toLocaleString()
      setDisplayPrice(formattedPrice)
      
      if (progress < 1) {
        requestAnimationFrame(animateCount)
      } else {
        // 숫자 애니메이션 완료 후 텍스트 다시 표시
        setTimeout(() => {
          setShowText(true)
          setIsAnimating(false)
          
          // 반복 설정이 되어있으면 일정 시간 후 다시 시작
          if (repeat) {
            setTimeout(() => {
              startAnimation()
            }, repeatInterval)
          }
        }, 300)
      }
    }
    
    requestAnimationFrame(animateCount)
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      startAnimation()
    }, delay)

    return () => clearTimeout(timer)
  }, [delay, duration, repeat, repeatInterval])

  return (
    <div className={`relative ${className}`}>
      {/* 숫자 애니메이션 */}
      {isAnimating && (
        <span className="text-base font-bold text-gray-400 md:text-[19px] animate-pulse">
          {displayPrice}?원
        </span>
      )}
      
      {/* 멤버십공개 텍스트 - 애니메이션 완료 후에만 표시 */}
      {showText && !isAnimating && (
        <span 
          className="text-base font-bold text-black md:text-[19px] animate-fade-in duration-[2000ms]"
          style={{
            animation: 'fadeInUp 0.5s ease-out forwards'
          }}
        >
          <span className="flex items-center gap-1">멤버십공개</span>
        </span>
      )}
      
      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}

export default AnimatedMembershipText
