import { getCategoryByHandle } from "@/lib/api/medusa/categories"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"

/** 카테고리 handle 들을 자손까지 포함한 id 목록으로. 못 찾은(비활성·회원전용) handle 은 빠진다 */
export async function resolveCategoryIds(
  handles: readonly string[]
): Promise<string[]> {
  const categories = await Promise.all(
    handles.map((handle) =>
      getCategoryByHandle([handle]).catch(() => undefined)
    )
  )

  const ids = categories.flatMap((category) =>
    category ? collectCategoryIds(category) : []
  )

  return ids.filter((id, index) => ids.indexOf(id) === index)
}
