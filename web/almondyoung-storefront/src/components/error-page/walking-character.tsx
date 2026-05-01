"use client"

import { motion, useAnimation } from "framer-motion"
import { useCallback, useEffect, useMemo, useState } from "react"

import type { CharacterConfig, CharacterType } from "./constants"

// 캐릭터별 스프라이트 시트 설정
const SPRITE_CONFIG: Record<
  CharacterType,
  {
    src: string
    sheetSize: number // 전체 시트 크기
    frameSize: number // 한 프레임 크기
    frames: number // 프레임 수
  }
> = {
  chicken: {
    src: "/images/characters/chicken_walk.png",
    sheetSize: 128,
    frameSize: 32,
    frames: 4,
  },
  pig: {
    src: "/images/characters/pig_walk.png",
    sheetSize: 512,
    frameSize: 128,
    frames: 4,
  },
  cow: {
    src: "/images/characters/cow_walk.png",
    sheetSize: 512,
    frameSize: 128,
    frames: 4,
  },
  sheep: {
    src: "/images/characters/sheep_walk.png",
    sheetSize: 512,
    frameSize: 128,
    frames: 4,
  },
}

// 캐릭터별 방향 행 인덱스 (스프라이트 시트마다 다름)
const DIRECTION_ROW: Record<CharacterType, { left: number; right: number }> = {
  chicken: { left: 1, right: 3 },
  pig: { left: 1, right: 3 },
  cow: { left: 1, right: 3 },
  sheep: { left: 1, right: 3 },
}

// 캐릭터별 클릭 애니메이션
const CLICK_ANIMATIONS: Record<CharacterType, object> = {
  chicken: {
    y: [0, -30, 0, -20, 0],
    rotate: [0, -15, 15, -10, 0],
    scale: [1, 1.2, 1],
  },
  pig: {
    scale: [1, 1.3, 0.9, 1.2, 1],
    rotate: [0, -8, 8, -5, 0],
    y: [0, -20, 0],
  },
  cow: {
    y: [0, -15, 0, -10, 0],
    scale: [1, 1.15, 1],
  },
  sheep: {
    y: [0, -35, 0, -25, 0, -15, 0],
    scale: [1, 1.1, 0.95, 1.1, 1],
  },
}

interface WalkingCharacterProps {
  config: CharacterConfig
  reducedMotion?: boolean
}

export default function WalkingCharacter({
  config,
  reducedMotion = false,
}: WalkingCharacterProps) {
  const { type, initialX, y, size, speed, range, direction, zIndex } = config
  const [isClicked, setIsClicked] = useState(false)
  const [currentDirection, setCurrentDirection] = useState<"left" | "right">(direction)
  const [frame, setFrame] = useState(0)
  const clickControls = useAnimation()

  const spriteConfig = SPRITE_CONFIG[type]
  const scale = size / spriteConfig.frameSize

  // 스프라이트 애니메이션 (프레임 전환)
  useEffect(() => {
    if (reducedMotion) return

    const frameInterval = setInterval(() => {
      setFrame((prev) => (prev + 1) % spriteConfig.frames)
    }, 180)

    return () => clearInterval(frameInterval)
  }, [reducedMotion, spriteConfig.frames])

  // 방향 전환 타이머
  useEffect(() => {
    if (reducedMotion) return

    // speed 초마다 방향 전환
    const directionInterval = setInterval(() => {
      setCurrentDirection((prev) => (prev === "left" ? "right" : "left"))
    }, speed * 1000)

    return () => clearInterval(directionInterval)
  }, [reducedMotion, speed])

  // 클릭 핸들러
  const handleClick = useCallback(async () => {
    if (isClicked) return

    setIsClicked(true)
    await clickControls.start({
      ...CLICK_ANIMATIONS[type],
      transition: {
        duration: 0.6,
        ease: "easeInOut",
      },
    })
    await clickControls.start({
      scale: 1,
      rotate: 0,
      y: 0,
      transition: { duration: 0.2 },
    })
    setIsClicked(false)
  }, [clickControls, type, isClicked])

  // 스프라이트 배경 위치 계산
  const row = DIRECTION_ROW[type][currentDirection]
  const backgroundPosition = useMemo(() => {
    const xOffset = -(frame * spriteConfig.frameSize * scale)
    const yOffset = -(row * spriteConfig.frameSize * scale)
    return `${xOffset}px ${yOffset}px`
  }, [frame, row, spriteConfig.frameSize, scale])

  // 이동 애니메이션 계산
  const startX = direction === "right" ? initialX : initialX + range
  const endX = direction === "right" ? initialX + range : initialX

  if (reducedMotion) {
    return (
      <div
        style={{
          position: "absolute",
          left: initialX,
          top: y - size,
          width: size,
          height: size,
          zIndex,
          cursor: "pointer",
          backgroundImage: `url(${spriteConfig.src})`,
          backgroundPosition: `0px ${-(DIRECTION_ROW[type][direction] * spriteConfig.frameSize * scale)}px`,
          backgroundSize: `${spriteConfig.sheetSize * scale}px ${spriteConfig.sheetSize * scale}px`,
          imageRendering: "pixelated",
        }}
        onClick={handleClick}
      />
    )
  }

  return (
    <motion.div
      style={{
        position: "absolute",
        top: y - size,
        zIndex,
        cursor: "pointer",
      }}
      initial={{ x: startX }}
      animate={{
        x: [startX, endX, startX],
      }}
      transition={{
        duration: speed * 2,
        repeat: Infinity,
        ease: "linear",
      }}
      whileHover={{ scale: 1.1 }}
      onClick={handleClick}
    >
      <motion.div animate={clickControls}>
        <div
          style={{
            width: size,
            height: size,
            backgroundImage: `url(${spriteConfig.src})`,
            backgroundPosition,
            backgroundSize: `${spriteConfig.sheetSize * scale}px ${spriteConfig.sheetSize * scale}px`,
            imageRendering: "pixelated",
            filter: "drop-shadow(2px 4px 3px rgba(0,0,0,0.3))",
          }}
        />
      </motion.div>
    </motion.div>
  )
}
