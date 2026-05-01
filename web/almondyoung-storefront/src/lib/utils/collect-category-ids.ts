import type { HttpTypes } from "@medusajs/types"

// 카테고리와 모든 하위 카테고리 ID를 재귀적으로 수집
export function collectCategoryIds(
  category: HttpTypes.StoreProductCategory
): string[] {
  const ids: string[] = [category.id]

  if (category.category_children?.length) {
    for (const child of category.category_children) {
      ids.push(...collectCategoryIds(child))
    }
  }

  return ids
}
