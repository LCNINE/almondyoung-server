import { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { cn } from "@/lib/utils"
import { ChevronRight } from "lucide-react"

interface MainCategoryListProps {
  categories: StoreProductCategoryTree[]
  activeCategory: StoreProductCategoryTree | null
  onCategoryHover: (category: StoreProductCategoryTree) => void
}

export function MainCategoryList({
  categories,
  activeCategory,
  onCategoryHover,
}: MainCategoryListProps) {
  return (
    <div className="w-[180px] shrink-0 border-r border-gray-100 py-3">
      <ul className="flex flex-col">
        {categories.map((category) => {
          const isActive = activeCategory?.id === category.id

          return (
            <li key={category.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors",
                  isActive
                    ? "bg-gray-50 font-semibold text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
                onMouseEnter={() => onCategoryHover(category)}
                onFocus={() => onCategoryHover(category)}
                onClick={() => onCategoryHover(category)}
                aria-controls="mega-menu-panel"
                aria-pressed={isActive}
              >
                <span>{category.name}</span>
                <ChevronRight
                  className={cn(
                    "h-4 w-4 transition-colors",
                    isActive ? "text-gray-900" : "text-gray-400"
                  )}
                />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
