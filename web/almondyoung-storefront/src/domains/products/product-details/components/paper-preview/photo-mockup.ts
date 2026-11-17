import { PAPER_ASSETS, type PaperShape } from "./paper"

type Point = [number, number]

// 3D 대신(또는 3D 와 함께) 실제 장면 사진에 시안을 원근으로 붙인다. 좌표는 size px 정사각형 사진 기준이고,
// quad 는 시안 네 모서리(위왼·위오·아래오·아래왼)다. layers 는 시안 위에 겹치는 고정 레이어(그늘·반사·큐방)다.
// multiply 면 원래 사진의 흰 판에 시안을 곱해 판의 빛·그늘을 그대로 살린다
export type PhotoMockup = {
  size: number
  background: string
  quad: [Point, Point, Point, Point]
  artBlend?: "multiply"
  layers?: { src: string; blend?: "multiply" | "screen" }[]
}

export const WINDOW_MOCKUP: PhotoMockup = {
  size: 880,
  background: `${PAPER_ASSETS}/window-bg-v1.jpg`,
  quad: [
    [349.11, 162.02],
    [649.38, 196.37],
    [648.88, 442.68],
    [350.9, 453.38],
  ],
  layers: [
    { src: `${PAPER_ASSETS}/window-shade-v1.png`, blend: "multiply" },
    { src: `${PAPER_ASSETS}/window-reflect-v1.jpg`, blend: "screen" },
    { src: `${PAPER_ASSETS}/window-cups-v1.png` },
  ],
}

// 메뉴판: 카운터 아크릴 받침, 매장 벽, 유리창 큐방. 사진 속 흰 판 위에 시안을 곱한다
export const MENU_MOCKUPS: PhotoMockup[] = [
  {
    size: 1024,
    background: `${PAPER_ASSETS}/menu-photo-1-v1.jpg`,
    quad: [
      [430.1, 156.5],
      [817.7, 156.5],
      [754.8, 838.2],
      [354.0, 798.7],
    ],
    artBlend: "multiply",
  },
  {
    size: 1024,
    background: `${PAPER_ASSETS}/menu-photo-2-v1.jpg`,
    quad: [
      [373.0, 204.8],
      [699.2, 200.4],
      [690.5, 668.5],
      [365.7, 662.7],
    ],
    artBlend: "multiply",
  },
  {
    size: 1024,
    background: `${PAPER_ASSETS}/menu-photo-3-v1.jpg`,
    quad: [
      [292.6, 139.0],
      [772.4, 128.7],
      [753.4, 804.6],
      [299.9, 782.6],
    ],
    artBlend: "multiply",
  },
]

// w×h 요소를 네 점으로 보내는 CSS matrix3d (transform-origin 0 0). 단위 정사각형 → 사각형 호모그래피에 크기를 나눠 곱한다
export function quadMatrix3d(
  quad: [Point, Point, Point, Point],
  w: number,
  h: number
): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  const det = dx1 * dy2 - dx2 * dy1
  const g = (sx * dy2 - dx2 * sy) / det
  const k = (dx1 * sy - sx * dy1) / det

  const a = x1 - x0 + g * x1
  const b = x3 - x0 + k * x3
  const d = y1 - y0 + g * y1
  const e = y3 - y0 + k * y3

  const m = [
    a / w,
    d / w,
    0,
    g / w,
    b / h,
    e / h,
    0,
    k / h,
    0,
    0,
    1,
    0,
    x0,
    y0,
    0,
    1,
  ]

  return `matrix3d(${m.map((v) => Number(v.toFixed(9))).join(",")})`
}

// 상세 본문에 크게 보여 줄 장면 사진(서버·클라이언트가 함께 쓴다)
export const PRINT_SCENES: Partial<Record<PaperShape, PhotoMockup[]>> = {
  window: [WINDOW_MOCKUP],
  menu: MENU_MOCKUPS,
}

export function hasPrintScenes(shape: PaperShape): boolean {
  return shape in PRINT_SCENES
}
