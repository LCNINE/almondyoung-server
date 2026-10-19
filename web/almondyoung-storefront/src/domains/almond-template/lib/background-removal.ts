// 가장자리 색을 바탕색으로 보고, 가장자리와 이어진 비슷한 색을 투명하게 만든다.
// 바탕이 흰색이 아니어도 된다. 끊긴 안쪽은 바탕색과 거의 같은 구멍(글자 O 속)만 지운다.
// 단색·단순 바탕용. 사진처럼 복잡한 바탕은 AI 누끼(모델)가 필요하다

// sRGB 0~255 → 선형값 표. 픽셀마다 pow 를 부르지 않게 한 번만 만든다
const LINEAR = Array.from({ length: 256 }, (_, v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

// 사람 눈 기준 색 차이(CIE76 ΔE)를 쓰려고 Lab 으로 바꾼다. RGB 숫자 차이는 어두운 색끼리를 못 가른다
function lab(r: number, g: number, b: number): [number, number, number] {
  const R = LINEAR[r]
  const G = LINEAR[g]
  const B = LINEAR[b]
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047)
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B)
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

const REMOVED = 1
const FILLED = 2

export function removeEdgeBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance?: number
): number {
  const total = width * height
  const at = (x: number, y: number) => y * width + x
  const border: number[] = []
  for (let x = 0; x < width; x++) border.push(at(x, 0), at(x, height - 1))
  for (let y = 1; y < height - 1; y++) border.push(at(0, y), at(width - 1, y))
  // 이미 투명한 가장자리는 바탕색 계산에서 뺀다
  const opaque = border.filter((p) => data[p * 4 + 3] > 16)
  if (!opaque.length) return 0
  const median = (offset: number) =>
    opaque.map((p) => data[p * 4 + offset]).sort((a, b) => a - b)[
      opaque.length >> 1
    ]
  const bgRgb = [median(0), median(1), median(2)]
  const [bl, ba, bb] = lab(bgRgb[0], bgRgb[1], bgRgb[2])
  const distance = (p: number) => {
    const [l, a, b] = lab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2])
    return Math.hypot(l - bl, a - ba, b - bb)
  }

  // 가장자리 색이 얼마나 고르게 퍼졌는지(JPG 얼룩·옅은 그라데이션)를 보고 허용 범위를 정한다
  const spread = opaque.map(distance).sort((a, b) => a - b)
  const p90 = spread[Math.floor(spread.length * 0.9)]
  const tol = tolerance ?? Math.min(40, Math.max(10, 8 + p90 * 1.5))

  const state = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  const visit = (q: number) => {
    if (state[q] || distance(q) > tol) return
    state[q] = FILLED
    queue[tail++] = q
  }
  for (const p of opaque) visit(p)
  while (head < tail) {
    const p = queue[head++]
    const x = p % width
    const y = (p / width) | 0
    if (x > 0) visit(p - 1)
    if (x < width - 1) visit(p + 1)
    if (y > 0) visit(p - width)
    if (y < height - 1) visit(p + width)
  }
  // 글자 O 안쪽처럼 가장자리와 끊긴 구멍도 바탕색과 거의 같으면 지운다
  for (let p = 0; p < total; p++)
    if (!state[p] && data[p * 4 + 3] && distance(p) <= tol / 2)
      state[p] = FILLED

  let changed = 0
  for (let p = 0; p < total; p++) {
    if (state[p] !== FILLED) continue
    data[p * 4 + 3] = 0
    state[p] = REMOVED
    changed++
  }
  if (!changed) return 0

  // 경계 픽셀은 그림색과 바탕색이 섞인 색이다. 둘레에서 가장 바탕과 먼 색을 그림색으로 보고,
  // 섞인 비율만큼 투명하게 하면서 바탕색 성분을 빼서 원래 그림색으로 되돌린다(테두리선 제거)
  const edge: number[] = []
  for (let p = 0; p < total; p++) {
    if (state[p] || !data[p * 4 + 3]) continue
    const x = p % width
    const y = (p / width) | 0
    if (
      (x > 0 && state[p - 1]) ||
      (x < width - 1 && state[p + 1]) ||
      (y > 0 && state[p - width]) ||
      (y < height - 1 && state[p + width])
    )
      edge.push(p)
  }
  const before = new Map(edge.map((p) => [p, distance(p)]))
  for (const p of edge) {
    const x = p % width
    const y = (p / width) | 0
    const own = before.get(p)!
    let far = own
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const q = ny * width + nx
        if (state[q] || !data[q * 4 + 3]) continue
        far = Math.max(far, before.get(q) ?? distance(q))
      }
    const mix = Math.min(1, own / far)
    if (mix >= 0.98) continue
    const i = p * 4
    for (let c = 0; c < 3; c++)
      data[i + c] = Math.round(
        Math.max(
          0,
          Math.min(
            255,
            (data[i + c] - (1 - mix) * bgRgb[c]) / Math.max(mix, 0.05)
          )
        )
      )
    data[i + 3] = Math.round(data[i + 3] * mix)
  }
  return changed
}
