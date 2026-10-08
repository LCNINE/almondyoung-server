import type { BeautyTopShop } from "../types"

export function observedNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null
}

export function observedChange(
  metric: BeautyTopShop["growth"]["metrics"][number]
) {
  const current = observedNumber(metric.current)
  const previous = observedNumber(metric.previous)
  if (
    metric.status !== "READY" ||
    current === null ||
    previous === null ||
    metric.delta == null ||
    !Number.isFinite(metric.delta)
  )
    return null
  if (Math.abs(current - previous - metric.delta) > 0.000001) return null
  return metric.delta
}

export function chronologicalPoints<T extends { at?: string; value: number }>(
  points: T[]
) {
  return points
    .filter(
      (point) =>
        observedNumber(point.value) !== null &&
        point.at &&
        Number.isFinite(Date.parse(point.at))
    )
    .sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? ""))
}

export function observedRate(
  metric: BeautyTopShop["growth"]["metrics"][number]
) {
  const delta = observedChange(metric)
  const previous = observedNumber(metric.previous)
  const rate = metric.rate_pct
  if (
    delta === null ||
    previous === null ||
    previous === 0 ||
    rate == null ||
    !Number.isFinite(rate)
  )
    return null
  return Math.abs(rate - (delta / previous) * 100) <= 0.1 ? rate : null
}
