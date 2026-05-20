import { CategoryThumbnail } from "@/domains/category/components/category-thumbnail"
import { getCategoryThumbnail } from "@/domains/category/utils/category-thumbnail"
import { getCategoryFallbackThumbnail } from "@/lib/api/pim/search"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"

interface SubCategoryNavProps {
  categories: StoreProductCategoryTree[]
  parentHandle?: string
}

// 동기 소스(metadata/폴백 맵)로 못 찾으면 PIM API 폴백까지 시도(서버 컴포넌트 전용).
async function resolveThumbnail(
  category: StoreProductCategoryTree
): Promise<string | null> {
  const sync = getCategoryThumbnail(category)
  if (sync) return sync

  return await getCategoryFallbackThumbnail(collectCategoryIds(category))
}

export async function SubCategoryNav({
  categories,
  parentHandle,
}: SubCategoryNavProps) {
  if (!categories || categories.length === 0) {
    return null
  }

  const thumbnails = await Promise.all(categories.map(resolveThumbnail))

  return (
    <div className="flex flex-wrap gap-6">
      {categories.map((category, index) => {
        const href = parentHandle
          ? `/category/${parentHandle}/${category.handle}`
          : `/category/${category.handle}`

        return (
          <CategoryThumbnail
            key={category.id}
            name={category.name}
            href={href}
            imageUrl={thumbnails[index]}
            variant="circle"
          />
        )
      })}
    </div>
  )
}
