// Pure layout for the neighbourhood dot field: one dot per shop up to MAX_DOTS,
// beyond that one dot stands for several shops (and the legend says how many).

export const MAX_DOTS = 600
const TARGET_DOTS = 400
const STRIDES = [37, 41, 43, 47, 53]

export type DotKind = "new" | "old" | "mine"

export type DotLayout = { perDot: number; dots: DotKind[] }

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

export function layoutDots(shops: number, opened: number, showMine: boolean): DotLayout {
  const total = Math.max(0, Math.floor(shops))
  if (total === 0) return { perDot: 1, dots: [] }
  const perDot = total <= MAX_DOTS ? 1 : Math.ceil(total / TARGET_DOTS)
  const count = Math.ceil(total / perDot)
  const newCount = Math.min(count, Math.round(Math.max(0, opened) / perDot))
  // Spread the new shops evenly instead of stacking them at the top: a stride coprime with the count.
  const stride = STRIDES.find((s) => gcd(s, count) === 1) ?? 1
  const mine = showMine ? Math.floor(count * 0.53) : -1
  const dots: DotKind[] = []
  for (let i = 0; i < count; i++) {
    dots.push(i === mine ? "mine" : (i * stride) % count < newCount ? "new" : "old")
  }
  return { perDot, dots }
}
