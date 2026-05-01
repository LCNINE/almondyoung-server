// 파노라마 풍경 설정
export const PANORAMA_CONFIG = {
  width: 3000, // 풍경 전체 너비
  height: 600, // 풍경 높이
  groundY: 450, // 땅 위치 (캐릭터 기준선)
}

// 캐릭터 타입
export type CharacterType = "chicken" | "pig" | "cow" | "sheep"

// 캐릭터 설정
export interface CharacterConfig {
  type: CharacterType
  initialX: number
  y: number
  size: number
  speed: number // 애니메이션 주기 (초)
  range: number // 이동 범위
  direction: "left" | "right" // 초기 방향
  zIndex: number
}

export const CHARACTERS: CharacterConfig[] = [
  {
    type: "chicken",
    initialX: 400,
    y: PANORAMA_CONFIG.groundY,
    size: 80,
    speed: 8,
    range: 200,
    direction: "right",
    zIndex: 45,
  },
  {
    type: "chicken",
    initialX: 2100,
    y: PANORAMA_CONFIG.groundY,
    size: 70,
    speed: 10,
    range: 180,
    direction: "left",
    zIndex: 45,
  },
  {
    type: "pig",
    initialX: 800,
    y: PANORAMA_CONFIG.groundY,
    size: 120,
    speed: 12,
    range: 250,
    direction: "right",
    zIndex: 40,
  },
  {
    type: "pig",
    initialX: 2500,
    y: PANORAMA_CONFIG.groundY,
    size: 110,
    speed: 14,
    range: 200,
    direction: "left",
    zIndex: 40,
  },
  {
    type: "cow",
    initialX: 1300,
    y: PANORAMA_CONFIG.groundY,
    size: 140,
    speed: 15,
    range: 220,
    direction: "left",
    zIndex: 38,
  },
  {
    type: "sheep",
    initialX: 1700,
    y: PANORAMA_CONFIG.groundY,
    size: 110,
    speed: 10,
    range: 280,
    direction: "right",
    zIndex: 40,
  },
  {
    type: "sheep",
    initialX: 550,
    y: PANORAMA_CONFIG.groundY,
    size: 100,
    speed: 12,
    range: 200,
    direction: "left",
    zIndex: 40,
  },
]

// 풍경 요소 타입
export type LandscapeElementType =
  | "cloud"
  | "rainbow"
  | "mountain"
  | "tree"
  | "flower"
  | "sun"

// 풍경 요소 설정
export interface LandscapeElementConfig {
  type: LandscapeElementType
  x: number
  y: number
  scale: number
  zIndex: number
  variant?: number // 변형 (예: 다른 모양의 나무)
}

// 구름 배치
export const CLOUDS: LandscapeElementConfig[] = [
  { type: "cloud", x: 100, y: 50, scale: 1, zIndex: 5, variant: 1 },
  { type: "cloud", x: 500, y: 80, scale: 0.8, zIndex: 5, variant: 2 },
  { type: "cloud", x: 900, y: 40, scale: 1.2, zIndex: 5, variant: 1 },
  { type: "cloud", x: 1400, y: 70, scale: 0.9, zIndex: 5, variant: 3 },
  { type: "cloud", x: 1900, y: 55, scale: 1.1, zIndex: 5, variant: 2 },
  { type: "cloud", x: 2400, y: 85, scale: 0.7, zIndex: 5, variant: 1 },
  { type: "cloud", x: 2800, y: 45, scale: 1, zIndex: 5, variant: 3 },
]

// 산 배치 (먼산 → 가까운산)
export const MOUNTAINS: LandscapeElementConfig[] = [
  // 먼 산 (연한 색, 작은 크기)
  { type: "mountain", x: 0, y: 200, scale: 1, zIndex: 10, variant: 1 },
  { type: "mountain", x: 400, y: 180, scale: 1.2, zIndex: 10, variant: 2 },
  { type: "mountain", x: 900, y: 210, scale: 0.9, zIndex: 10, variant: 1 },
  { type: "mountain", x: 1500, y: 190, scale: 1.1, zIndex: 10, variant: 2 },
  { type: "mountain", x: 2100, y: 200, scale: 1, zIndex: 10, variant: 1 },
  { type: "mountain", x: 2600, y: 185, scale: 1.15, zIndex: 10, variant: 2 },
  // 가까운 산 (진한 색, 큰 크기)
  { type: "mountain", x: 200, y: 280, scale: 1.5, zIndex: 15, variant: 3 },
  { type: "mountain", x: 800, y: 260, scale: 1.8, zIndex: 15, variant: 4 },
  { type: "mountain", x: 1600, y: 270, scale: 1.6, zIndex: 15, variant: 3 },
  { type: "mountain", x: 2300, y: 265, scale: 1.7, zIndex: 15, variant: 4 },
]

