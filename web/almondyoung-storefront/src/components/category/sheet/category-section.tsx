import LocalizedClientLink from "@/components/shared/localized-client-link"
import { CategoryThumbnail } from "@/domains/category/components/category-thumbnail"
import { getCategoryThumbnail } from "@/domains/category/utils/category-thumbnail"
import { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { ChevronRight } from "lucide-react"
import Image from "next/image"

interface CategorySectionProps {
  category: StoreProductCategoryTree
  onNavigate: () => void
}

export function CategorySection({
  category,
  onNavigate,
}: CategorySectionProps) {
  const handle = category.handle || category.id
  const children = category.category_children || []
  const imageSrc = getCategoryThumbnail(category)

  return (
    <section
      data-section-id={category.id}
      className="scroll-mt-2 border-b border-gray-100 pt-1 pb-5 first:pt-0 last:border-0"
    >
      <LocalizedClientLink
        href={`/category/${handle}`}
        onClick={onNavigate}
        className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2"
      >
        <div className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-md bg-white">
          {imageSrc ? (
            <Image
              src={getThumbnailUrl(imageSrc)}
              alt={category.name}
              fill
              sizes="28px"
              className="object-contain p-1"
            />
          ) : (
            <div className="h-3 w-3 rounded-sm bg-gray-200" />
          )}
        </div>
        <span className="text-[14px] font-bold text-gray-900">
          {category.name}
        </span>
        <ChevronRight className="h-4 w-4 text-gray-400" />
      </LocalizedClientLink>

      {children.length > 0 && (
        <ul className="grid grid-cols-3 gap-x-2 gap-y-4 px-3">
          {children.map((sub) => {
            const subHandle = sub.handle || sub.id
            return (
              <li key={sub.id}>
                <CategoryThumbnail
                  name={sub.name}
                  href={`/category/${handle}/${subHandle}`}
                  imageUrl={getCategoryThumbnail(sub)}
                  variant="square"
                  sizes="96px"
                  onNavigate={onNavigate}
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
