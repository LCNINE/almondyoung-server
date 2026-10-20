export const PHOTO_EFFECTS = [
  ["softFocus", "소프트 포커스"],
  ["glass", "반투명 유리"],
  ["gloss", "글로시 빛"],
  ["prism", "프리즘 반사"],
  ["grain", "미세 그레인"],
  ["shimmer", "미세 펄"],
  ["windowShadow", "창가 그림자"],
  ["vignette", "가장자리 음영"],
] as const

export type PhotoEffect = (typeof PHOTO_EFFECTS)[number][0]
export type PhotoEffects = Partial<Record<PhotoEffect, number>>

export function validPhotoEffects(
  value: unknown
): value is PhotoEffects | undefined {
  if (value === undefined) return true
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  return Object.entries(value).every(
    ([key, level]) =>
      PHOTO_EFFECTS.some(([name]) => name === key) &&
      typeof level === "number" &&
      Number.isFinite(level) &&
      level >= 0 &&
      level <= 100
  )
}
