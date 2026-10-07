import type { FixedCategory } from "@/lib/constants/categories"

// Opening-radar pages are open to search engines, so every combination here is a page a
// crawler can request. The list is fixed on purpose: each entry costs at most two cached
// source reads per cache window, and a longer list raises that bound for the whole site.

export const OPENING_SIDO = "서울"

export const OPENING_GUGUN = [
  "강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구",
  "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구",
  "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구",
] as const

// Source category → store categories whose materials an opening shop needs.
export const OPENING_CATEGORIES = {
  네일: ["nail"],
  속눈썹: ["lash-perm", "lash-extension"],
  반영구: ["semi-permanent"],
  피부관리: ["skincare"],
} as const satisfies Record<string, readonly FixedCategory["key"][]>

export type OpeningCategory = keyof typeof OPENING_CATEGORIES

export const OPENING_CATEGORY_KEYS: readonly OpeningCategory[] = ["네일", "속눈썹", "반영구", "피부관리"]

export function isOpeningArea(gugun: string, category: string): category is OpeningCategory {
  return (
    (OPENING_GUGUN as readonly string[]).includes(gugun) &&
    Object.prototype.hasOwnProperty.call(OPENING_CATEGORIES, category)
  )
}

export function openingPath(gugun: string, category: string) {
  return `/beautytop/opening/${encodeURIComponent(gugun)}/${encodeURIComponent(category)}`
}

export function listOpeningAreas() {
  return OPENING_GUGUN.flatMap((gugun) =>
    OPENING_CATEGORY_KEYS.map((category) => ({ gugun, category }))
  )
}
