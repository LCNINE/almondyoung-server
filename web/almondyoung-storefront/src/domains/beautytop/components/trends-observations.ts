import type { BeautyTopProcedure, BeautyTopTrends } from "../types"

export function observedCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

export function observedPercent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  )
}

export function menuPercent(row: BeautyTopProcedure): number | null {
  if (row.regional.ready && observedPercent(row.regional.local_percent))
    return row.regional.local_percent
  if (
    row.adoption.ready === true &&
    observedCount(row.adoption.checked_shops) &&
    row.adoption.checked_shops > 0 &&
    observedCount(row.adoption.current_shops) &&
    row.adoption.current_shops <= row.adoption.checked_shops
  ) {
    return (row.adoption.current_shops / row.adoption.checked_shops) * 100
  }
  return null
}

export function observedMenus(data: BeautyTopTrends, category: string) {
  return (data.procedures?.available ? data.procedures.rows : [])
    .filter(
      (row) =>
        row.category === category &&
        observedCount(row.adoption.checked_shops) &&
        row.adoption.checked_shops > 0 &&
        observedCount(row.adoption.current_shops) &&
        row.adoption.current_shops <= row.adoption.checked_shops
    )
    .sort((a, b) => b.adoption.current_shops - a.adoption.current_shops)
}
