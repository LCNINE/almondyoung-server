// 고른 분야들의 베스트를 순위별로 번갈아 섞는다. 1위끼리, 그다음 2위끼리
export function mergeBestProducts<T extends { id?: string }>(
  lists: T[][],
  limit: number
): T[] {
  const merged: T[] = []
  const seen = new Set<string>()
  const longest = Math.max(0, ...lists.map((list) => list.length))

  for (let rank = 0; rank < longest; rank++) {
    for (const list of lists) {
      const product = list[rank]
      if (!product?.id || seen.has(product.id)) continue

      seen.add(product.id)
      merged.push(product)

      if (merged.length >= limit) return merged
    }
  }

  return merged
}