// 나무 배치
export const TREES: LandscapeElementConfig[] = [
  { type: "tree", x: 100, y: 380, scale: 1, zIndex: 25, variant: 1 },
  { type: "tree", x: 300, y: 390, scale: 0.9, zIndex: 25, variant: 2 },
  { type: "tree", x: 600, y: 385, scale: 1.1, zIndex: 25, variant: 1 },
  { type: "tree", x: 850, y: 375, scale: 1.2, zIndex: 25, variant: 3 },
  { type: "tree", x: 1100, y: 390, scale: 0.85, zIndex: 25, variant: 2 },
  { type: "tree", x: 1350, y: 380, scale: 1.05, zIndex: 25, variant: 1 },
  { type: "tree", x: 1650, y: 388, scale: 0.95, zIndex: 25, variant: 3 },
  { type: "tree", x: 1900, y: 378, scale: 1.15, zIndex: 25, variant: 2 },
  { type: "tree", x: 2150, y: 385, scale: 1, zIndex: 25, variant: 1 },
  { type: "tree", x: 2450, y: 392, scale: 0.9, zIndex: 25, variant: 3 },
  { type: "tree", x: 2700, y: 380, scale: 1.1, zIndex: 25, variant: 2 },
  { type: "tree", x: 2900, y: 387, scale: 0.95, zIndex: 25, variant: 1 },
]

// 꽃 배치
export const FLOWERS: LandscapeElementConfig[] = [
  { type: "flower", x: 150, y: 470, scale: 1, zIndex: 30, variant: 1 },
  { type: "flower", x: 220, y: 475, scale: 0.8, zIndex: 30, variant: 2 },
  { type: "flower", x: 450, y: 468, scale: 1.1, zIndex: 30, variant: 3 },
  { type: "flower", x: 580, y: 480, scale: 0.9, zIndex: 30, variant: 1 },
  { type: "flower", x: 720, y: 472, scale: 1, zIndex: 30, variant: 2 },
  { type: "flower", x: 950, y: 478, scale: 0.85, zIndex: 30, variant: 3 },
  { type: "flower", x: 1150, y: 470, scale: 1.05, zIndex: 30, variant: 1 },
  { type: "flower", x: 1320, y: 476, scale: 0.95, zIndex: 30, variant: 2 },
  { type: "flower", x: 1520, y: 468, scale: 1.1, zIndex: 30, variant: 3 },
  { type: "flower", x: 1700, y: 480, scale: 0.8, zIndex: 30, variant: 1 },
  { type: "flower", x: 1880, y: 472, scale: 1, zIndex: 30, variant: 2 },
  { type: "flower", x: 2050, y: 475, scale: 0.9, zIndex: 30, variant: 3 },
  { type: "flower", x: 2250, y: 469, scale: 1.05, zIndex: 30, variant: 1 },
  { type: "flower", x: 2420, y: 478, scale: 0.85, zIndex: 30, variant: 2 },
  { type: "flower", x: 2620, y: 470, scale: 1.1, zIndex: 30, variant: 3 },
  { type: "flower", x: 2800, y: 476, scale: 0.95, zIndex: 30, variant: 1 },
]

// 무지개 (하나만)
export const RAINBOW: LandscapeElementConfig = {
  type: "rainbow",
  x: 1200,
  y: 100,
  scale: 1,
  zIndex: 8,
}

// 태양
export const SUN: LandscapeElementConfig = {
  type: "sun",
  x: 2500,
  y: 60,
  scale: 1,
  zIndex: 3,
}

// 떠다니는 섬들
export const FLOATING_ISLANDS: LandscapeElementConfig[] = [
  { type: "cloud", x: 300, y: 150, scale: 1, zIndex: 12, variant: 1 },
  { type: "cloud", x: 800, y: 120, scale: 0.9, zIndex: 12, variant: 2 },
  { type: "cloud", x: 1500, y: 140, scale: 1.1, zIndex: 12, variant: 3 },
  { type: "cloud", x: 2100, y: 130, scale: 0.85, zIndex: 12, variant: 1 },
  { type: "cloud", x: 2600, y: 160, scale: 0.95, zIndex: 12, variant: 2 },
]
