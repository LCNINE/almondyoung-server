"use client"

import React from "react"
import Image from "next/image"

interface HeroImageBannerProps {
  imageUrl: string
  sectionname: string
  height?: {
    lg?: number
    md?: number
    sm?: number
  }
  className?: string
}

export default function HeroImageBanner({
  imageUrl,
  sectionname,
  height = {
    lg: 540,
    md: 500,
    sm: 320
  },
  className = ""
}: HeroImageBannerProps) {
  // 반응형 높이 스타일 생성
  const getHeightStyle = () => {
    const styles: React.CSSProperties = {}
    
    if (height.sm) {
      styles.height = `${height.sm}px`
    }
    
    return styles
  }

  // Tailwind 클래스로 반응형 높이 설정
  const getHeightClasses = () => {
    const classes = []
    
    if (height.sm) {
      classes.push(`h-[${height.sm}px]`)
    }
    if (height.md) {
      classes.push(`md:h-[${height.md}px]`)
    }
    if (height.lg) {
      classes.push(`lg:h-[${height.lg}px]`)
    }
    
    return classes.join(' ')
  }

  return (
    <div 
      className={`relative w-full overflow-hidden ${getHeightClasses()} ${className}`}
      style={getHeightStyle()}
    >
      <Image 
        src={imageUrl} 
        alt={`${sectionname} hero image banner`} 
        fill
        className="object-cover"
        priority
      />
    </div>
  )
}
