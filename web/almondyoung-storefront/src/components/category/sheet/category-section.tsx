import LocalizedClientLink from "@/components/shared/localized-client-link"
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
  const imageSrc = getCategoryImageSrc(category)

  return (
    <section
      data-section-id={category.id}
      className="scroll-mt-2 border-b border-gray-100 pt-1 pb-4 first:pt-0 last:border-0"
    >
      <LocalizedClientLink
        href={`/category/${handle}`}
        onClick={onNavigate}
        className="mb-2 flex items-center gap-2 rounded-lg px-3 py-2"
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
        <ul className="flex flex-col px-4">
          {children.map((sub) => {
            const subHandle = sub.handle || sub.id
            return (
              <li key={sub.id}>
                <LocalizedClientLink
                  href={`/category/${handle}/${subHandle}`}
                  onClick={onNavigate}
                  className="block py-2.5 text-[13px] text-gray-700 hover:text-black"
                >
                  {sub.name}
                </LocalizedClientLink>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const getCategoryImageSrc = (category: StoreProductCategoryTree) => {
  const metadata = category.metadata as
    | { imageUrl?: unknown; image_url?: unknown; image?: unknown }
    | null
    | undefined
  const image =
    metadata?.imageUrl || metadata?.image_url || metadata?.image || null
  return typeof image === "string" ? image : null
}
