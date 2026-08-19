import { getCategoryThumbnail } from "@/domains/category/utils/category-thumbnail"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import Image from "next/image"

interface BrandHeaderProps {
  category: StoreProductCategoryTree
}

/**
 * 브랜드 카테고리("브랜드" 루트의 자식) 상단 헤더.
 * 로고·브랜드명·소개(카테고리 description)를 묶어 브랜드 페이지처럼 보이게 한다.
 * 일반 카테고리의 h1 과 같은 h1 레벨을 유지한다(페이지당 h1 하나).
 */
export function BrandHeader({ category }: BrandHeaderProps) {
  const thumbnail = getCategoryThumbnail(category)
  const description = category.description?.trim()

  return (
    <div className="mb-6 flex items-center gap-4 md:gap-5">
      {thumbnail && (
        <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border bg-white md:h-20 md:w-20">
          <Image
            src={getThumbnailUrl(thumbnail)}
            alt={category.name}
            fill
            sizes="(min-width: 768px) 80px, 64px"
            className="object-contain"
          />
        </span>
      )}
      <div className="min-w-0">
        <h1 className="text-2xl font-bold">{category.name}</h1>
        {description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}
