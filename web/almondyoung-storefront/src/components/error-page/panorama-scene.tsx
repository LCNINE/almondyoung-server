"use client"

import { motion, useMotionValue } from "framer-motion"
import Image from "next/image"
import { useCallback, useEffect, useRef, useState } from "react"

import { CHARACTERS } from "./constants"
import WalkingCharacter from "./walking-character"

// 배경 이미지 크기
const PANORAMA_WIDTH = 3000

// 마우스 위치에 따른 스크롤 설정
const EDGE_THRESHOLD = 150
const MAX_SCROLL_SPEED = 8

// 모바일 자동 스크롤 설정
const MOBILE_AUTO_SCROLL_SPEED = 0.5

interface PanoramaSceneProps {
  reducedMotion?: boolean
}

export default function PanoramaScene({
  reducedMotion = false,
}: PanoramaSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [isMobile, setIsMobile] = useState(false)
  const mouseXRef = useRef<number | null>(null)
  const scrollRef = useRef<number | null>(null)
  const touchStartRef = useRef<number | null>(null)
  const lastTouchXRef = useRef<number | null>(null)

  // 스크롤 위치 추적
  const x = useMotionValue(0)

  // 스크롤 제약 계산
  const minX = -(PANORAMA_WIDTH - viewportWidth)
  const maxX = 0

  // 모바일 감지 + viewport 크기 감지
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setViewportWidth(containerRef.current.offsetWidth)
        setContainerHeight(containerRef.current.offsetHeight)
      }
      // 모바일 감지 (768px 이하 또는 터치 디바이스)
      setIsMobile(
        window.matchMedia("(max-width: 768px)").matches ||
          "ontouchstart" in window
      )
    }

    updateSize()
    window.addEventListener("resize", updateSize)
    return () => window.removeEventListener("resize", updateSize)
  }, [])

  // 초기 위치를 중앙으로 설정
  useEffect(() => {
    if (viewportWidth > 0) {
      const centerOffset = -(PANORAMA_WIDTH - viewportWidth) / 2
      x.set(centerOffset)
    }
  }, [viewportWidth, x])

  // 마우스 위치에 따른 스크롤 (데스크톱)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    mouseXRef.current = e.clientX - rect.left
  }, [])

  const handleMouseLeave = useCallback(() => {
    mouseXRef.current = null
  }, [])

  // 터치 스와이프 (모바일)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = e.touches[0].clientX
    lastTouchXRef.current = e.touches[0].clientX
  }, [])

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (lastTouchXRef.current === null) return

      const currentTouchX = e.touches[0].clientX
      const deltaX = currentTouchX - lastTouchXRef.current
      lastTouchXRef.current = currentTouchX

      const currentX = x.get()
      const newX = Math.max(minX, Math.min(maxX, currentX + deltaX))
      x.set(newX)
    },
    [x, minX, maxX]
  )

  const handleTouchEnd = useCallback(() => {
    touchStartRef.current = null
    lastTouchXRef.current = null
  }, [])

  // 스크롤 애니메이션 루프
  useEffect(() => {
    if (reducedMotion || viewportWidth === 0) return

    let autoScrollDirection = 1

    const scroll = () => {
      // 데스크톱: 마우스 위치 기반 스크롤
      if (!isMobile) {
        const mouseX = mouseXRef.current

        if (mouseX !== null) {
          let speed = 0

          if (mouseX < EDGE_THRESHOLD) {
            const ratio = 1 - mouseX / EDGE_THRESHOLD
            speed = MAX_SCROLL_SPEED * ratio
          } else if (mouseX > viewportWidth - EDGE_THRESHOLD) {
            const ratio =
              (mouseX - (viewportWidth - EDGE_THRESHOLD)) / EDGE_THRESHOLD
            speed = -MAX_SCROLL_SPEED * ratio
          }

          if (speed !== 0) {
            const currentX = x.get()
            const newX = Math.max(minX, Math.min(maxX, currentX + speed))
            x.set(newX)
          }
        }
      }
      // 모바일: 터치 중이 아닐 때만 자동 스크롤
      else if (lastTouchXRef.current === null) {
        const currentX = x.get()
        let newX = currentX - MOBILE_AUTO_SCROLL_SPEED * autoScrollDirection

        if (newX <= minX) {
          newX = minX
          autoScrollDirection = -1
        } else if (newX >= maxX) {
          newX = maxX
          autoScrollDirection = 1
        }

        x.set(newX)
      }

      scrollRef.current = requestAnimationFrame(scroll)
    }

    // 모바일은 즉시 시작, 데스크톱은 약간 지연
    const delay = isMobile ? 1000 : 0
    const timeout = setTimeout(() => {
      scrollRef.current = requestAnimationFrame(scroll)
    }, delay)

    return () => {
      clearTimeout(timeout)
      if (scrollRef.current) {
        cancelAnimationFrame(scrollRef.current)
      }
    }
  }, [reducedMotion, viewportWidth, isMobile, x, minX, maxX])

  // 캐릭터 위치 및 크기 조정 (모바일에서 작게)
  const groundY = containerHeight - 20
  const adjustedCharacters = CHARACTERS.map((char) => ({
    ...char,
    y: groundY,
    size: isMobile ? Math.round(char.size * 0.6) : char.size,
  }))

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 select-none overflow-hidden touch-pan-y"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDragStart={(e) => e.preventDefault()}
    >
      <motion.div
        style={{
          x,
          width: PANORAMA_WIDTH,
          height: "100%",
          position: "relative",
        }}
      >
        {/* 배경 이미지 */}
        <Image
          src="/images/error-bg.png"
          alt="풍경 배경"
          fill
          className="pointer-events-none object-cover object-bottom"
          priority
          draggable={false}
          unoptimized
        />

        {/* 걸어다니는 캐릭터들 */}
        {containerHeight > 0 &&
          adjustedCharacters.map((character, index) => (
            <WalkingCharacter
              key={`character-${character.type}-${index}`}
              config={character}
              reducedMotion={reducedMotion}
            />
          ))}
      </motion.div>

      {/* 스크롤 힌트 */}
      {!reducedMotion && (
        <motion.div
          className="pointer-events-none absolute bottom-4 left-1/2 w-auto max-w-[90vw] -translate-x-1/2"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ delay: 4, duration: 1 }}
        >
          {isMobile ? (
            <div className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-black/40 px-4 py-2 text-xs text-white backdrop-blur-sm">
              <span>👆 좌우로 밀어보세요!</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 whitespace-nowrap rounded-full bg-black/40 px-4 py-2 text-sm text-white backdrop-blur-sm">
              <span>🖱️ 화면 가장자리로 마우스를 움직여보세요!</span>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
