import LocalizedClientLink from "@/components/shared/localized-client-link"
import { NavigationMenuLink } from "@/components/ui/navigation-menu"
import { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { ChevronRight } from "lucide-react"

interface CategoryColumnProps {
  category: StoreProductCategoryTree
}

export function CategoryColumn({ category }: CategoryColumnProps) {
  const subCategories = category.category_children || []
  const categoryHandle = category.handle || category.id
  const hasSubCategories = subCategories.length > 0

  return (
    <div className="min-w-0">
      <NavigationMenuLink asChild>
        <LocalizedClientLink
          href={`/category/${categoryHandle}`}
          className="group mb-3 inline-flex items-center gap-1 text-sm font-bold text-gray-900 hover:text-black"
        >
          <span>{category.name}</span>
          <ChevronRight className="h-3.5 w-3.5 text-gray-500 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-900" />
        </LocalizedClientLink>
      </NavigationMenuLink>

      {hasSubCategories && (
        <ul className="flex flex-col gap-1.5">
          {subCategories.map((sub) => {
            const subHandle = sub.handle || sub.id
            return (
              <li key={sub.id}>
                <NavigationMenuLink asChild>
                  <LocalizedClientLink
                    href={`/category/${categoryHandle}/${subHandle}`}
                    className="block text-xs text-gray-600 transition-colors hover:text-gray-900 hover:underline"
                  >
                    {sub.name}
                  </LocalizedClientLink>
                </NavigationMenuLink>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
