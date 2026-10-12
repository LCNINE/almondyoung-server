import type { BeautyTopPriceGroup } from "../types"

export function priceVerdict(value: number, group: Pick<BeautyTopPriceGroup, "min" | "max" | "median">) {
  if (value > group.max) return { kind: "aboveMax" as const, diff: value - group.max }
  if (value < group.min) return { kind: "belowMin" as const, diff: group.min - value }
  const median = group.median ?? 0
  if (value === median) return { kind: "atMedian" as const, diff: 0 }
  return value > median ? { kind: "aboveMedian" as const, diff: value - median } : { kind: "belowMedian" as const, diff: median - value }
}
