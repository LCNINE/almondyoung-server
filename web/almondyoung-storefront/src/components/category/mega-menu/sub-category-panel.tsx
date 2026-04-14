import LocalizedClientLink from "@/components/shared/localized-client-link"
import { NavigationMenuLink } from "@/components/ui/navigation-menu"
import { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { ChevronRight } from "lucide-react"

interface SubCategoryPanelProps {
  category: StoreProductCategoryTree | null
}

export function SubCategoryPanel({ category }: SubCategoryPanelProps) {
  if (!category) {
    return (
      <div
        id="mega-menu-panel"
        className="flex flex-1 items-center justify-center p-6"
      >
        <p className="text-sm text-gray-400">카테고리를 선택해주세요</p>
      </div>
    )
  }

  const subCategories = category.category_children || []
  const categoryHandle = category.handle || category.id

  return (
    <div id="mega-menu-panel" className="flex-1 p-5">
      {/* 헤더: 카테고리명 + 전체보기 */}
      <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3">
        <h3 className="text-base font-bold text-gray-900">{category.name}</h3>
        <NavigationMenuLink asChild>
          <LocalizedClientLink
            href={`/category/${categoryHandle}`}
            className="group flex items-center gap-0.5 text-xs font-medium text-gray-500 hover:text-gray-900"
          >
            전체보기
            <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </LocalizedClientLink>
        </NavigationMenuLink>
      </div>

      {/* 서브카테고리 그리드 */}
      {subCategories.length > 0 ? (
        <ul className="grid grid-cols-3 gap-x-4 gap-y-2">
          {subCategories.map((subCategory) => {
            const subHandle = subCategory.handle || subCategory.id
            const href = `/category/${categoryHandle}/${subHandle}`

            return (
              <li key={subCategory.id}>
                <NavigationMenuLink asChild>
                  <LocalizedClientLink
                    href={href}
                    className="block rounded px-2 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                  >
                    {subCategory.name}
                  </LocalizedClientLink>
                </NavigationMenuLink>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="py-4 text-center text-sm text-gray-400">
          하위 카테고리가 없습니다
        </p>
      )}
    </div>
  )
}
