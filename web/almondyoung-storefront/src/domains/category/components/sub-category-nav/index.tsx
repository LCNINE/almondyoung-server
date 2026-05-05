import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getCategoryFallbackThumbnail } from "@/lib/api/pim/search"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import Image from "next/image"

interface SubCategoryNavProps {
  categories: StoreProductCategoryTree[]
  parentHandle?: string
}

async function resolveThumbnail(
  category: StoreProductCategoryTree
): Promise<string | null> {
  const metaThumb = (category.metadata?.thumbnail as string) || null
  if (metaThumb) return metaThumb

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
        const imageUrl = thumbnails[index]
        const href = parentHandle
          ? `/category/${parentHandle}/${category.handle}`
          : `/category/${category.handle}`

        return (
          <LocalizedClientLink
            key={category.id}
            href={href}
            className="flex flex-col items-center gap-2"
          >
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-gray-200">
              {imageUrl ? (
                <Image
                  src={getThumbnailUrl(imageUrl)}
                  alt={category.name}
                  width={96}
                  height={96}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs text-gray-400">No Image</span>
              )}
            </div>
            <span className="text-sm text-gray-700">{category.name}</span>
          </LocalizedClientLink>
        )
      })}
    </div>
  )
}
