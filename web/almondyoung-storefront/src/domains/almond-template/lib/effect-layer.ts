export const EFFECT_LAYERS = [
  ["aurora", "오로라 베일", "몽환", "#d5d9f7"],
  ["pearl", "진주빛 광택", "몽환", "#fff6ed"],
  ["lightLeak", "렌즈 빛샘", "빛", "#ffd2be"],
  ["caustics", "물결 반사", "몽환", "#f2e7cb"],
  ["bokeh", "보케", "몽환", "#ffe7ee"],
  ["stardust", "별빛 먼지", "질감", "#f9eddb"],
  ["reflection", "거울빛 선", "빛", "#e7f3ff"],
  ["ripple", "유리 굴절 링", "유리·그림자", "#f2ecff"],
  ["glow", "소프트 글로우", "빛", "#ffe4ee"],
  ["halo", "빛의 고리", "빛", "#e1e9ff"],
  ["gloss", "글로시 빛", "빛", "#ffffff"],
  ["prism", "프리즘", "빛", "#d8eaff"],
  ["shimmer", "미세 펄", "질감", "#fff2d9"],
  ["glitter", "글리터", "질감", "#fff0d6"],
  ["grain", "필름 그레인", "질감", "#cccccc"],
  ["glass", "유리 베일", "유리·그림자", "#ffffff"],
  ["windowShadow", "창가 그림자", "유리·그림자", "#27313d"],
  ["vignette", "소프트 음영", "유리·그림자", "#261e2b"],
] as const
export type EffectKind = (typeof EFFECT_LAYERS)[number][0]
export const MOTION_MASKS = [
  ["full", "전체"],
  ["band", "가로 띠"],
  ["scratch", "스크래치"],
  ["ellipse", "타원"],
  ["softRect", "부드러운 사각형"],
] as const
export type MotionMask = {
  shape: (typeof MOTION_MASKS)[number][0]
  x: number
  y: number
  width: number
  height: number
}
export function validMotionMask(
  value: unknown
): value is MotionMask | undefined {
  if (value === undefined) return true
  if (!value || typeof value !== "object") return false
  const mask = value as MotionMask
  return (
    MOTION_MASKS.some(([key]) => key === mask.shape) &&
    [mask.x, mask.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 100) &&
    [mask.width, mask.height].every(
      (v) => Number.isFinite(v) && v > 0 && v <= 100
    )
  )
}
