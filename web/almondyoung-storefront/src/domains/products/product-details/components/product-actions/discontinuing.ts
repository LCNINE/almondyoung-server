import { HttpTypes } from "@medusajs/types"

export type DiscontinuingScope = "all" | "partial"

/** 단종 예정 옵션이 전부인지 일부인지. 없으면 null. 표시 전용이라 판매 여부와 무관하다. */
export function pickDiscontinuing(
  variants?: (HttpTypes.StoreProductVariant | undefined)[] | null
): DiscontinuingScope | null {
  const list = variants ?? []
  const count = list.filter((v) => v?.metadata?.discontinuing === true).length
  if (count === 0) return null

  return count === list.length ? "all" : "partial"
}
