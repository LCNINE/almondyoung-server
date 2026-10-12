import { chronologicalPoints } from "./shop-data"

/** Geometry follows actual timestamps; missing days never become observations. */
export function observationPlot(points: { at: string; value: number }[]) {
  const ordered = chronologicalPoints(points)
  if (ordered.length === 0) return []
  const start = Date.parse(ordered[0].at)
  const end = Date.parse(ordered[ordered.length - 1].at)
  const values = ordered.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  return ordered.map((point) => ({
    ...point,
    x:
      end === start
        ? 160
        : 16 + ((Date.parse(point.at) - start) / (end - start)) * 288,
    y: max === min ? 80 : 144 - ((point.value - min) / (max - min)) * 128,
  }))
}
