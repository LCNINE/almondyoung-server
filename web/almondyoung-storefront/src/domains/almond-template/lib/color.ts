export const validHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value)
const clamp = (value: number) => Math.max(0, Math.min(100, value))

export function cmykFromHex(hex: string): [number, number, number, number] {
  const [r, g, b] = [1, 3, 5].map(
    (index) => parseInt(hex.slice(index, index + 2), 16) / 255
  )
  const k = 1 - Math.max(r, g, b)
  if (k === 1) return [0, 0, 0, 100]
  return [
    Math.round(((1 - r - k) / (1 - k)) * 100),
    Math.round(((1 - g - k) / (1 - k)) * 100),
    Math.round(((1 - b - k) / (1 - k)) * 100),
    Math.round(k * 100),
  ]
}

export function hexFromCmyk(values: number[]) {
  const [c, m, y, k] = values.map((value) => clamp(value) / 100)
  return [c, m, y]
    .map((ink) =>
      Math.round(255 * (1 - ink) * (1 - k))
        .toString(16)
        .padStart(2, "0")
    )
    .reduce((hex, channel) => hex + channel, "#")
}
