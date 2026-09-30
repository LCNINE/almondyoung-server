import type { AlmondTemplateSummary } from "@/lib/types/ui/almond-template"
import { PRINT_PRODUCTS, type PrintKind } from "./catalog"

export type PublishedTemplate = AlmondTemplateSummary

export const COLORS = [
  ["#e53935", "빨강"],
  ["#f59e0b", "주황"],
  ["#facc15", "노랑"],
  ["#84cc16", "연두"],
  ["#16a34a", "초록"],
  ["#14b8a6", "청록"],
  ["#06b6d4", "하늘"],
  ["#2563eb", "파랑"],
  ["#4f46e5", "남색"],
  ["#9333ea", "보라"],
  ["#ec4899", "분홍"],
  ["#92400e", "갈색"],
  ["#555555", "검정"],
  ["#ffffff", "흰색"],
] as const

function rgb(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16))
}

function colorGroup(hex: string) {
  const value = rgb(hex)
  if (!value) return ""
  const distance = (sample: string) => {
    const target = rgb(sample)!
    return value.reduce(
      (sum, channel, index) => sum + (channel - target[index]) ** 2,
      0
    )
  }
  return [...COLORS].sort((a, b) => distance(a[0]) - distance(b[0]))[0][0]
}

export function published(item: PublishedTemplate) {
  return !!PRINT_PRODUCTS[item.productId] && /^\d{2,4}x\d{2,4}$/.test(item.size)
}

export function filterTemplates(
  items: PublishedTemplate[],
  filters: {
    productId: string
    availableKinds: readonly PrintKind[]
    kind: PrintKind | ""
    size: string
    keyword: string
    colors: string[]
    industry: string
    purpose: string
  }
) {
  return items.filter((item) => {
    const itemKind = PRINT_PRODUCTS[item.productId]?.kind
    if (filters.productId && item.productId !== filters.productId) return false
    if (!itemKind || !filters.availableKinds.includes(itemKind)) return false
    if (filters.kind && itemKind !== filters.kind) return false
    if (filters.size && item.size !== filters.size) return false
    if (
      filters.keyword &&
      !`${item.title} ${PRINT_PRODUCTS[item.productId].title}`
        .toLocaleLowerCase()
        .includes(filters.keyword.toLocaleLowerCase())
    )
      return false
    if (
      filters.colors.length &&
      !item.colors?.some((entry) => filters.colors.includes(colorGroup(entry)))
    )
      return false
    if (filters.industry && item.industry !== filters.industry) return false
    if (filters.purpose && item.purpose !== filters.purpose) return false
    return true
  })
}
